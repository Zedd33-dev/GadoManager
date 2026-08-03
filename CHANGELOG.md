# Changelog

All notable changes to GadoManager, organised by the execution phases defined in
[`docs/00-baseline-design.md`](docs/00-baseline-design.md).

This file doubles as evidence of methodology for the written thesis: each phase
records what was built, why, and what it closes from the issue register.

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
