-- Migration 001 - Initial schema
--
-- Conventions applied throughout, each chosen to remove a class of defect:
--
--   Dates are TEXT in ISO 'YYYY-MM-DD'. A GLOB check enforces the format at the
--   database level, so a localized 'dd/MM/yyyy' string can never be stored. That
--   is the root cause behind a month filter silently matching nothing and a cost
--   card reading R$ 0,00 (issue BUG-03).
--
--   Money is INTEGER centavos. Repeated addition of REAL currency accumulates
--   floating-point error across a herd's accumulated costs (issue DAT-05).
--
--   Enumerations are TEXT with a CHECK constraint, so an invalid status cannot be
--   written even by a direct SQL statement (issue DAT-03).
--
--   Timestamps are TEXT in ISO 8601, set by the application.
--
-- Domain rules that depend on the current date - "a weighing may not be in the
-- future", "a vaccine may not precede the animal's birth" - are NOT expressed as
-- CHECK constraints, because SQLite forbids non-deterministic functions such as
-- date('now') inside CHECK. Those are enforced in the service layer (Phase 12).

-- ---------------------------------------------------------------------------
-- Users and access
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'gerente', 'peao')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE farms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  city          TEXT,
  state         TEXT    CHECK (state IS NULL OR length(state) = 2),
  total_area_ha REAL    CHECK (total_area_ha IS NULL OR total_area_ha > 0),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

-- The multi-tenant backbone. Every query that reads farm-owned data resolves the
-- caller's permitted farm ids through this table and binds them as parameters.
-- There is no code path that reads animal data without it (issue SEC-06).
CREATE TABLE user_farms (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, farm_id)
);

-- ---------------------------------------------------------------------------
-- Farm structure
-- ---------------------------------------------------------------------------

CREATE TABLE pastures (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id          INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name             TEXT    NOT NULL,
  -- Denominator of the stocking rate in UA/ha, so it must be strictly positive.
  area_ha          REAL    NOT NULL CHECK (area_ha > 0),
  forage_type      TEXT,
  rest_period_days INTEGER CHECK (rest_period_days IS NULL OR rest_period_days >= 0),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  UNIQUE (farm_id, name)
);

CREATE TABLE lots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id     INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  UNIQUE (farm_id, name)
);

-- ---------------------------------------------------------------------------
-- Animals
-- ---------------------------------------------------------------------------

CREATE TABLE animals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id              INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,

  -- Ear tag. Unique per farm rather than globally: two farms may legitimately
  -- reuse the same numbering (issue DAT-01).
  ear_tag              TEXT    NOT NULL,

  -- Optional national traceability number, unique across the whole system.
  sisbov               TEXT    UNIQUE,

  birth_date           TEXT    NOT NULL
                         CHECK (birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sex                  TEXT    NOT NULL CHECK (sex IN ('M', 'F')),
  breed                TEXT    NOT NULL CHECK (breed IN ('nelore', 'angus', 'cruzado')),
  origin               TEXT    NOT NULL CHECK (origin IN ('nascido', 'comprado')),

  -- Set only for animals born on the farm; the dam must be an animal on record.
  mother_id            INTEGER REFERENCES animals(id) ON DELETE SET NULL,

  purchase_date        TEXT    CHECK (purchase_date IS NULL OR
                                      purchase_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  purchase_price_cents INTEGER CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0),

  -- Current location. The authoritative history lives in `movements`; these two
  -- columns are maintained inside the same transaction as the movement insert
  -- (issue DAT-04). Denormalized deliberately so that filtering the dashboard by
  -- lote does not require a correlated subquery over movement history.
  lot_id               INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  pasture_id           INTEGER REFERENCES pastures(id) ON DELETE SET NULL,

  -- 'transferido' means the animal left the managed herd to a third party
  -- without being a sale. Moves between the owner's own farms keep the animal
  -- 'ativo' and are recorded in `movements`.
  status               TEXT    NOT NULL DEFAULT 'ativo'
                         CHECK (status IN ('ativo', 'vendido', 'morto', 'transferido')),

  photo_path           TEXT,
  notes                TEXT,
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL,

  UNIQUE (farm_id, ear_tag),

  -- A purchased animal must record when it was purchased.
  CHECK (origin <> 'comprado' OR purchase_date IS NOT NULL),

  -- An animal cannot be its own dam.
  CHECK (mother_id IS NULL OR mother_id <> id)
);

CREATE TABLE weighings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  animal_id  INTEGER NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  weigh_date TEXT    NOT NULL
               CHECK (weigh_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  weight_kg  REAL    NOT NULL CHECK (weight_kg > 0),
  source     TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'lote')),
  notes      TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL,

  -- One weighing per animal per day. Two weighings on the same date would give
  -- the GMD formula a zero denominator (issue DAT-02).
  UNIQUE (animal_id, weigh_date)
);

-- ---------------------------------------------------------------------------
-- Health: protocols and events
-- ---------------------------------------------------------------------------

CREATE TABLE health_protocols (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id         INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('vacina', 'tratamento')),
  product         TEXT,
  dose            REAL    CHECK (dose IS NULL OR dose > 0),
  dose_unit       TEXT,

  -- Withdrawal period in days (periodo de carencia). An animal may not be sold
  -- until this many days have elapsed since application.
  withdrawal_days INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_days >= 0),

  schedule_mode   TEXT    NOT NULL CHECK (schedule_mode IN ('por_idade', 'por_data')),
  age_days        INTEGER CHECK (age_days IS NULL OR age_days >= 0),
  interval_days   INTEGER CHECK (interval_days IS NULL OR interval_days > 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,

  -- Age-based scheduling needs an age to schedule from.
  CHECK (schedule_mode <> 'por_idade' OR age_days IS NOT NULL)
);

-- Vaccines and treatments share one table with a `kind` discriminator.
--
-- The columns, the overdue rule and the carencia rule are identical for both.
-- Two physical tables would mean two copies of the overdue query, and divergence
-- between those copies is a leading hypothesis for the reported anomaly of 72
-- overdue vaccines against 34 animals. The navbar still presents two modules;
-- they are two filtered views over this table.
CREATE TABLE health_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  animal_id          INTEGER NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  protocol_id        INTEGER REFERENCES health_protocols(id) ON DELETE SET NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('vacina', 'tratamento')),
  name               TEXT    NOT NULL,
  product            TEXT,
  dose               REAL    CHECK (dose IS NULL OR dose > 0),
  dose_unit          TEXT,

  -- Populated for treatments only.
  diagnosis          TEXT,

  -- data_prevista: when the dose is due.
  scheduled_date     TEXT    NOT NULL
                       CHECK (scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  -- data_aplicacao: NULL means not yet applied. Combined with scheduled_date and
  -- the animal's status, this is the entire definition of "atrasado".
  applied_date       TEXT    CHECK (applied_date IS NULL OR
                                    applied_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  applicator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Copied from the protocol when the dose is scheduled, so that later edits to
  -- the protocol do not retroactively change a carencia already served.
  withdrawal_days    INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_days >= 0),

  batch_number       TEXT,
  notes              TEXT,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- Movements
-- ---------------------------------------------------------------------------

CREATE TABLE movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  animal_id       INTEGER NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  moved_at        TEXT    NOT NULL,
  from_farm_id    INTEGER REFERENCES farms(id) ON DELETE SET NULL,
  to_farm_id      INTEGER REFERENCES farms(id) ON DELETE SET NULL,
  from_lot_id     INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  to_lot_id       INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  from_pasture_id INTEGER REFERENCES pastures(id) ON DELETE SET NULL,
  to_pasture_id   INTEGER REFERENCES pastures(id) ON DELETE SET NULL,
  reason          TEXT,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------

-- A sale is one buyer, one date, one negotiated price per arroba, covering many
-- animals. Splitting the header from the items is what makes per-animal profit
-- computable against that animal's accumulated costs.
CREATE TABLE sales (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id                INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  buyer_name             TEXT    NOT NULL,
  sale_date              TEXT    NOT NULL
                           CHECK (sale_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  price_per_arroba_cents INTEGER NOT NULL CHECK (price_per_arroba_cents > 0),
  notes                  TEXT,
  created_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at             TEXT    NOT NULL,
  updated_at             TEXT    NOT NULL
);

CREATE TABLE sale_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,

  -- An animal can be sold exactly once (issue DAT-06).
  animal_id         INTEGER NOT NULL UNIQUE REFERENCES animals(id) ON DELETE CASCADE,

  live_weight_kg    REAL    NOT NULL CHECK (live_weight_kg > 0),

  -- Carcass yield as a percentage of live weight. Values outside this band
  -- indicate a data-entry error rather than a real animal.
  carcass_yield_pct REAL    NOT NULL CHECK (carcass_yield_pct BETWEEN 40 AND 65),

  -- Derived: live_weight_kg * carcass_yield_pct / 100 / 15. Stored so that a
  -- historical sale is not silently restated if the conversion constant is ever
  -- revisited.
  arrobas           REAL    NOT NULL CHECK (arrobas > 0),
  gross_value_cents INTEGER NOT NULL CHECK (gross_value_cents >= 0),
  created_at        TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- Deaths
-- ---------------------------------------------------------------------------

-- Kept separate from animals.status so that mortality is reportable by cause
-- rather than inferred from a flag.
CREATE TABLE deaths (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  animal_id  INTEGER NOT NULL UNIQUE REFERENCES animals(id) ON DELETE CASCADE,
  death_date TEXT    NOT NULL
               CHECK (death_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  cause      TEXT    NOT NULL
               CHECK (cause IN ('doenca', 'acidente', 'predador', 'parto', 'desconhecida', 'outra')),
  notes      TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- Costs
-- ---------------------------------------------------------------------------

CREATE TABLE cost_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE costs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id           INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,

  -- NULL means the cost applies to the whole farm rather than one lote.
  lot_id            INTEGER REFERENCES lots(id) ON DELETE SET NULL,

  category_id       INTEGER NOT NULL REFERENCES cost_categories(id),
  cost_date         TEXT    NOT NULL
                      CHECK (cost_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  description       TEXT,
  is_recurring      INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0, 1)),
  recurrence_months INTEGER CHECK (recurrence_months IS NULL OR recurrence_months > 0),
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,

  CHECK (is_recurring = 0 OR recurrence_months IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------

CREATE TABLE reminders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id          INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  title            TEXT    NOT NULL,
  description      TEXT,
  due_date         TEXT    NOT NULL
                     CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- NULL means still open. A timestamp means done.
  done_at          TEXT,

  recurrence       TEXT    NOT NULL DEFAULT 'nenhuma'
                     CHECK (recurrence IN ('nenhuma', 'semanal', 'mensal', 'anual')),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);
