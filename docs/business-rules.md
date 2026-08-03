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

## 8. Arroba (@) — *pendente, Fase 11*

**Convention:** 1 @ = **15 kg de carcaça**, not live weight.

```
arrobas = peso_vivo_kg × (rendimento_carcaça_% ÷ 100) ÷ 15
valor   = arrobas × preço_por_arroba
```

Cattle in Brazil are priced per arroba of **carcass**, so the conversion requires
the carcass yield. The demo data applies this formula already
(`seeds/demo.js`); the Vendas module and its tests arrive in Phase 11.

Typical yields: Nelore 51,5–54 %; cruzado and Angus 53–56,5 %. The schema
constrains `carcass_yield_pct` to 40–65, outside which a value is a data-entry
error rather than an animal.

---

## 9. Taxa de lotação (UA/ha) — *pendente, Fase 9*

**Convention:** 1 UA (unidade animal) = **450 kg de peso vivo**.

```
UA total       = Σ (peso vivo de cada animal no pasto) ÷ 450
taxa de lotação = UA total ÷ área do pasto em hectares
```

Expressing stocking as UA/ha rather than head/ha lets pastures carrying animals
of different sizes be compared: forty 225 kg calves and twenty 450 kg steers both
represent 20 UA.

Constant defined as `ANIMAL_UNIT_KG` in `src/domain/constants.js`.

---

## 10. Período de carência — *pendente, Fase 10*

The withdrawal period is the number of days after a product is applied during
which the animal may not be slaughtered.

```
liberado_em = data_aplicacao + carência_dias
```

`withdrawal_days` is copied from the protocol onto the `health_events` row **at
scheduling time**, so a later edit to the protocol does not retroactively change
a carência that has already been served.

---

## 11. Custo por animal — *pendente, Fase 11*

Planned: costs allocated to a lote divide across the animals in that lote for the
period; farm-wide costs divide across the farm's active herd. The exact
apportionment rule will be documented here when implemented.

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
