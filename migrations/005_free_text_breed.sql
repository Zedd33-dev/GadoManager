-- requires: foreign_keys=off
-- Migration 005 - Free-text breed
--
-- The marker on the line above tells the migration runner (src/db/migrate.js)
-- to disable foreign key enforcement for this file instead of running it in
-- an ordinary transaction. Skipping that would silently delete every row in
-- every table that references `animals` with ON DELETE CASCADE (weighings,
-- health_events, movements, sale_items, ...) the moment the old `animals`
-- table is dropped below - confirmed empirically, not a theoretical risk.
-- See the comment on REQUIRES_FK_REBUILD in migrate.js for the full account.
--
-- Breed was restricted to a three-value CHECK ('nelore', 'angus', 'cruzado'),
-- which was accurate for the demo herd but wrong as a general rule: a real
-- farm may run any breed or cross (Brahman, Gir, Girolando, Senepol, Guzera,
-- Tabapua, Brangus, and so on). Restricting the column to an enum baked a
-- narrower assumption into the schema than the domain actually has.
--
-- SQLite cannot drop a column CHECK constraint directly, so the table is
-- rebuilt: a new `animals` table without the breed CHECK, the existing rows
-- copied across (translating the three old slugs to the display text they
-- already meant, so existing data does not need a lookup table to render),
-- the old table dropped, and the new one renamed into its place. DROP TABLE
-- does not cascade-delete rows in tables that reference it by foreign key
-- (weighings, health_events, movements, sale_items, ...) - those keep
-- pointing at the same animal ids, which are preserved unchanged by the
-- SELECT below.

CREATE TABLE animals_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id              INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  ear_tag              TEXT    NOT NULL,
  sisbov               TEXT    UNIQUE,
  birth_date           TEXT    NOT NULL
                         CHECK (birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sex                  TEXT    NOT NULL CHECK (sex IN ('M', 'F')),

  -- Free text: any breed name, 1-60 characters. No CHECK enum - see the
  -- comment above. The application offers known breeds as suggestions
  -- (a <datalist>, not a restriction) but accepts anything the user types.
  breed                TEXT    NOT NULL CHECK (length(trim(breed)) BETWEEN 1 AND 60),

  origin               TEXT    NOT NULL CHECK (origin IN ('nascido', 'comprado')),
  mother_id            INTEGER REFERENCES animals_new(id) ON DELETE SET NULL,
  purchase_date        TEXT    CHECK (purchase_date IS NULL OR
                                      purchase_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  purchase_price_cents INTEGER CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0),
  lot_id               INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  pasture_id           INTEGER REFERENCES pastures(id) ON DELETE SET NULL,
  status               TEXT    NOT NULL DEFAULT 'ativo'
                         CHECK (status IN ('ativo', 'vendido', 'morto', 'transferido')),
  photo_path           TEXT,
  notes                TEXT,
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL,

  UNIQUE (farm_id, ear_tag),
  CHECK (origin <> 'comprado' OR purchase_date IS NOT NULL),
  CHECK (mother_id IS NULL OR mother_id <> id)
);

INSERT INTO animals_new
  SELECT id, farm_id, ear_tag, sisbov, birth_date, sex,
         CASE breed
           WHEN 'nelore'  THEN 'Nelore'
           WHEN 'angus'   THEN 'Angus'
           WHEN 'cruzado' THEN 'Nelore x Angus (Cruzado)'
           ELSE breed
         END,
         origin, mother_id, purchase_date, purchase_price_cents,
         lot_id, pasture_id, status, photo_path, notes, created_at, updated_at
    FROM animals;

DROP TABLE animals;
ALTER TABLE animals_new RENAME TO animals;

-- Indexes are dropped along with the old table and must be recreated
-- (identical to migration 002 - the rebuild changes no access pattern).
CREATE INDEX idx_animals_farm_status ON animals (farm_id, status);
CREATE INDEX idx_animals_lot ON animals (lot_id);
CREATE INDEX idx_animals_pasture ON animals (pasture_id);
CREATE INDEX idx_animals_birth_date ON animals (birth_date);
CREATE INDEX idx_animals_mother ON animals (mother_id);
