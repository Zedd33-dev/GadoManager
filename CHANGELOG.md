# Changelog

All notable changes to GadoManager, organised by the execution phases defined in
[`docs/00-baseline-design.md`](docs/00-baseline-design.md).

This file doubles as evidence of methodology for the written thesis: each phase
records what was built, why, and what it closes from the issue register.

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
