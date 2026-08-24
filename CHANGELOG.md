# Changelog

All notable changes to GadoManager, organised by the execution phases defined in
[`docs/00-baseline-design.md`](docs/00-baseline-design.md).

This file doubles as evidence of methodology for the written thesis: each phase
records what was built, why, and what it closes from the issue register.

Newest first below. For the numbered phases in order, see
[`docs/00-baseline-design.md`](docs/00-baseline-design.md) §5 for the plan
they follow.

## Índice

- [Fix — error page crashed for an anonymous visitor](#fix--error-page-crashed-for-an-anonymous-visitor-2026-08-24)
- [Phase 13 — TCC deliverables](#phase-13--tcc-deliverables-documentation-2026-08-05)
- [Phase 12 — Hardening](#phase-12--hardening-authorization-tenancy-and-query-cost-2026-08-05)
- [Change — a farm-less account browses instead of being blocked](#change--a-farm-less-account-browses-instead-of-being-blocked-2026-08-05)
- [Fix — theme toggle left chart text in the wrong colour](#fix--theme-toggle-left-chart-text-in-the-wrong-colour-2026-08-05)
- [Fix — chart text stuck black in dark mode](#fix--chart-text-stuck-black-in-dark-mode-2026-08-05)
- [Visual polish pass](#visual-polish-pass-2026-08-05)
- [Self-registration and admin user management](#self-registration-and-admin-user-management-2026-08-05)
- [Fixes — free-text breed, header overflow](#fixes--free-text-breed-header-overflow-2026-08-05)
- [UI additions — dark mode, printable report, thumbnails, global search](#ui-additions--dark-mode-printable-report-thumbnails-global-search-2026-08-05)
- [Phase 11 — Vendas, Custos and Lembretes](#phase-11--vendas-custos-and-lembretes-2026-08-04)
- [Phase 10 — Vacinas, Tratamentos, protocolos, carência and Movimentações](#phase-10--vacinas-tratamentos-protocolos-carência-and-movimentações-2026-08-03)
- [Phase 9 — Pesagens, Lotes, Pastos and Fazendas](#phase-9--pesagens-lotes-pastos-and-fazendas-2026-08-03)
- [Phase 8 — Animais module and reusable list infrastructure](#phase-8--animais-module-and-reusable-list-infrastructure-2026-08-03)
- [Phase 7 — Design system, mobile navigation and accessibility](#phase-7--design-system-mobile-navigation-and-accessibility-2026-08-03)
- [Phase 6 — Dashboard charts](#phase-6--dashboard-charts-2026-08-03)
- [Phase 5 — Dashboard v1](#phase-5--dashboard-v1-2026-08-03)
- [Phase 4 — KPI services](#phase-4--kpi-services-2026-08-03)
- [Phase 3 — Demo dataset](#phase-3--demo-dataset-2026-08-03)
- [Phase 2 — Authentication, roles and tenant isolation](#phase-2--authentication-roles-and-tenant-isolation-2026-08-03)
- [Phase 1 — Database schema](#phase-1--database-schema-2026-08-03)
- [Phase 0 — Foundation](#phase-0--foundation-2026-08-03)

---

## Fix — error page crashed for an anonymous visitor (2026-08-24)

Found on the first real deploy (Render, free tier) — the class demo's
login page returned a bare, unstyled "Not Found" the moment anyone hit it.

`errors/error.ejs` references `currentUser` to decide whether to show the
logout button added earlier (a user stuck on a 403 needs a way out).
`res.locals.currentUser` was only ever set on `loadUser`'s authenticated
branch, though. `requireLogin` redirects an anonymous *GET* request that
accepts *html* straight to `/login`, so that common case never reaches
`errorHandler` unauthenticated - but a non-GET or non-HTML request to a
protected route (a health probe, a bot, an API client with no `Accept:
text/html`) gets answered with a plain 401 instead of a redirect, and that
request is still anonymous. Rendering the error page for it threw
`ReferenceError: currentUser is not defined` - EJS does not treat a name
absent from `res.locals` as `undefined`, it throws - which crashed the
*error page itself*, the one template reachable both logged in and out.

`loadUser` now sets `res.locals.currentUser = null` unconditionally before
its early return, so every render has a defined value regardless of which
branch runs. Added `tests/integration/errorPage.test.js` and verified it
the same way every Phase 12 security test was verified: reverted the fix,
confirmed the test failed with the exact production stack trace, restored
it.

---

## Phase 13 — TCC deliverables (documentation) (2026-08-05)

The write-up phase: everything needed for the thesis to stand on its own
without a live walkthrough.

### Added

- **`README.md`** — install/run/test instructions, demo credentials, and an
  upfront pointer to what is provisional (the sanitary calendar and the two
  farms' UF) so it cannot be mistaken for validated domain data.
- **`docs/architecture.md`** — layers, the request lifecycle, multi-tenancy,
  capability-based authorization, security posture, dark mode's one real
  gotcha (Chart.js bakes colour into the canvas at draw time), and a section
  of decisions specifically framed as "worth a defense question."
- **`docs/data-model.md`** — full data dictionary and ER diagram, generated
  by reading the schema directly out of the live database (`sqlite_master`)
  rather than copied from the Phase 0 plan, which had already drifted (that
  plan still shows `breed` as a three-value enum; migration 005 changed it
  to free text three phases ago). The Mermaid diagram was rendered with
  `@mermaid-js/mermaid-cli` before committing, not just visually inspected as
  markdown, to confirm the syntax is actually valid.
- **`docs/requirements.md`** — actors, functional/non-functional
  requirements, and the full capability matrix, cross-referenced to
  `src/domain/permissions.js` so it cannot silently drift from what
  `routeGuards.test.js` already enforces in code.
- A table of contents at the top of this file, since it had grown past 1200
  lines across thirteen phases plus the ad-hoc work between Phase 11 and 12.

### Fixed

- A one-line comment in `scripts/create-user.js` still claimed "the
  application deliberately has no public sign-up" - true when it was
  written, false since `/registrar` shipped between Phase 11 and 12. Caught
  while writing the docs that would have repeated the same stale claim.

---

## Phase 12 — Hardening: authorization, tenancy and query cost (2026-08-05)

The phase that checks the claims the earlier phases made. Its output is
mostly **evidence**, not features: every security property this project
asserts was, until now, verified by someone grepping for it once.

### Added

- **`tests/integration/routeGuards.test.js`** — walks Express's own router
  stack and asserts every registered route either carries a
  `requireCapability` guard or appears on an explicit public allow-list, with
  a stated reason per entry. Also catches two quieter failures: a route
  naming a capability that does not exist (fails closed, so the screen is
  sealed shut for *everyone* including admins, silently), and a `POST` gated
  behind a `:read` capability (which every peão holds). `requireCapability`
  now tags its guard with the capability name to make the stack
  introspectable.
- **`tests/integration/crossTenantAccess.test.js`** — drives real HTTP with
  real sessions against a temporary database to prove no user can reach
  another farm's records by putting an id in the URL (IDOR). Repository-level
  isolation tests would still pass if a *route* forgot to pass `req.scope`;
  only driving the route catches that. Both fixture users are `admin` on
  purpose, so any refusal can only be the farm boundary rather than a missing
  capability — the strongest form of the claim.

### Verified

- **Both suites were confirmed able to fail.** An unguarded route, a
  mistyped capability, a read-gated `POST`, a scope dropped from
  `findWithDetailsInScope`, and a scope dropped from the bulk `DELETE` were
  each injected in turn; each was caught by the expected assertion, and each
  injection was reverted. A test that has never failed proves nothing.
- **No N+1 anywhere.** Every `better-sqlite3` statement *execution* was
  counted per request (executions, not `prepare()` calls — a statement
  prepared once and run in a loop is exactly the shape being hunted). Query
  counts are flat with respect to result size: `/animais` issues 10
  statements at both 25 and 100 rows per page. An N+1 would scale with the
  row count; these do not.

### Fixed

- **The dashboard re-read the lots table 4× per request** (24 statements
  total): three lot-keyed charts each rebuilt the same id→name map, plus the
  filter bar. Built once and shared now — **24 → 22 statements**, and across
  every page measured no statement runs more than twice in one request.
- **The session store's sweep timer kept the Node process alive forever.**
  `better-sqlite3-session-store` starts it with a bare `setInterval`, never
  unref'd and with no handle kept. Invisible in a running server, but any
  process that just builds the app and finishes hangs — the new test suite
  took 2 minutes for 0.7s of work. Now unref'd, which is also correct in
  production: a background janitor should never hold a process open.

### Not changed, and why

Server-side validation was audited route by route and needed no work: every
mutating route already delegates to a `validate*Input` function before
touching the database, and the destructive bulk paths (`/animais/excluir`,
`/pesagens/:id/excluir`) already bind the farm scope into the `DELETE` itself
rather than filtering afterwards. Both are now locked in by the tests above
instead of resting on inspection.

---

## Change — a farm-less account browses instead of being blocked (2026-08-05)

Requested after the registration flow shipped: a freshly self-registered
account used to hit a dedicated 403 wall on every page (`requireFarmAccess`)
until an admin granted a farm. That gate is now removed - every scoped query
already returns "no rows" for an empty farm list, so the account instead
sees the real app with nothing in it (empty lists, zero KPIs, no farm/lot
choices on a create form), the same screens everyone else uses. Role-based
restrictions are untouched: a peao still cannot open Vendas/Custos, farm
access or not. Verified end-to-end across every module with a fresh
zero-farm account - nothing crashes, every list shows a sensible empty
state.

---

## Fix — theme toggle left chart text in the wrong colour (2026-08-05)

The previous fix (reading chart colours from CSS custom properties instead
of a hardcoded copy) was correct on a fresh page load, but the toggle button
itself only changed `[data-theme]` without reloading - every CSS-styled
element restyles live off that attribute, but Chart.js reads colours once,
at chart-creation time, and bakes them into the canvas as pixels. Switching
theme without a reload left already-drawn chart text in whichever colour
had been correct for the *previous* theme: white-on-light after leaving
dark mode, or the reverse. The toggle now reloads the page after saving the
choice, so every chart re-runs its colour read under the new theme like on
any normal load. Verified both directions.

---

## Fix — chart text stuck black in dark mode (2026-08-05)

`Chart.js` draws to a `<canvas>`, which a CSS custom property's dark-mode
value cannot reach the way it reaches an HTML element. Both chart scripts
had copied the light-theme palette as fixed hex strings, so every axis
label, legend entry, tooltip and the dashboard donut's center total stayed
dark-on-dark once dark mode actually shipped. Both now read the same custom
properties via `getComputedStyle` at chart-init time instead, so chart text,
gridlines and series colours all follow whichever theme is actually active.

---

## Visual polish pass (2026-08-05)

A pass across `public/css/app.css` for general appearance, requested without
a specific complaint to fix - see the commit for the full rationale.

### Added

- A restrained elevation system (shadows on cards, buttons, the header, the
  login card), smooth transitions on every interactive element, table
  header/row differentiation, and hover/active states on buttons and chips.
- `--radius-lg` for page-level containers; smaller inline elements (badges,
  chips) keep the original tighter radius.

No colour value in the WCAG-audited palette changed - only shadow, motion
and hover state were added on top of the same already-contrast-checked
tokens, so the documented AA/AAA pairings still hold.

### Fixed

- A themed scrollbar rule (`* { scrollbar-width: thin }`) measurably changed
  Chart.js's initial canvas sizing at some viewport widths, causing
  horizontal overflow at 800px. Confirmed by A/B testing the exact rule.
  Scoped to `html` instead, since the property is inherited and needed no
  broader reach. Verified no overflow from 375px to 1920px, both themes.

---

## Self-registration and admin user management (2026-08-05)

### Added

- **Public "Criar conta" (`/registrar`)**, linked from the login page. A new
  account starts as `peao` with zero rows in `user_farms` - the existing
  SEC-06 guarantee (a user with no farm grants can address no farm data)
  means registering can never itself grant access to anything; it only
  becomes useful once an admin assigns a role and farms.
- **`/usuarios`** (capability `users:manage`, already defined but unused
  until now): lists every account and lets an admin change role, grant or
  revoke access per farm via checkboxes, and deactivate/reactivate a login.
  No delete - a user row is referenced by `health_events`, `movements` and
  other history, so removing one would orphan or cascade away that history;
  deactivating keeps the record intact and takes effect immediately, since
  `loadUser` already re-reads the account on every request.
- An admin cannot demote or deactivate their own account, so a mistake here
  cannot lock every admin out of the one screen that could undo it.
- **20-check end-to-end pass**: registration, duplicate-email rejection, the
  farm-access gate on a fresh account, role/farm changes taking effect live,
  deactivation blocking login itself (not just farm access), gerente/peao
  blocked from `/usuarios`, and the self-protection rule.

---

## Fixes — free-text breed, header overflow (2026-08-05)

Two issues reported after a live look at the running site.

### Changed

- **Breed is free text, not a three-value enum.** `animals.breed` was
  restricted to `'nelore' | 'angus' | 'cruzado'` by a schema CHECK
  constraint - accurate for the demo herd, wrong as a general rule. Migration
  `005_free_text_breed.sql` rebuilds the table with a free-text breed (still
  bounded to 1-60 trimmed characters) and translates the three old slugs to
  the display text they already meant. The animal form now takes any breed,
  offering known breeds as `<datalist>` suggestions rather than restricting
  input to them.
- **Fixed a real data-loss bug in the migration runner**, found while
  writing the above: `DROP TABLE` on a table other tables reference with
  `ON DELETE CASCADE`, with foreign key enforcement on, cascades - it
  silently deleted all 720 seeded weighings the first time this migration
  ran, despite the migration's SQL never mentioning the weighings table. The
  runner now supports a `-- requires: foreign_keys=off` marker for
  migrations that rebuild a referenced table (SQLite's own documented
  procedure for dropping a CHECK constraint), and runs
  `PRAGMA foreign_key_check` afterward as a safety net.

### Fixed

- **The header nav overflowed its own width at desktop sizes.** `.app-nav
  ul` had no `flex-wrap`, so the 13 nav links plus the header search box and
  theme toggle were forced onto one line regardless of viewport width - at
  1280px that line ran roughly 220px past the header, pushing the page into
  horizontal scroll. The nav now wraps onto extra lines inside the header
  bar instead; verified with no horizontal overflow from 375px to 1920px.

---

## UI additions — dark mode, printable report, thumbnails, global search (2026-08-05)

Four visual/functional additions requested outside the phase plan, between
Phase 11 and Phase 12.

### Added

- **Dark mode.** Follows `prefers-color-scheme` by default; a header toggle
  overrides it explicitly and persists the choice in `localStorage`, applied
  by a synchronous `<head>` script (`public/js/theme.js`) so there is no
  flash of the wrong theme on load. Solid-fill controls (primary/danger
  buttons, the active filter chip) keep one colour in both themes — only
  text-on-tinted-background pairs needed a lighter dark-mode variant.
- **Relatório do rebanho** (`/relatorios/rebanho`) — a printable summary
  (herd composition, KPIs, full active-herd roster) that reuses
  `buildDashboardKpis` rather than recomputing the same figures a second
  way. A print stylesheet hides the app chrome and forces a white
  background regardless of the active theme.
- **Photo thumbnails** on the Animais list — a 44px round preview per row,
  or a placeholder circle when no photo was uploaded.
- **Global search** — a header search box, present on every page, that
  submits to `/animais?q=` and reuses the list's existing ear-tag/SISBOV
  filter rather than adding a second lookup path.

No backend/domain logic changed; all four are additive UI on top of
existing repositories and services.

---

## Phase 11 — Vendas, Custos and Lembretes (2026-08-04)

The commercial side of the herd: recording sales at arroba value, tracking
costs (including recurring ones), and simple reminders on the dashboard.

### Added

- **`src/services/saleService.js`** — `calculateSaleValue` (arroba/carcass
  math), `estimateAccumulatedCost` (average cost allocation, explicitly not a
  per-lot trace — see [business-rules.md §11](docs/business-rules.md)),
  `validateSaleItem` (blocks a sale while the animal is under carência) and
  `validateSaleHeader`.
- **`src/services/costService.js`** — `validateCostInput`,
  `expandRecurrence` (a recurring cost becomes N independent dated rows).
- **`src/services/reminderService.js`** — `validateReminderInput`,
  `nextOccurrence` (calendar-aware advancement via `addMonths`, not a fixed
  day count, so semanal/mensal/anual reminders don't drift).
- **`src/repositories/saleRepository.js`**, **`costRepository.js`**,
  **`reminderRepository.js`** — `insertSale` writes the sale header, items
  and marks the animals `vendido` in one transaction; `insertCostBatch` does
  the same for a recurring cost's occurrences.
- **`src/routes/sales.js`**, **`costs.js`**, **`reminders.js`** and their
  views. The sale form disables animals currently under carência and shows
  the release date.
- **"Próximos lembretes" widget** on the dashboard.
- **31 new tests** (unit + integration), plus a 31-check end-to-end pass
  covering the sale/carência block, recurring cost expansion and deletion,
  reminder recurrence, CSV export, and role/tenant isolation (peão blocked
  from creating sales/costs, a farm manager sees only their own sales).

### Fixed

- **Route ordering: `/vendas/:id` was registered before `/vendas/nova`.**
  Express matched "nova" as the `:id` param and 404'd. Every other route
  file was audited for the same pattern; this was the only instance.
- **Positional weight/yield fields on the sale form.** The form rendered
  `liveWeightKg`/`carcassYieldPct` as parallel arrays across every listed
  animal, but the route only processes the selected subset in unspecified
  DB order — a real risk of attributing one animal's weight to another.
  Fields are now keyed by animal id (`liveWeightKg_<id>`), read directly by
  id server-side, removing the ordering dependency. Found in review, not by
  a failing test.
- **Variable shadowing in `reminders.js`.** A handler declared
  `const next = nextOccurrence(...)` while Express's own `next` callback was
  still in scope, which would throw on any earlier `next(err)` call in the
  same function. Renamed to `nextDueDate`. Found in review.
- **A timezone bug in the E2E check script (not the app).** The check that
  verifies a withdrawal-blocked animal is disabled on the sale form used
  `Date.toISOString()` to build "today"'s date; near midnight in a
  UTC-negative timezone that reads as tomorrow, and the app correctly
  rejects a future `appliedDate`, so the dose never got applied and the
  animal was never blocked. Fixed the script to use local date components,
  matching `src/lib/dates.js#todayIso`, and made the check pick an overdue
  event with a real (non-zero) carência instead of trusting whichever
  `/aplicar` link happened to render first.

---

## Phase 10 — Vacinas, Tratamentos, protocolos, carência and Movimentações (2026-08-03)

The sanitary modules and the atomic location update. This is the phase where
the dashboard's alert panel — the original defect report that started the
project — finally has real data behind it.

### Added

- **`src/services/healthService.js`** — carência evaluation, overdue
  classification, protocol scheduling, and validation.
- **`src/services/movementService.js`** — movement legality rules.
- **`src/repositories/healthRepository.js`**, **`movementRepository.js`**.
- **`src/routes/health.js`** (Vacinas, Tratamentos, Protocolos, scheduling,
  applying a dose) and **`src/routes/movements.js`**.
- **Nine views**, plus `public/js/selectAll.js` for the animal pickers.
- **A provisional sanitary calendar in the seed**: 8 protocols across the two
  farms producing ~407 doses, ~340 applied and ~60 genuinely overdue.
- **35 new tests**, plus a 33-check end-to-end pass.

### Fixed

- **The alert panel reported a denominator from a different population.**
  It showed the overdue *vaccine* dose count beside `COUNT(DISTINCT animal_id)`
  taken across vaccines **and** treatments, producing "40 doses de vacina
  atrasadas em 49 animais" — a denominator larger than the numerator, which is
  impossible per kind since a dose belongs to exactly one animal. Now reports
  per-kind animal counts (40 doses em 33 animais), with a regression test.
  Found by this phase's own end-to-end check, and it is precisely the class of
  misleading count the project was started to eliminate.
- **`src/routes/health.js` was accidentally overwritten** — the liveness probe
  already lived there. Recovered from git into `routes/healthcheck.js`, which
  is the clearer name anyway now that a sanitary module exists.

### Decisions

- **The sanitary calendar is data, not code.** No vaccine, product or interval
  is hardcoded: a protocol is a row the user edits at `/protocolos`. Which
  vaccines a herd needs depends on the state, the year and current
  legislation, so a calendar written into source would be indefensible and
  would go stale. The seeded one is labelled PROVISIONAL in the code, in the
  seed's own output, and in `docs/business-rules.md`.
- **The seeded calendar omits febre aftosa deliberately.** Brazil was
  recognised free of foot-and-mouth disease *without vaccination* in 2025, so
  a routine aftosa campaign in a 2026 dataset would be an anachronism an
  examiner could catch.
- **Carência counts from application, never from the scheduled date**, and the
  animal is clear *on* the release day. Where several products overlap the
  latest release date binds, and the interface names which product it is.
- **`withdrawal_days` is copied onto the dose at scheduling time**, not read
  through a join, so editing a protocol cannot retroactively change a carência
  already served.
- **An age-based dose scheduled into the past is kept, not shifted to today.**
  An animal already past the target age genuinely is overdue; moving the date
  forward would hide a real gap behind a tidy schedule.
- **A movement writes history and current location in one transaction**
  (`DAT-04`). A `null` destination leaves that dimension unchanged, so moving
  between paddocks does not disturb the lote. A cross-farm batch that would
  collide with an existing ear tag fails entirely rather than half-moving the
  herd — proven by test.
- **An already-applied dose cannot be applied again**, enforced by
  `applied_date IS NULL` in the `UPDATE` itself, so a double submission cannot
  restart the carência clock from a later date.

### Issue register

Closes the Vacinas, Tratamentos and Movimentações bullets of
`Missing features`, including protocol templates, age- and date-based
auto-scheduling, carência tracking with a sale-blocking warning, and dose,
product and applicator fields. Closes `DAT-04`.

### Verified manually

- `npm test` — 331 passing.
- A 33-check end-to-end pass: Vacinas and Tratamentos are proven to be two
  filtered views over one table with no leakage between them; the overdue
  filter applies all three conditions; a dose can be applied once and not
  twice; a future-dated application is rejected; a movement's atomic update is
  visible on the animal afterwards; a movement changing nothing is rejected; a
  `peão` can read the sanitary lists and apply doses but is blocked
  server-side from creating protocols or movements; and a Santa Clara manager
  sees only `SC-` tagged animals in both the page and the CSV.
- One end-to-end failure turned out to be a false alarm in the check itself —
  a regex matching a hardcoded `placeholder="Ex.: BV-0001"` rather than leaked
  data. Verified against the database and the rendered rows before concluding;
  the placeholder was removed anyway, since showing a Santa Clara user an
  example tag from a farm they cannot see is misleading.

---

## Phase 9 — Pesagens, Lotes, Pastos and Fazendas (2026-08-03)

Four modules, the keyboard-first weighing-day screen, and the two new domain
formulas of this phase: stocking rate in UA/ha and weight-loss outlier
detection.

### Added

- **`migrations/004_pasture_stocking_capacity.sql`** — per-pasture carrying
  capacity.
- **`src/services/stockingRateService.js`** — UA/ha with a three-band status,
  and the honest-denominator handling described below.
- **`src/services/weighingService.js`** — weighing validation, outlier
  detection, batch-row collection.
- **`src/services/structureService.js`** — validation for Fazendas, Lotes and
  Pastos.
- **`src/repositories/weighingRepository.js`**, plus CRUD on the lot, pasture
  and farm repositories.
- **`src/routes/weighings.js`** (list, CSV, single entry, batch entry) and
  **`src/routes/structure.js`** (the three structural modules).
- **`public/js/batchWeighing.js`** — the keyboard rhythm for a weighing day.
- **61 new tests**, plus a 28-check end-to-end pass.

### Decisions

- **GMD is not "recalculated" — there is nothing to recalculate.** The brief
  asks for automatic GMD recalculation on recording a weighing; GMD is never
  stored, so inserting the row *is* the update, with no cache to invalidate
  and no denormalised column that can fall out of step. Rather than build a
  no-op "recalcular" button, the screens show the newly implied GMD after a
  weighing, which is the useful part of the request. The lote and fazenda
  counters are derived the same way.
- **A flagged outlier is a warning, never a rejection.** An animal genuinely
  can lose weight — the seed's dry-season model produces exactly that — so
  refusing the value would corrupt real history to guard against a typo. The
  operator confirms explicitly and it is stored. The threshold is *relative*
  (5%) rather than absolute, so it scales between a 500 kg steer and a 120 kg
  calf.
- **A batch weighing is all-or-nothing.** One bad row writes nothing, verified
  by test at the repository level and end-to-end. A partially applied weighing
  day would leave the operator unable to tell which animals were recorded,
  with no safe way to retry.
- **Enter never submits the batch form**, only advances to the next field. An
  accidental early submit is costly precisely because the batch is atomic.
- **Carrying capacity is stored per pasture, not as a global constant.**
  Whether a rate is too high depends on forage, soil and management; a single
  hardcoded threshold would be an invented domain rule. Where capacity is not
  informed, the interface reports the rate and declines to judge it.
- **The stocking rate reports its own incompleteness.** Animals never weighed
  occupy the pasture but contribute no measurable weight. Rather than exclude
  them silently (understating) or estimate them (inventing data), the figure is
  computed from what is known and labelled *"Valor mínimo"*. A pasture with
  animals but no weighings reports `—`, not `0` — a zero would claim it is
  empty.
- **Fazendas, Lotes and Pastos have no delete, only deactivation.** All three
  are referenced by animals, movements or costs; deleting would orphan history
  or cascade it away. Deactivation is additionally refused while the record
  still holds animals.
- **Creating a farm grants the creator access in the same transaction.** A farm
  outside every user's scope would be unreachable by any screen.

### Fixed

- **A LEFT JOIN phantom-row bug in the pasture occupancy query**, caught by its
  own test: for a pasture with no animals the join emits one row with a NULL
  animal, which `lw.weight_kg IS NULL` counted as an unweighed animal. Every
  empty pasture would have reported "Sem pesagens" instead of a correct rate of
  zero.
- **`parseWeight` mis-parsed a plain decimal point**, also caught by its own
  test: stripping dots unconditionally turned `482.5` into `4825`, a tenfold
  error on a scale reading. Now applies the same rule as `parseCurrencyToCents`
  — dots are only thousands separators when a comma is present.

### Changed

- **Demo pasture areas resized against the herd that grazes them**, and
  capacities seeded. The previous areas (120–140 ha for ~130 head) produced
  stocking rates of 0,14–0,28 UA/ha, roughly five times below a real Brazilian
  operation, and with no capacity seeded the overgrazing warning could never
  fire — a feature nobody could see working. Rates now land at 0,81–1,31 UA/ha,
  with Pasto Fundo deliberately above its capacity so the warning is
  demonstrable with the shipped dataset.

### Issue register

Closes the Pesagens, Pastos, Lotes and Fazendas bullets of `Missing features`,
including batch entry, outlier detection, UA/ha with an overgrazing warning,
and derived counters.

### Verified manually

- `npm test` — 295 passing.
- A 28-check end-to-end pass: the Pesagens list shows the delta and GMD per
  row; a date filter does not blind a row to the weighing that preceded it;
  CSV carries a byte-verified BOM; a batch with an unknown tag returns 400,
  names the offending tag, and — confirmed by a follow-up query — leaves the
  *valid* row of that batch unwritten; a drastic weight drop is flagged with
  its loss percentage and only recorded once explicitly confirmed; a `peão`
  can reach batch weighing (it is their job) but is blocked from creating a
  pasture; a `gerente` can create a pasture but is blocked from creating a
  farm; and a Santa Clara manager sees only their own pasture.
- A browser pass on the batch screen: 20 real input rows render server-side,
  the first tag field is auto-focused, Enter chains tag → weight → next row's
  tag, and Enter is confirmed not to submit the form.

---

## Phase 8 — Animais module and reusable list infrastructure (2026-08-03)

The first full CRUD module, and the list/pagination/sort/search/CSV/bulk-action
infrastructure every later module (Pesagens, Vacinas, Vendas, Custos...)
reuses rather than reimplements.

### Added

- **`src/lib/pagination.js`**, **`src/lib/sorting.js`**, **`src/lib/csv.js`**,
  **`src/lib/queryString.js`** — framework-free, fully reusable. `sorting.js`
  is the one that matters most: a column name can never be a bound SQL
  parameter, so it works by allow-listing `{publicKey: sqlExpression}` and
  falling back to the default for anything else - a SQL-injection attempt in
  `?sort=` is simply an unrecognised key.
- **`src/lib/upload.js`** — photo storage outside `public/`, plus
  `sniffImageType`: validation by the file's actual magic bytes, not the
  browser-supplied (trivially spoofable) `Content-Type`.
- **`src/middleware/upload.js`** — parses multipart bodies globally, at the
  same point as `express.urlencoded()`, so `verifyCsrf` sees `req.body._csrf`
  regardless of which encoding a form used (see Decisions).
- **`src/services/animalService.js`** — list-query parsing and full
  create/edit validation, shared by both routes so a rule fixed once cannot
  stay broken in the other path.
- **`src/repositories/animalRepository.js`** extended with search/sort/
  filter/pagination, `findWithDetailsInScope`, `getTimeline`,
  `getWeightHistory`, `listCandidateMothers`, and scoped insert/update/
  delete. **`pastureRepository.js`** added to match `lotRepository.js`.
- **`src/routes/animals.js`** and three views (`index`, `form`, `show`):
  list with search/filter/sort/pagination/CSV export/bulk delete; a shared
  create/edit form; a detail page with a weight-curve chart (reusing the
  Chart.js pattern from Phase 6) and a merged weighing/health/movement
  timeline.
- **A native `<dialog>` confirmation component** (`partials/confirmDialog.ejs`,
  `public/js/bulkActions.js`) - the component Phase 7 deferred for lack of a
  destructive action. It has one now.
- **51 new tests.**

### Decisions

- **Bulk delete is a real, hard `DELETE`, admin-only.** Every other exit from
  the herd (venda, morte, transferência) is a status change precisely so the
  history survives; this exists only to correct a genuine data-entry mistake,
  which is why `animals:delete` (defined back in Phase 2, unused until now)
  gates it. Cascades to the animal's weighings, health events, movements and
  sale items via the schema's own `ON DELETE CASCADE` - confirmed by test.
- **Multipart bodies are parsed globally, not per-route.** `verifyCsrf` is
  deliberately global so a new route can never forget CSRF protection, and it
  reads `req.body._csrf` - which stays empty for a multipart request unless
  multer already ran. Rather than weaken the "CSRF cannot be forgotten"
  guarantee for file-upload routes, multipart parsing was added to the global
  body-parsing stage, right next to `express.urlencoded()`.
- **An uploaded photo is validated twice.** `multer`'s `fileFilter` only ever
  sees the browser's claimed MIME type, which is just a string the client
  sent. `sniffImageType` reads the actual bytes written to disk against real
  JPEG/PNG/WebP signatures and deletes the file if they do not match -
  closing SEC-07 for real, not by trusting a header.
- **Photos are stored under `data/uploads/`, never `public/`.** Anything under
  `public/` is served to anyone with the URL, with no session check and no
  tenant scope. Photos are only ever served through `GET /animais/:id/foto`,
  which re-checks the animal is in the caller's scope on every request, and
  filenames are random UUIDs so a URL cannot be guessed from an animal's id.
- **The edit form can only set `status` to `ativo` or `transferido`.**
  Setting `vendido` or `morto` directly would create a status with no
  supporting record (no sale, no death entry) - those transitions belong to
  Vendas (Phase 11) and a death-recording flow, both of which will produce
  the right side effects. The disabled options in the form say so.
- **The create form has no photo field.** A photo is added afterward from the
  detail page. Holding an uploaded file across a validation-failure redirect
  would need either a temp-file lifecycle or forcing the user to re-upload on
  every retry; letting the animal exist first and attaching the photo second
  avoids both.
- **Lot/pasture/mother choices are the full scope's list, not
  JavaScript-cascaded by farm.** Consistent with this project's working GET
  forms: an admin managing two farms sees every lot labelled with its farm
  name and picks the right one directly; the server independently verifies
  the choice belongs to the submitted farm, so a mismatched selection is a
  validation error, not a trust boundary.
- **CSV uses a semicolon delimiter with pt-BR-formatted values, not a comma.**
  Every number in this system already renders with a comma decimal
  (`lib/format.js`); a comma-delimited CSV would misparse "1.234,5" into two
  fields the moment a real weight hit a cell. Semicolon is also what Excel's
  Brazilian locale expects without an import wizard, and a UTF-8 BOM is
  prepended so accented characters do not get mangled.

### Issue register

Closes `SEC-07` (upload validated by content and size, stored outside the web
root). Substantially closes the "Animais" bullet of `Missing features` and
the pagination/sorting/search/filter/CSV/bulk-action-bar requirement stated
for every list screen.

### Verified manually

- `npm test` — 234 passing.
- A 26-check pass against the running server with seeded data: search,
  breed/status/sex/lot filters, and sort all narrow correctly; CSV export
  returns the exact filtered set with a verified BOM and semicolon
  delimiter (confirmed via raw byte inspection after the fetch API's
  automatic BOM-stripping produced a false negative in the first pass);
  create rejects invalid input with 400 and field-level errors rather than
  crashing; a full create → edit → delete round trip on a real record ends
  with the id returning 404; a `gerente` account is blocked server-side
  (403, not just a hidden button) from bulk delete; a `peão` account is
  blocked server-side from the create form; and a Santa Clara manager
  requesting a Boa Vista animal's id gets 404, not the record.
- A browser-driven pass: selecting two rows shows the bulk bar with the exact
  count; the confirm dialog opens with a message naming that count; Cancel
  closes it with `returnValue: "cancel"` and does not submit; the weight
  chart on a real animal's detail page initializes as a `line` chart with the
  correct number of data points, no console errors.

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
