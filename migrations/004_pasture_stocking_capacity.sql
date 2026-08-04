-- Migration 004 - Per-pasture stocking capacity
--
-- The stocking rate itself (UA/ha) is an unambiguous calculation: one animal
-- unit is 450 kg of live weight, so UA/ha = (total live weight / 450) / area.
-- Deciding whether a given rate is *too high*, however, is not universal - it
-- depends on the forage species, soil, rainfall and management of the specific
-- pasture. A well-managed Panicum maximum paddock carries substantially more
-- than a degraded Brachiaria decumbens one.
--
-- Encoding a single global "overgrazing threshold" constant in the application
-- would therefore be inventing a domain rule. Storing the capacity per pasture
-- makes it a parameter of the data - which is what it actually is - and leaves
-- the application free to warn purely by comparison.
--
-- NULL means "capacity not informed", in which case the interface reports the
-- computed rate without passing judgement on it, rather than silently
-- comparing against a number nobody chose.

ALTER TABLE pastures
  ADD COLUMN max_stocking_rate_ua_ha REAL
    CHECK (max_stocking_rate_ua_ha IS NULL OR max_stocking_rate_ua_ha > 0);
