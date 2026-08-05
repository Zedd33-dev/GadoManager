# Regras de negócio

Every domain formula implemented in GadoManager, with its units, its
justification, and the proof that the code computes it correctly.

Rules are documented here as they are implemented. Sections marked *pendente*
name the phase that will add them.

---

## 1. Conventions

| Concern | Convention | Reason |
| --- | --- | --- |
| Dates | `TEXT` in ISO `YYYY-MM-DD` | Lexicographic order equals calendar order, so range comparisons are valid as string comparisons. A `GLOB` constraint rejects any other format. |
| Money | `INTEGER` centavos | Repeated addition of floating-point currency accumulates error across a herd's costs. |
| Weight | `REAL` kilograms | |
| Missing values | `null`, rendered as `—` | "No data" and "the answer is zero" are different facts. See §7. |

---

## 2. GMD — ganho médio diário (average daily gain)

**Unit:** kg/dia

### Per animal

```
GMD = (peso da pesagem mais recente − peso da pesagem anterior)
      ────────────────────────────────────────────────────────
            dias entre as duas pesagens
```

### Herd average

The arithmetic mean of the per-animal GMD, taken **only over active animals with
at least two weighings**.

An animal with a single weighing is **excluded from both the numerator and the
denominator**. It is not counted as zero.

> **Why this matters.** Gain is a rate between two points; one measurement yields
> no rate at all. Counting such an animal as zero would mean that registering a
> newly purchased animal *lowers* the reported herd performance, which is
> nonsense — nothing about the herd changed.

### Implementation

`averageDailyGain()` in `src/repositories/dashboardRepository.js`.

The exclusion is enforced by the **join**, not by application logic:

```sql
FROM ranked curr
JOIN ranked prev
  ON prev.animal_id = curr.animal_id
 AND prev.rn = 2
WHERE curr.rn = 1
```

An animal with one weighing has no row at `rn = 2`, so the inner join produces
no row for it and it disappears from the aggregate. There is no code path that
could accidentally include it as a zero.

### Proof

Fixture (`tests/integration/kpi.test.js`):

| Animal | Pesagens | GMD |
| --- | --- | --- |
| A | 400 kg em 03/06 → 460 kg em 03/08 (61 dias) | 60 ÷ 61 = 0,98361 |
| B | 300 kg em 04/07 → 330 kg em 03/08 (30 dias) | 30 ÷ 30 = 1,00000 |
| C | 500 kg em 03/08 apenas | — (excluído) |
| D | nenhuma | — (excluído) |
| E | 700 → 800 kg, mas **vendido** | — (excluído) |

Expected herd GMD = (0,98361 + 1,00000) ÷ 2 = **0,99180 kg/dia**, over n = 2.

If C were counted as zero the result would be 0,66120 over n = 3; the test
asserts the value is *not* that. If E were included the average would rise,
which a second test confirms by reactivating E and observing the change — proving
the status filter is load-bearing rather than incidentally satisfied.

### Division safety

`delta_days` can never be zero: `UNIQUE(animal_id, weigh_date)` forbids two
weighings on the same date. The query additionally filters `delta_days > 0`, so
the statement is safe read in isolation.

Negative GMD is **permitted and displayed**. Weight loss in the dry season is a
real outcome, and clamping it to zero would hide exactly the animals a manager
needs to see.

---

## 3. Peso médio (última pesagem)

**Unit:** kg

The mean of **each active animal's most recent weighing** — not the mean of the
weighings table.

> **Why this matters.** Averaging every weighing ever recorded weights
> long-tenured animals more heavily than recent arrivals, and mixes an animal's
> 2024 weight into a 2026 figure. In the test fixture the two differ by 32 kg
> (430 versus 398).

Ties on the same date are broken by `id DESC`, so the figure is deterministic
between runs.

Inactive animals — `vendido`, `morto`, `transferido` — are excluded.

**Implementation:** `latestWeightAverage()`, using
`ROW_NUMBER() OVER (PARTITION BY animal_id ORDER BY weigh_date DESC, id DESC)`
filtered to `rn = 1`.

---

## 4. Atrasado — overdue vaccines and treatments

A dose is **atrasada** when **all three** conditions hold:

1. `scheduled_date < hoje`
2. `applied_date IS NULL`
3. the animal's status is `ativo`

A dose scheduled **for today** is *a vencer*, not late.

> **Why condition 3 matters.** Dropping it is the leading explanation for a herd
> of 34 animals reporting 72 overdue vaccines: sold and dead animals keep raising
> alerts indefinitely. Animals that left the herd must never generate work.

### Doses versus animals

The query returns **both** the dose count and
`COUNT(DISTINCT animal_id)`, so the interface can state:

> 72 doses de vacina atrasadas em 41 animais

rather than a bare `72` whose denominator the reader has to guess. One animal
legitimately carries several overdue doses; reporting only the dose count invites
the reader to assume it means animals.

### Fan-out

The query joins `health_events` to `animals` only. That relationship is
many-to-one, so the result has exactly one row per event and row multiplication
is structurally impossible. A test adds unrelated weighings for the same animal
and asserts the dose count does not move.

**Implementation:** `healthAlertCounts()`.

---

## 5. Sem pesagem recente

An active animal with no weighing in the last **60 days** — roughly one weighing
cycle for an operation that weighs every 60–90 days.

The count deliberately **includes animals never weighed**, since both populations
need weighing, but reports them separately: an overdue routine and an animal
never entered into the programme call for different action.

**Implementation:** `animalsWithoutRecentWeighing()`.

---

## 6. Custos do mês

Sum of `amount_cents` over the **half-open interval** `[início do mês, início do
mês seguinte)`.

> **Why half-open.** It includes every day regardless of month length and cannot
> double-count a boundary date, which a `BETWEEN` on month ends can.

The query also returns `entry_count`, which is what distinguishes:

- `entry_count = 0` → **no data** → render `—` plus *"Nenhum custo lançado neste
  mês"* and a call to action;
- `entry_count > 0` and `SUM = 0` → **a real zero** → render `R$ 0,00`.

**Implementation:** `costTotalInRange()`.

---

## 7. Safe arithmetic

`src/lib/safeMath.js` enforces one rule: a calculation with no meaningful answer
returns `null`, never `NaN`, `Infinity`, or a misleading `0`.
`src/lib/format.js` renders `null` as an em dash.

Note the deliberate asymmetry:

- `safeAverage([])` → `null` — no values is not an average of zero.
- `safeSum([])` → `0` — a sum over no records genuinely is zero.

Callers that must distinguish "no records" from "records summing to zero" check
the record count separately, which is exactly what the cost KPI does.

---

## 8. Arroba (@) — venda e valor bruto

**Convention:** 1 @ = **15 kg de carcaça**, not live weight.

```
arrobas = round2(peso_vivo_kg × (rendimento_carcaça_% ÷ 100) ÷ 15)
valor_bruto = round(arrobas × preço_por_arroba)
```

Cattle in Brazil are priced per arroba of **carcass**, so the conversion requires
the carcass yield. Implemented in `src/services/saleService.js#calculateSaleValue`,
one call per sale item (an animal), with values stored in cents to avoid
floating-point drift in currency totals.

Typical yields: Nelore 51,5–54 %; cruzado and Angus 53–56,5 %. The schema
constrains `carcass_yield_pct` to 40–65, outside which a value is a data-entry
error rather than an animal.

An animal still serving a [carência](#10-período-de-carência) cannot be sold —
`saleService.validateSaleItem` blocks it and names the release date and the
product responsible, both on the server (authoritative) and on the sale form
(disabled checkbox, "Carência até" badge, for usability).

---

## 9. Taxa de lotação (UA/ha)

**Convention:** 1 UA (unidade animal) = **450 kg de peso vivo**.

```
UA total        = Σ (peso vivo de cada animal ativo no pasto) ÷ 450
taxa de lotação = UA total ÷ área do pasto em hectares
```

Expressing stocking as UA/ha rather than head/ha lets pastures carrying animals
of different sizes be compared: forty 225 kg calves and twenty 450 kg steers both
represent 20 UA. There is a test asserting exactly that equivalence.

Constant defined as `ANIMAL_UNIT_KG` in `src/domain/constants.js`; implemented in
`src/services/stockingRateService.js`.

### Live weight comes from the latest weighing

Each animal contributes its **most recent** weighing, matching the rule used by
the `Peso médio` KPI. Only `ativo` animals count — a sold animal no longer
grazes the pasture.

### The honest-denominator problem

Some animals have never been weighed. They occupy the pasture and eat its
forage, but contribute no measurable weight. Three options existed:

| Option | Consequence |
| --- | --- |
| Exclude them silently | Understates the real rate, presented as fact |
| Estimate from the herd average | Invents data and presents it as measurement |
| **Compute from what is known and report the omission** | **Chosen** |

The figure is therefore a **lower bound** whenever any animal in the pasture
lacks a weighing, and the interface labels it *"Valor mínimo: exclui animais sem
pesagem"* rather than presenting an underestimate as a measurement. This is the
same "report the population the average was computed over" rule the Phase 4 KPIs
follow.

A pasture with animals but **no** weighings reports `—`, not `0` — a zero would
claim the pasture is empty, which is the opposite of the truth. A pasture with
genuinely no animals does report `0`.

### Judging the rate

Whether a rate is *too high* is **not** universal — it depends on forage
species, soil, rainfall and management. Encoding one global threshold would be
inventing a domain rule, so capacity is stored **per pasture**
(`pastures.max_stocking_rate_ua_ha`, migration 004). Where it is not informed,
the interface reports the computed rate and explicitly declines to judge it.

Three bands, not a boolean:

| Status | Condition |
| --- | --- |
| `adequada` | below 90% of capacity |
| `atencao` | 90% of capacity or above, up to and including 100% |
| `excedida` | strictly above capacity |

A pasture at 95% is not overgrazed, but it is the one to move animals out of
first — a warning that only appears after the damage is done is of little use to
whoever has to act on it.

> **Provisional figures.** The capacities in the demo seed (1,0–1,6 UA/ha by
> forage) are plausible for managed pasture in the Cerrado but should be
> confirmed against the thesis references before the defense.

---

## 10. Período de carência

The withdrawal period is the number of days after a product is applied during
which the animal may not be slaughtered.

```
liberado_em = data_aplicacao + carência_dias
```

Implemented in `evaluateWithdrawal` (`src/services/healthService.js`).

### Rules

- **Withdrawal counts from application, never from the scheduled date.** A dose
  that was due but never applied starts no carência at all.
- **The animal is clear *on* the release day**, not the day after. Both
  boundaries are pinned by test.
- **A zero carência never blocks.** Not every product has one.
- **When several products overlap, the latest release date binds.** Clearing one
  product does not clear the animal while another is still in effect, and the
  interface names which product is the binding one.

### Why the value is copied, not referenced

`withdrawal_days` is copied from the protocol onto the `health_events` row **at
scheduling time** rather than read through a join. Editing a protocol must not
retroactively change a carência that has already been served — the days that
applied are the days that were in force when the dose was given.

---

## 16. Agendamento automático por protocolo

A protocol schedules doses in one of two modes, both stored on the protocol row:

| Mode | Date computed as |
| --- | --- |
| `por_idade` | `data_nascimento + age_days`, **per animal** |
| `por_data` | a single date chosen at scheduling time |

Age-based scheduling is the reason one protocol applied to a whole lote produces
a *different* date for each animal — which is the point of the feature.

`interval_days`, when set, schedules a booster (reforço) that many days after the
first dose.

> **An age-based date in the past is kept, not shifted to today.** An animal
> already older than the target age genuinely *is* overdue for that dose; moving
> the date forward would hide a real gap in the herd's sanitary history behind a
> tidy-looking schedule.

### The calendar itself is data, not code

No vaccine, product or interval is hardcoded anywhere in the application. A
protocol is a row the user creates and edits at `/protocolos`. Which vaccines a
herd needs depends on the state, the year and current legislation, so a calendar
written into source would be both indefensible and destined to go stale.

> **The seeded calendar is PROVISIONAL.** It omits *febre aftosa* deliberately:
> Brazil was recognised free of foot-and-mouth disease **without vaccination** in
> 2025, so a routine aftosa campaign in a 2026 dataset would be an anachronism.
> What it seeds instead — brucelose (females, 3–8 months), clostridioses, raiva,
> and vermifugação — should be confirmed against the thesis references before the
> defense.

---

## 17. Movimentação e a localização atual

`animals.lot_id` and `animals.pasture_id` are a deliberate denormalisation of the
movement history, so the dashboard can filter by lote without a correlated
subquery over every movement ever recorded.

That denormalisation is only safe if the two can never disagree, so **recording a
movement and updating the animal's location happen in one transaction**
(`recordMovements`). This is issue `DAT-04`.

- A destination of `null` for lot or pasture means **leave that one unchanged**,
  so an animal can move between paddocks without disturbing its lote.
- A movement that changes neither is rejected — it is not a movement.
- Moving between farms is legitimate, but only within the caller's own scope, and
  the schema's `UNIQUE(farm_id, ear_tag)` still applies: a batch whose ear tag
  would collide on the destination farm fails **entirely**, leaving the herd
  untouched rather than half-moved.

---

## 18. Doses atrasadas: numerador e denominador

The alert panel reports overdue doses **and** the number of animals they span,
per kind:

> 40 doses de vacina atrasadas em 33 animais

Both numbers must describe the **same population**. Counting distinct animals
across vaccines *and* treatments while reporting only the vaccine dose count
produced "40 doses de vacina em 49 animais" — a denominator larger than the
numerator, which is impossible for a per-kind statement since a dose belongs to
exactly one animal. Fixed in Phase 10 with per-kind animal counts and a
regression test.

---

## 11. Lucro estimado por animal vendido

Implemented in `src/services/saleService.js#estimateAccumulatedCost`. This is
explicitly an **average allocation, not a per-lot cost trace**:

```
custo_médio_mensal = Σ (custos do período na fazenda) ÷ Σ (efetivo médio ativo no período)
custo_acumulado_estimado(animal) = preço_de_compra(animal, se comprado)
                                    + custo_médio_mensal × meses_na_fazenda(animal)
lucro_estimado = valor_bruto_da_venda − custo_acumulado_estimado
```

`meses_na_fazenda` counts from the animal's `birth_date` (if born on the farm)
or its purchase/entry date to the sale date. A precise per-animal cost would
require reconstructing which costs applied to which lote across every
movement the animal made — a much larger feature for a figure that would
still be an allocation, not a measurement, since shared costs (pasture,
labour, general treatments) have no objectively "correct" per-head split.
The sale detail view labels this figure as an estimate/average so it is never
read as an audited cost.

Recurring costs (`custos`) expand at creation time into independent dated
rows via `costService.expandRecurrence` (`addMonths`, capped at 60
occurrences) — deleting one occurrence never affects the others, since each
row is a fully independent `costs` record after expansion.

---

## 14. Detecção de outlier na pesagem

A weighing is flagged when the animal lost more than
**`WEIGHT_LOSS_OUTLIER_FRACTION` (5%)** relative to its previous weighing:

```
perda = (peso anterior − peso informado) ÷ peso anterior
sinaliza quando perda > 0,05
```

Expressed as a **fraction, not an absolute number of kilograms**, so it scales:
a 20 kg drop is unremarkable for a 500 kg steer (4%) and alarming for a 120 kg
calf (16,7%). Both cases are tested.

> **A flagged weighing is a warning, never a rejection.** An animal genuinely
> can lose weight — the dry-season model in the demo seed produces exactly that
> — so refusing to record it would corrupt the herd's real history to guard
> against a typo. The operator confirms explicitly and the value is stored. What
> the check actually catches is the far more common cause of a sudden 90% drop:
> a digit dropped while typing, 382 entered as 38.

The comparison baseline is the animal's most recent weighing **strictly before**
the new date, not simply its latest — so back-dating a forgotten weighing
compares against what actually preceded it.

---

## 15. GMD não é recalculado — é derivado

The brief asks for GMD to be recalculated when a weighing is recorded. **There
is nothing to recalculate.** GMD is never stored: the dashboard KPI, the GMD
curve and the per-row figure on the Pesagens list are all derived from the
`weighings` table at read time.

Recording a weighing therefore updates every GMD in the system by the act of
inserting the row — no cache to invalidate, no denormalised column that could
silently fall out of step with the weighings it summarises. The same reasoning
applies to the lote and fazenda counters (head count, average weight), which are
computed by their list queries rather than stored.

What the interface does provide is the *newly implied* GMD for each animal
immediately after a weighing is recorded, which is the genuinely useful part of
the original request.

---

## 12. Composição do rebanho — classificação por faixa etária

**Categorias:** bezerro(a), novilha, boi, vaca, touro.

```
idade < 12 meses               -> bezerro(a)  (qualquer sexo)
12 <= idade < 36 meses, fêmea  -> novilha
12 <= idade < 36 meses, macho  -> boi
idade >= 36 meses, fêmea       -> vaca
idade >= 36 meses, macho       -> touro
```

Thresholds are `CALF_MAX_AGE_MONTHS = 12` and `YOUNG_MAX_AGE_MONTHS = 36` in
`src/domain/constants.js`.

> **Stated approximation.** In a real operation, "novilha" versus "vaca" and
> "boi" versus "touro" depend on reproductive status — whether a female has
> calved, whether a male is used for breeding — not on age alone. This schema
> does not track either. Classifying by age is a deliberate simplification,
> disclosed here and in the dashboard's own copy, rather than an unstated
> assumption. Restricted to active animals, for the same reason the weight and
> GMD KPIs are: it describes the herd as it exists today.

---

## 13. Gráficos históricos — pesagens de animais que já saíram do rebanho

**Rule:** the "Evolução do peso médio" and "Curva de GMD" charts include
weighings from animals that have since been sold, died, or transferred. They
are the only two places in the system that do **not** filter by
`status = 'ativo'`.

> **Why this is correct, not a bug.** A historical trend answers "what did the
> herd weigh over time", not "what is the herd worth today" — the question the
> `Peso médio (última pesagem)` KPI answers. An animal sold in June genuinely
> weighed what it weighed in March; removing that data point after the fact
> would be survivorship bias, understating the herd's real historical
> performance. The two answer different questions and are allowed to disagree.

Both charts use a fixed trailing 12-month window
(`CHART_TREND_MONTHS` in `src/domain/constants.js`), independent of the
dashboard's Período filter — a 30-day window would leave a monthly-bucketed
line chart with one or two points.
