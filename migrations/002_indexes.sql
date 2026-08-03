-- Migration 002 - Indexes
--
-- Every index here supports a specific access path that the dashboard or a list
-- screen actually uses (issue PERF-01). Indexes that are not justified by a real
-- query are omitted: each one costs write throughput and disk.
--
-- SQLite creates indexes automatically for PRIMARY KEY and UNIQUE constraints,
-- so those combinations are not repeated below.

-- ---------------------------------------------------------------------------
-- Animals
-- ---------------------------------------------------------------------------

-- Every scoped count and the herd status donut filter on farm and status
-- together. Leading with farm_id also serves queries that filter by farm alone.
CREATE INDEX idx_animals_farm_status ON animals (farm_id, status);

-- Dashboard "por lote" grouping and the lote filter.
CREATE INDEX idx_animals_lot ON animals (lot_id);

-- Pasture occupancy and the UA/ha stocking rate calculation.
CREATE INDEX idx_animals_pasture ON animals (pasture_id);

-- Herd composition by age range is derived from birth_date.
CREATE INDEX idx_animals_birth_date ON animals (birth_date);

-- Listing an animal's offspring on the detail page.
CREATE INDEX idx_animals_mother ON animals (mother_id);

-- ---------------------------------------------------------------------------
-- Weighings
-- ---------------------------------------------------------------------------

-- The most important index in the schema. Both "Peso medio (ultima)" and the
-- GMD calculation partition by animal and order by date descending; this lets
-- SQLite satisfy the ROW_NUMBER() window ordering without a sort step.
CREATE INDEX idx_weighings_animal_date ON weighings (animal_id, weigh_date DESC);

-- Period filtering on the weight-evolution chart, which ranges over dates
-- across all animals rather than within one.
CREATE INDEX idx_weighings_date ON weighings (weigh_date);

-- ---------------------------------------------------------------------------
-- Health events
-- ---------------------------------------------------------------------------

-- The overdue and due-in-30-days query filters on applied_date IS NULL first,
-- then compares scheduled_date. Leading with applied_date puts the far more
-- selective condition first: most historical doses have been applied.
CREATE INDEX idx_health_events_pending ON health_events (applied_date, scheduled_date);

-- The animal detail timeline, and the join back to animals in the alerts query.
CREATE INDEX idx_health_events_animal ON health_events (animal_id, scheduled_date);

-- Splitting the two navbar modules (Vacinas / Tratamentos) out of the shared table.
CREATE INDEX idx_health_events_kind ON health_events (kind, scheduled_date);

CREATE INDEX idx_health_protocols_farm ON health_protocols (farm_id, active);

-- ---------------------------------------------------------------------------
-- Movements
-- ---------------------------------------------------------------------------

-- Animal timeline, ordered most recent first.
CREATE INDEX idx_movements_animal_date ON movements (animal_id, moved_at DESC);

-- The Movimentacoes list screen, which is farm-scoped and date-ordered.
CREATE INDEX idx_movements_date ON movements (moved_at DESC);

-- ---------------------------------------------------------------------------
-- Sales, deaths and costs
-- ---------------------------------------------------------------------------

CREATE INDEX idx_sales_farm_date ON sales (farm_id, sale_date DESC);
CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);

CREATE INDEX idx_deaths_date ON deaths (death_date DESC);

-- "Custos do mes" and the stacked cost-by-category chart both scope by farm and
-- range over cost_date.
CREATE INDEX idx_costs_farm_date ON costs (farm_id, cost_date);

-- Cost per animal per month allocates through the lote.
CREATE INDEX idx_costs_lot_date ON costs (lot_id, cost_date);

-- Grouping the stacked bar chart by category.
CREATE INDEX idx_costs_category ON costs (category_id, cost_date);

-- ---------------------------------------------------------------------------
-- Reminders and structure
-- ---------------------------------------------------------------------------

-- The upcoming-events widget reads open reminders by due date.
CREATE INDEX idx_reminders_farm_due ON reminders (farm_id, done_at, due_date);

CREATE INDEX idx_reminders_assigned ON reminders (assigned_user_id, done_at);

CREATE INDEX idx_lots_farm ON lots (farm_id, active);
CREATE INDEX idx_pastures_farm ON pastures (farm_id, active);

-- Resolving the caller's permitted farms on every request.
CREATE INDEX idx_user_farms_farm ON user_farms (farm_id);
