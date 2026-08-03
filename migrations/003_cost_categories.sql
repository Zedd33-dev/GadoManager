-- Migration 003 - Cost categories
--
-- Reference data, not demo data: these five categories are part of the domain
-- model rather than something the seed script invents. They are exactly the
-- categories specified for the Custos module.
--
-- Stored as rows rather than a CHECK constraint so that the stacked
-- cost-by-category chart can join and label them, and so a farm could later be
-- allowed to add its own without a schema migration.

INSERT INTO cost_categories (slug, name, sort_order, active) VALUES
  ('alimentacao',    'Alimentação',   1, 1),
  ('sanidade',       'Sanidade',      2, 1),
  ('mao_de_obra',    'Mão de obra',   3, 1),
  ('infraestrutura', 'Infraestrutura', 4, 1),
  ('outros',         'Outros',        5, 1);
