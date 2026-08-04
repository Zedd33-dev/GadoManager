# Changelog

All notable changes to GadoManager, organised by the execution phases defined in
[`docs/00-baseline-design.md`](docs/00-baseline-design.md).

This file doubles as evidence of methodology for the written thesis: each phase
records what was built, why, and what it closes from the issue register.

---

## Phase 7 — Design system, mobile navigation and accessibility (2026-08-03)

Formalizes the design system, adds working mobile navigation, fixes a real
CSP bug found while auditing for one, and adds the toast mechanism Phase 8's
create/update/delete actions will reuse.

### Added

- **Brand colour** (`--color-brand: #1f3a2e`) for the header, distinct from
  the semantic `--color-success` so a green header bar is never read as a
  status indicator.
- **`.card` base** consolidating what `.kpi-card`, `.chart-card` and
  `.auth-card` each redeclared identically.
- **`src/views/partials/nav.ejs`** — persistent header with a brand link, a
  primary nav, a hamburger toggle (three CSS bars, not a glyph or emoji), and
  the user/logout box. Deliberately lists only "Painel" today; other modules
  are appended to the same list as each ships in Phases 8-11, rather than
  linking to routes that do not exist yet and would 404 from primary
  navigation.
- **`public/js/nav.js`** — toggles the mobile menu; the nav and user box are
  always in the markup, so the page is fully usable if this script never
  loads.
- **`src/middleware/flash.js`** (`setFlash` / `flashMiddleware`) — one-time,
  session-backed flash messages, rendered by `partials/toast.ejs` and
  dismissed by `public/js/toast.js`. Demonstrated today on login
  ("Bem-vindo(a), {name}."); Phase 8's create/update/delete actions call the
  same `setFlash` after their own redirects.
- **`.table--responsive`** utility: below 768px, a table's `<thead>` is
  hidden the same way `.visually-hidden` hides content - clipped, never
  `display: none`, so a screen reader still gets the column structure - and
  each row becomes a labelled card via `data-label` on every `<td>`. Applied
  to all six chart data tables today; Phase 8's list screens reuse the same
  class.
- **8 new tests** for the flash middleware.
- **A contrast audit**: all 12 foreground/background pairs actually used in
  the stylesheet, computed via the WCAG 2.1 relative luminance formula and
  recorded as a comment at the top of `app.css`. All pass AA; most clear AAA.

### Fixed

- **A real CSP bug, found while auditing for exactly this.** Every dashboard
  filter `<select>` used `onchange="this.form.submit()"` since Phase 5. The
  CSP is `script-src 'self'` with no `unsafe-inline`, and a strict CSP blocks
  inline event-handler attributes the same way it blocks an inline
  `<script>` block - so that handler never actually ran in a real browser.
  The filters kept working only because the submit button was always present
  as a fallback (a deliberate Phase 5 design choice that, as it turned out,
  was quietly carrying the whole feature). Verified the block is real by
  attempting an inline `onclick` from the browser console against the live
  CSP and confirming it does not fire, then replaced the attribute with a
  proper listener in `public/js/filterBar.js`.
- **Touch targets below the 44px minimum**: status chips were 32px, and the
  `<summary>` toggles on chart tables and the diagnostics panel had no
  enforced height. Both now measure 44px, verified in a live mobile viewport.

### Decisions

- **The nav lists only implemented modules.** Showing "Vacinas" or "Vendas"
  now would either be a dead link or a 404 from primary navigation - neither
  is acceptable in a working demo, even though our 404 page is itself honest
  and styled. The nav grows by one line per phase instead.
- **Toasts render as a dismissible banner at the top of the content**, not a
  floating fixed-position corner popup - simpler to keep tappable on a phone
  and there is no z-index/overlap to reason about.
- **Flash only demonstrated on login, not logout.** `logout` calls
  `session.destroy()`, which removes the very session a flash message would
  need to survive in; `login` calls `session.regenerate()` on a session that
  stays alive through the redirect, so the mechanism works there without a
  second, cookie-based flash channel that nothing else in the app needs yet.
- **No `<dialog>`/modal component was built.** The brief's "confirmation
  dialogs for destructive actions" has no destructive action to confirm yet -
  the first `DELETE`-shaped action arrives in Phase 8. Building a modal with
  zero call sites would be exactly the kind of speculative, unused code this
  project's own working rules rule out. Deferred explicitly, not silently
  dropped.

### Issue register

Closes `UX-07` (deliberate brand colour, no gradients, no emoji icons),
`UX-08` (working hamburger nav, 44px touch targets, responsive tables),
`UX-09`'s remaining gap (formatting was already centralized in Phase 0; this
phase is the accessibility half), `UX-10`'s contrast requirement
(documented, computed ratios), `UX-11`'s toast half (confirmation dialogs
remain open until Phase 8 has a destructive action).

### Verified manually

- `npm test` — 156 passing.
- A direct HTTP request through the real login flow confirms the toast HTML
  is present in the server's response with the exact welcome message.
- In a live browser: attempting an inline `onclick` against the running
  page's CSP does not fire, confirming the bug this phase fixes was real;
  changing a filter `<select>` now correctly navigates via the external
  script; at a 375px viewport the hamburger toggle is visible, opens the nav
  with `aria-expanded` flipping to `true`, a status chip measures exactly
  44px, and a chart table's `<thead>` clips off-screen while its `<td>`
  elements switch to the labelled-row layout.

---

## Phase 6 — Dashboard charts (2026-08-03)

The six charts specified in the brief, each paired with an accessible data
table built from the exact same numbers.

### Added

- **`chart.js` (^4.5.1)** as a real npm dependency, served same-origin from
  `node_modules/chart.js/dist` via a dedicated static route - not copied into
  `public/vendor/`, not loaded from a CDN.
- **`src/lib/safeJson.js`** — escapes chart data for safe embedding inside a
  `<script type="application/json">` tag.
- **New dashboard repository queries**: `weightByLot`, `activeAnimalDemographics`,
  `monthlyWeightByLot`, `monthlyGmdByLot`, `monthlyCostByCategory`.
- **`src/services/chartDataService.js`** — assembles each chart's
  labels/series *and* its table rows from one query pass, so the visual and
  the accessible fallback can never disagree.
- **`public/js/charts.js`** — vanilla script (no bundler) that reads the
  embedded JSON and renders: a status donut with a centre total and a
  percentage legend; a "Peso médio por lote" bar chart with value labels and a
  herd-average reference line; a grouped bar for herd composition by age range
  and sex; two line charts (weight evolution, GMD curve) over a trailing
  12-month window, one series per lote; and a stacked bar for costs by
  category.
- **`docs/business-rules.md`** — age-range classification documented as a
  stated approximation.
- **13 new tests** for the chart-data layer, plus a 17-check and then a
  browser-driven runtime pass against the seeded data.

### Decisions

- **Chart.js is served from its own npm package, not vendored as a file in
  `public/`.** The baseline design document said "vendored locally in
  `public/vendor/`"; serving directly from the installed dependency achieves
  the same goal - same-origin, no CDN, works offline - without a second copy of
  the library to keep in sync with `package.json`. Recorded here as a
  deliberate deviation from that document, not an oversight.
- **Weight and GMD trend charts are not restricted to active animals.** This
  is the opposite of the Phase 4 KPI cards, deliberately: a historical trend
  legitimately includes weighings from an animal later sold or that died,
  since those weighings are facts about the period being charted. Excluding
  them would be survivorship bias - the "Peso médio (última pesagem)" KPI and
  the "Evolução do peso médio" chart correctly answer different questions.
- **The trend charts use a fixed trailing 12-month window**, independent of
  the Fase 5 Período filter. A "últimos 30 dias" window would leave a
  monthly-bucketed line chart with one or two points. The lote filter does
  apply to every chart.
- **Herd composition is classified by age alone.** The five categories
  (bezerro, novilha, boi, vaca, touro) properly depend on reproductive status,
  which this schema does not track. The approximation is stated in the UI
  copy and in `docs/business-rules.md` rather than silently baked in.
- **Chart data is embedded as JSON in the page, not fetched separately.** One
  request instead of two, and it keeps the chart working the moment the page
  finishes loading rather than after a second round trip - relevant on the
  weak connections this project targets.
- **Every chart has a real `<table>`, not a decorative one.** If
  `public/js/charts.js` never runs, the table is still there with the same
  numbers the chart would have shown - the chart is a visualisation of data
  that already exists on the page, not the only place the data lives.

### Issue register

Closes `UX-01` (donut has a fixed-height wrapper, a legend with counts and
percentages, and a centre total - no longer oversized), `UX-02` (bar chart has
axis units, value labels, sorting, and a reference line - no longer dead
space), `UX-10` (every chart has role="img", an aria-label, and an ARIA text
alternative table).

### Verified manually

- `npm test` — 148 passing.
- A 17-check pass against the running server with seeded data: the embedded
  JSON's herd-status total and composition total match the KPI cards exactly
  (130 and 112); both time-series charts span exactly 12 months; the CSP gained
  no `unsafe-inline` or `unsafe-eval`; six accessible tables are present.
- A browser-driven pass (login, then inspect the live page via
  `Chart.getChart()`): all six canvases instantiated with the correct chart
  type (doughnut / bar / line) and non-zero dimensions, with no console errors.

---

## Phase 5 — Dashboard v1 (2026-08-03)

Replaces the placeholder home page with a working dashboard: URL-persisted
filters, KPI cards with tooltips and genuine empty states, and an actionable
alerts panel.

### Added

- **`src/lib/period.js`** — resolves the Período preset (mês atual / 30 / 90 /
  180 dias / este ano / personalizado) into a half-open date range.
- **`src/repositories/farmRepository.js`**, **`lotRepository.js`** — scoped
  lookups for the filter dropdowns.
- **`src/services/dashboardFilters.js`** — reads and validates the `lote`,
  `status` and `periodo` query parameters; builds filter-preserving query
  strings for the status chips.
- **`src/views/dashboard.ejs`** — filter bar, KPI grid, alerts panel, herd
  empty state, and a collapsed diagnostics panel (permissions, migrations).
- **Lot filtering added to every dashboard repository function** (§ below).
- **34 new tests**: period presets, filter resolution and scoping, and the
  lote filter narrowing every KPI end to end.
- **An 18-check manual pass** against the running server with the seeded data.

### Decisions

- **Filters persist through a plain GET `<form>`, not JavaScript.** Submitting
  reloads the page with every selection already encoded in the URL query
  string — which is literally what "persisted in the URL" requires, and it
  keeps working with a slow connection or JavaScript disabled. The `onchange`
  auto-submit on each `<select>` is progressive enhancement; the submit button
  is never removed, so the form still works if that fails to fire.
- **Every dashboard query accepts an optional `{lotId}`.** The clause is
  `(? IS NULL OR a.lot_id = ?)`, always present, a no-op when `lotId` is
  `null`. The filtered and unfiltered case are one statement, not two — so
  there is no second code path that could drift out of sync with the first.
- **A lote's cost figure excludes farm-wide overhead.** When a lote is
  selected, only costs allocated directly to it (`costs.lot_id = lotId`) are
  summed; a farm-wide cost (`lot_id IS NULL`) is not silently absorbed into a
  single lote's number.
- **Weight and GMD do not have a period dimension**, because they measure the
  herd *now*, not a sum over a range — there is nothing for the period filter
  to narrow there. Only the cost card changes with it. This is inherent to what
  those two KPIs are, not an implementation gap.
- **The status filter is a display slice, not an override of the business
  rules.** Weight, GMD and the alert counts always use `status = 'ativo'`
  regardless of the selected status, per the formulas proven in Phase 4. The
  filter instead drives the herd-composition legend, which doubles as its own
  control: clicking a status chip re-submits the dashboard with that status
  selected. Selecting "Vendido" narrows the herd count shown, but does not
  change the weight or GMD cards — this is called out in the UI copy so it does
  not read as a bug.
- **Out-of-scope or malformed filter values are dropped, not rejected.** A bad
  `?lote=` or `?status=` degrades to "no filter" rather than a 403 or 500 —
  unlike `?fazenda=`, which remains a hard tenant-security boundary enforced in
  `middleware/tenant.js` and unchanged by this phase.
- **KPI cards and the alerts panel are not yet linked to filtered list
  screens**, because those screens (Animais, Vacinas/Tratamentos) do not exist
  until Phases 8 and 10. Faking the links would ship dead ends; building
  throwaway stub pages would duplicate work Phase 8 does properly. The status
  chips are real and interactive today because they operate on the dashboard
  itself, which does exist. The alerts panel says as much in its own copy.
- **No skeleton loading state.** Skeleton loaders cover the gap while a client
  fetches data asynchronously; this page is rendered fully on the server before
  it reaches the browser, so there is no loading gap to skeleton over. Adding
  one would be decoration with no function.

### Issue register

Closes `UX-03` (alerts state counts and populations, not bare badges), `UX-04`
(status chips are clickable and reflect the current filter), `UX-05` (global
filters, persisted in the URL, respected by every KPI), `UX-06` (herd and cost
empty states with explanatory copy).

### Verified manually

- `npm test` — 135 passing.
- Against the running server with the seeded data: total 130 animals;
  `?fazenda=<Santa Clara>` narrows to 30 animals / 18 active; `?periodo=90`
  relabels the cost card to "Custos (últimos 90 dias)"; `?status=vendido`
  highlights 12; `?lote=99999&status=xyz&periodo=whatever` returns 200 and
  falls back to the defaults rather than erroring; the Santa Clara manager's
  farm select shows only their own farm. 18/18 checks passed.

---

## Phase 4 — KPI services (2026-08-03)

The dashboard's arithmetic, with a proof for each figure. This is the phase that
turns the two reported defects into tested code.

### Added

- **`src/domain/constants.js`** — every domain magic number named with its unit
  and justification: `ANIMAL_UNIT_KG = 450`, `ARROBA_KG = 15`,
  `STALE_WEIGHING_DAYS = 60`, `UPCOMING_WINDOW_DAYS = 30`.
- **`src/repositories/dashboardRepository.js`** — one function per KPI, each a
  single inspectable statement.
- **`src/services/kpiService.js`** — assembles the view model.
- **`src/middleware/tenant.js`** — added `namedInClause`.
- **`docs/business-rules.md`** — every formula with units, reasoning and proof.
- **22 KPI tests**, all hand-verifiable from a small hostile fixture.

### Decisions

- **The GMD exclusion is enforced by the join**, not by application logic. An
  animal with one weighing has no row at `rn = 2`, so the inner join drops it
  from numerator and denominator both. There is no code path that could
  accidentally count it as zero.
- **Overdue counts report doses *and* distinct animals.** One animal
  legitimately carries several overdue doses, so a bare "72" invites the reader
  to assume 72 animals — the confusion behind the original report. The interface
  can now say "72 doses atrasadas em 41 animais".
- **`entryCount` accompanies every sum.** It is the only thing that
  distinguishes "nothing recorded" from "records summing to zero", and therefore
  the only thing that stops the cost card rendering `R$ 0,00` when the honest
  answer is `—`.
- **Negative GMD is displayed, not clamped.** Dry-season weight loss is real, and
  hiding it would suppress exactly the animals a manager needs to see.
- **Named parameters where a query repeats a value.** SQLite will not mix named
  and anonymous placeholders in one statement, so the alert query — which
  repeats `:today` five times — binds its tenant scope by name via
  `namedInClause`.

### Issue register

Closes `BUG-01` (status filter mandatory), `BUG-02` (`applied_date IS NULL`
mandatory), `BUG-04` (single many-to-one join, fan-out structurally impossible),
`BUG-05` (single-weighing animals excluded), `BUG-06` (latest weighing per
animal, not all weighings), `BUG-07` (null rather than zero), `PERF-03` (seven
aggregates rather than per-animal queries). Application half of `BUG-03`.

### Verified manually

- `npm test` — 108 passing.
- Against the seeded herd, the figures cross-check: 100 + 30 = 130 animals;
  costs partition exactly (R$ 24.291,24 + R$ 35.875,64 = R$ 60.166,88);
  109 weighed + 3 never weighed = 112 active; and 109 − 101 = 8 animals with
  exactly one weighing, correctly excluded from GMD.
- Santa Clara's finishing herd reports 0,614 kg/dia against Boa Vista's pasture
  herd at 0,267 kg/dia — the model behaving as intended.
- Overdue counts read zero because the sanitary calendar is not seeded yet,
  which is correct rather than broken.

---

## Phase 3 — Demo dataset (2026-08-03)

A herd that tells a coherent story: a breeding and rearing operation
(Fazenda Boa Vista, MS) that sends its young stock to a finishing operation
(Fazenda Santa Clara, MT), across eighteen months.

### Added

- **`src/lib/dates.js`** — ISO date arithmetic used by both the seed and, from
  Phase 4, the KPI services: `addDays`, `addMonths`, `daysBetween`,
  `startOfMonth`, `startOfNextMonth`, `ageInMonths`.
- **`seeds/lib/random.js`** — seeded mulberry32 generator plus helpers.
- **`seeds/lib/growth.js`** — the weight model.
- **`seeds/demo.js`** (`npm run seed`) — the dataset itself.
- **25 new tests** covering date arithmetic, generator reproducibility and the
  growth model.

### The dataset

| | |
| --- | ---: |
| Fazendas / lotes / pastos | 2 / 6 / 4 |
| Animais | 130 (112 ativos, 12 vendidos, 4 mortos, 2 transferidos) |
| Pesagens | ~720 over 18 months |
| Movimentações | ~420 |
| Vendas | 3 events, 12 animals |
| Custos | ~120 entries across 18 months |
| Lembretes | 5 |

Demo accounts, password `Gado@2026`:

| E-mail | Papel | Fazendas |
| --- | --- | --- |
| `admin@gadomanager.com.br` | admin | ambas |
| `gerente@boavista.com.br` | gerente | Boa Vista |
| `gerente@santaclara.com.br` | gerente | Santa Clara |
| `peao@boavista.com.br` | peão | Boa Vista |

### Decisions

- **The seed is deterministic.** A fixed seed means `npm run seed` produces the
  same herd every time. A dataset that changed between runs would make thesis
  screenshots disagree with the running system, and would make a defect found
  during the defense impossible to reproduce.
- **The dataset is shaped to exercise the rules the dashboard must get right.**
  Three active animals have no weighing at all and five have exactly one, so the
  GMD average has a real population it must *exclude* rather than count as zero,
  and the "sem pesagem" card is not empty. Sold and dead animals stop being
  weighed on their exit date, so any query that forgets to filter by status
  produces visibly wrong numbers instead of plausible ones.
- **Growth is modelled, not randomised.** Life phase, seasonal forage quality and
  a fixed per-animal factor. The dry season (May–September) depresses gain, and
  the lightest animals on pasture genuinely lose weight — which is what gives
  the GMD curve a shape worth charting and gives Phase 9's outlier detection
  something real to find. Observed seasonal spread: ~0,51 kg/dia in January
  against ~0,25 kg/dia in July.
- **Cattle are sold heaviest-first.** Selecting at random produced 380 kg
  animals at the abattoir, which no buyer would accept. Sorting by simulated
  weight on the sale date moved the sales to 474–557 kg and 17–20 @, which is
  the real commercial window.
- **Sale weights carry measurement noise**, like any scale reading. Without it,
  animals that had converged on the same growth asymptote all shipped at an
  identical weight.

### Deliberately not seeded

**Vaccines and treatments.** The sanitary calendar is pending confirmation of
the protocol list and the farms' states. Brazil's recognition as free of
foot-and-mouth disease without vaccination in 2025 makes a routine *febre
aftosa* calendar anachronistic for a 2026 dataset, and a vaccination schedule
invented for a thesis would be indefensible. `health_protocols` and
`health_events` are created and empty.

### Verified manually

- `npm test` — 86 passing.
- `npm run seed` — reproducible, no integrity flags: no weighing is negative,
  in the future, before the animal's birth, or after it left the herd.
- Average weight ranks correctly by lot: Engorda > Matrizes > Recria Machos >
  Recria Fêmeas > Bezerros.
- Logged into all four demo accounts against the running application: admin
  sees 130 animals, the Boa Vista manager 100, the Santa Clara manager 30 — an
  exact partition with no overlap — and the peão sees the same herd as the
  manager but `Registrar vendas` reads *negado*.

---

## Phase 2 — Authentication, roles and tenant isolation (2026-08-03)

Login, the three-role permission model, CSRF protection, security headers, and
the multi-tenant scoping that Priority 5 requires a test for.

### Added

- **`src/domain/permissions.js`** — the capability matrix. Authorization is one
  readable table rather than `if (role === 'admin')` scattered through handlers.
- **`src/lib/password.js`** — Argon2id hashing via `@node-rs/argon2`, with OWASP
  parameters stated explicitly (m = 19456 KiB, t = 2, p = 1).
- **`src/services/authService.js`** — the login decision, isolated from HTTP.
- **`src/repositories/userRepository.js`**, **`src/repositories/animalRepository.js`**
  — all prepared statements with bound parameters.
- **`src/middleware/session.js`** — SQLite-backed sessions, 8-hour lifetime,
  `HttpOnly` + `SameSite=Lax` + `secure` in production, non-default cookie name.
- **`src/middleware/csrf.js`** — synchronizer token pattern, written directly
  rather than pulled from a package.
- **`src/middleware/auth.js`** — `loadUser`, `requireLogin`, `requireCapability`.
- **`src/middleware/tenant.js`** — `resolveTenantScope`, `requireFarmAccess`,
  `inClause`.
- **`src/routes/auth.js`**, **`src/views/auth/login.ejs`** — login and logout.
- **`scripts/create-user.js`** (`npm run user:create`) — the application has no
  public sign-up by design; this is how the first administrator is created.
- **helmet** with an explicit content security policy restricted to same-origin.
- **41 new tests**: the capability matrix, password hashing, the login decision,
  and multi-tenant isolation.

### Decisions

- **CSRF is implemented, not imported.** It is about forty lines, the mechanism
  must be explained in the thesis regardless, and the usual Express package
  (`csurf`) is deprecated. Token comparison uses `crypto.timingSafeEqual`.
- **The session id is regenerated on login.** Without it, an attacker who fixed
  a known session id in the victim's browser beforehand would still hold a valid
  id afterwards (session fixation).
- **Failed logins are indistinguishable.** "No such account" and "wrong
  password" return the identical result, and the unknown-account path verifies
  against a decoy hash so it is not measurably faster. Otherwise the login form
  becomes an account-enumeration oracle.
- **The user is re-read from the database on every request** rather than trusted
  from the session, so deactivating an account takes effect immediately instead
  of at the user's next login.
- **`requireCapability` fails closed.** An unrecognised capability name denies
  everyone, so a typo in a route definition cannot silently grant access.
- **An empty tenant scope compiles to `IN (NULL)`**, which matches no row. The
  dangerous failure mode would be an empty scope degrading into an absent
  filter; there is a test for exactly that.
- **The post-login redirect target is validated.** Only same-site absolute paths
  are honoured, so `/login?next=https://…` cannot turn the application into a
  redirector for a phishing page.

### Issue register

Closes `SEC-02` (Argon2id), `SEC-03` (CSRF), `SEC-04` (EJS escapes by default
and the CSP forbids inline script), `SEC-05` (server-side authorization),
`SEC-06` (tenant isolation, with tests), `SEC-08` (security headers and session
hardening).

### Verified manually

- `npm test` — 61 passing.
- A 21-check end-to-end pass against a running server: anonymous access
  redirects to login; `/health` stays public; CSP, `nosniff`, `frame-ancestors`
  and cookie flags are set; POST without a token and POST with a forged token
  are both refused with 403; a wrong password returns 401 with a generic
  message; a correct login issues a new session cookie; `?fazenda=999` returns
  403 while `?fazenda=1` returns 200; and an external `next` target is stripped.

---

## Phase 1 — Database schema (2026-08-03)

The complete data model as three numbered migrations. 16 domain tables, 24
indexes, 14 schema-integrity tests.

### Added

- **`migrations/001_initial_schema.sql`** — every table: `users`, `farms`,
  `user_farms`, `pastures`, `lots`, `animals`, `weighings`, `health_protocols`,
  `health_events`, `movements`, `sales`, `sale_items`, `deaths`,
  `cost_categories`, `costs`, `reminders`.
- **`migrations/002_indexes.sql`** — 24 indexes, each justified by a named
  access path in a comment. No index exists that no query uses.
- **`migrations/003_cost_categories.sql`** — the five cost categories as
  reference data.
- **`tests/helpers/testDb.js`** — builds an in-memory database by running the
  real migrations, so tests exercise the shipping schema rather than a copy.
- **`tests/integration/schema.test.js`** — 14 tests asserting the database
  rejects invalid data without help from the application.

### Decisions

- **Dates carry a `GLOB` format check.** Every date column enforces
  `[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]`, so a localized `dd/MM/yyyy`
  string cannot be stored even by a direct SQL statement. This is the database
  half of the fix for `BUG-03`; storing a Brazilian-format date is what makes a
  month filter silently match nothing.
- **Vaccines and treatments share `health_events`** with a `kind`
  discriminator, as confirmed. One overdue query, which therefore cannot
  diverge between the two modules.
- **`status = 'transferido'` means the animal left the managed herd** to a third
  party. Moves between the owner's own farms keep the animal `ativo` and are
  recorded in `movements`.
- **Death cause is a constrained list** (`doenca`, `acidente`, `predador`,
  `parto`, `desconhecida`, `outra`) plus a free-text note, so mortality is
  reportable by cause.
- **Date-dependent rules are not CHECK constraints.** SQLite forbids
  non-deterministic functions such as `date('now')` inside `CHECK`, so "no
  weighing in the future" and "no vaccine before the birth date" are enforced in
  the service layer in Phase 12. Recorded here so the omission is not mistaken
  for an oversight.
- **`sale_items.animal_id` is `UNIQUE`**, which is what makes "an animal already
  sold cannot be sold again" a database guarantee rather than a UI check.

### Issue register

Closes `DAT-01` (ear tag unique per farm, reusable across farms), `DAT-02`
(one weighing per animal per day), `DAT-03` (enumerations constrained),
`DAT-05` (money as integer centavos), `DAT-06` (an animal sells once),
`PERF-01` (indexes on foreign keys and dashboard date columns). Database half
of `BUG-03`. `SEC-01` holds by construction — every statement is prepared with
bound parameters.

### Verified manually

- `npm run migrate` applies all three; a second run reports "up to date".
- `npm run migrate:status` lists all three as applied.
- `npm test` — 35 passing.
- Resulting database: 16 domain tables, 24 custom indexes, 5 cost categories.

---

## Phase 0 — Foundation (2026-08-03)

Project skeleton and the two utilities that later phases depend on.

### Added

- **Project scaffolding** — `package.json` (ESM, Node >= 20.11), `.gitignore`,
  `.env.example` documenting the full configuration contract.
- **`src/config/env.js`** — the only module that reads `process.env`. Fails fast
  in production on a weak `SESSION_SECRET`.
- **`src/config/db.js`** — shared SQLite connection. Sets `foreign_keys = ON`,
  `journal_mode = WAL`, `busy_timeout` and `synchronous = NORMAL` on every
  connection.
- **`src/db/migrate.js`** — migration runner. Applies numbered `.sql` files in
  order, once each, inside individual transactions, tracked in
  `schema_migrations`. Refuses to run if an already-applied migration was edited
  on disk.
- **`src/lib/format.js`** — centralized pt-BR presentation layer: dates
  `dd/MM/yyyy`, decimals with comma, thousands with dot, `R$ 1.234,56`,
  `1.234,5 kg`, `0,850 kg/dia`, `1,25 UA/ha`, `18,50 @`, plus age in years and
  months. Absent values render as an em dash.
- **`src/lib/safeMath.js`** — `safeDivide`, `safeAverage`, `safePercent`,
  `safeSum`. A calculation with no meaningful answer returns `null`, never
  `NaN`, `Infinity` or a misleading zero.
- **`src/app.js` / `src/server.js`** — Express application and bootstrap,
  separated so tests can mount the app without opening a port. Warns on pending
  migrations at startup.
- **`src/middleware/errors.js`** — `HttpError`, 404 handler and a central error
  renderer that suppresses internal error text in production.
- **Base stylesheet** — design tokens only (spacing scale, type scale, semantic
  colour palette), skip link, visible focus states. The full design system is
  Phase 7; these tokens exist now so that phase extends this file rather than
  replacing it.
- **21 unit tests** covering both utilities, including the two rules the
  dashboard's correctness depends on.

### Decisions

- **Date storage is ISO `YYYY-MM-DD` text, formatted only at the view layer.**
  `formatDate` splits the string rather than parsing it through `new Date()`,
  because `new Date('2026-03-01')` is UTC midnight and renders as 28/02 in
  Brazil (UTC-3) — a silent off-by-one-day bug on every date in the system.
  There is a regression test for this.
- **Money is stored as integer centavos** and converted to reais only in
  `formatCurrency`, so repeated addition cannot accumulate floating-point error.
- **`better-sqlite3` pinned to `^13`** rather than `^11`. Version 11 has no
  prebuilt binary for Node 24 and falls back to compiling from source, which
  requires Python and MSVC build tools. Version 13 ships a prebuild and installs
  in about a second on a clean machine — which matters because this project has
  to install on an examiner's machine without a compiler toolchain.

### Issue register

Closes `CQ-01` (service/repository layering established), `CQ-03` (migration
history), `DAT-07` (foreign key enforcement enabled per connection). Groundwork
laid for `BUG-07` and `UX-09`.

### Verified manually

- `npm test` — 21 passing.
- `npm start` — server boots, `GET /health` returns `{"status":"ok"}`,
  confirming the database connection is usable.
- `GET /` renders with correct pt-BR formatting and shows an em dash for absent
  values.
- An unknown route returns 404 through the central error handler.
