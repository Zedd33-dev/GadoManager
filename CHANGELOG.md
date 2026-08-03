# Changelog

All notable changes to GadoManager, organised by the execution phases defined in
[`docs/00-baseline-design.md`](docs/00-baseline-design.md).

This file doubles as evidence of methodology for the written thesis: each phase
records what was built, why, and what it closes from the issue register.

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
