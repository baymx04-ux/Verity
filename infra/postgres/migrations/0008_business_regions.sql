-- 0008_business_regions.sql
-- Phase 4: regional rollups and analytical views used by the demo questions.
--
-- This migration is additive so it can be applied to a database that already
-- ran 0006. The seed script populates the region keys; existing rows remain
-- valid with NULL region_id until the demo data is regenerated.

-- ---------------------------------------------------------------------------
-- Regions and ownership keys
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business.regions (
  id      serial PRIMARY KEY,
  name    text   NOT NULL UNIQUE,
  country text   NOT NULL
);

ALTER TABLE business.customers
  ADD COLUMN IF NOT EXISTS region_id integer REFERENCES business.regions(id);
ALTER TABLE business.orders
  ADD COLUMN IF NOT EXISTS region_id integer REFERENCES business.regions(id);
ALTER TABLE business.employees
  ADD COLUMN IF NOT EXISTS region_id integer REFERENCES business.regions(id);
ALTER TABLE business.employees
  ADD COLUMN IF NOT EXISTS manager_id integer REFERENCES business.employees(id);

CREATE INDEX IF NOT EXISTS idx_customers_region_id ON business.customers(region_id);
CREATE INDEX IF NOT EXISTS idx_orders_region_id    ON business.orders(region_id);
CREATE INDEX IF NOT EXISTS idx_employees_region_id ON business.employees(region_id);

INSERT INTO business.regions (id, name, country)
VALUES
  (1, 'North America', 'United States'),
  (2, 'Europe', 'Germany'),
  (3, 'United Kingdom & Ireland', 'United Kingdom'),
  (4, 'Asia Pacific', 'Australia'),
  (5, 'Latin America', 'Brazil')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Read-only views: add region labels without exposing PII.
-- New columns are appended so CREATE OR REPLACE VIEW remains valid.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW business_ro.v_regions AS
SELECT id, name, country
FROM business.regions;

CREATE OR REPLACE VIEW business_ro.v_customers AS
SELECT
  c.id,
  c.city,
  c.country,
  c.segment,
  c.acquired_at,
  c.is_active,
  c.region_id,
  r.name AS region_name
FROM business.customers c
LEFT JOIN business.regions r ON r.id = c.region_id;

CREATE OR REPLACE VIEW business_ro.v_orders AS
SELECT
  o.id,
  o.customer_id,
  o.status,
  o.channel,
  o.subtotal,
  o.discount,
  o.tax,
  o.total,
  o.currency,
  o.ordered_at,
  o.shipped_at,
  o.delivered_at,
  o.region_id,
  r.name AS region_name
FROM business.orders o
LEFT JOIN business.regions r ON r.id = o.region_id;

CREATE OR REPLACE VIEW business_ro.v_employees AS
SELECT
  e.id,
  e.department,
  e.title,
  e.level,
  e.hired_at,
  e.is_active,
  e.region_id,
  r.name AS region_name,
  e.manager_id
FROM business.employees e
LEFT JOIN business.regions r ON r.id = e.region_id;

-- Daily gross revenue, refunds, and net revenue by region. Gross revenue counts
-- shipped and delivered orders (not cancelled/pending), matching finance's
-- recognised-revenue convention for the demo.
CREATE OR REPLACE VIEW business_ro.v_revenue_daily AS
WITH order_revenue AS (
  SELECT
    o.ordered_at::date AS revenue_date,
    o.region_id,
    COUNT(DISTINCT o.id) AS orders,
    COALESCE(SUM(oi.qty), 0) AS units,
    COALESCE(SUM(o.total), 0) AS gross_revenue
  FROM business.orders o
  LEFT JOIN business.order_items oi ON oi.order_id = o.id
  WHERE o.status IN ('shipped', 'delivered')
  GROUP BY o.ordered_at::date, o.region_id
),
refund_revenue AS (
  SELECT
    r.returned_at::date AS revenue_date,
    o.region_id,
    COALESCE(SUM(r.refund_amt), 0) AS refunds
  FROM business.returns r
  JOIN business.orders o ON o.id = r.order_id
  GROUP BY r.returned_at::date, o.region_id
)
SELECT
  COALESCE(orv.revenue_date, rrv.revenue_date) AS revenue_date,
  COALESCE(orv.region_id, rrv.region_id) AS region_id,
  COALESCE(rg.name, 'Unassigned') AS region_name,
  COALESCE(orv.orders, 0) AS orders,
  COALESCE(orv.units, 0) AS units,
  COALESCE(orv.gross_revenue, 0) AS gross_revenue,
  COALESCE(rrv.refunds, 0) AS refunds,
  COALESCE(orv.gross_revenue, 0) - COALESCE(rrv.refunds, 0) AS net_revenue
FROM order_revenue orv
FULL OUTER JOIN refund_revenue rrv
  ON rrv.revenue_date = orv.revenue_date
 AND rrv.region_id IS NOT DISTINCT FROM orv.region_id
LEFT JOIN business.regions rg
  ON rg.id = COALESCE(orv.region_id, rrv.region_id);

CREATE OR REPLACE VIEW business_ro.v_revenue_monthly AS
SELECT
  DATE_TRUNC('month', revenue_date)::date AS revenue_month,
  region_id,
  region_name,
  SUM(orders) AS orders,
  SUM(units) AS units,
  SUM(gross_revenue) AS gross_revenue,
  SUM(refunds) AS refunds,
  SUM(net_revenue) AS net_revenue
FROM business_ro.v_revenue_daily
GROUP BY DATE_TRUNC('month', revenue_date)::date, region_id, region_name;

-- All-time product performance with a return-rate percentage. The rate uses
-- returned units divided by sold units, not order counts.
CREATE OR REPLACE VIEW business_ro.v_product_performance AS
WITH sales AS (
  SELECT
    oi.product_id,
    SUM(oi.qty) AS units_sold,
    SUM(oi.line_total) AS gross_revenue
  FROM business.order_items oi
  JOIN business.orders o ON o.id = oi.order_id
  WHERE o.status IN ('shipped', 'delivered')
  GROUP BY oi.product_id
),
returns AS (
  SELECT
    r.product_id,
    SUM(r.qty) AS returned_qty,
    SUM(r.refund_amt) AS refunds
  FROM business.returns r
  GROUP BY r.product_id
)
SELECT
  p.id AS product_id,
  p.sku,
  p.name,
  p.category,
  COALESCE(s.units_sold, 0) AS units_sold,
  COALESCE(s.gross_revenue, 0) AS gross_revenue,
  COALESCE(r.returned_qty, 0) AS returned_qty,
  COALESCE(r.refunds, 0) AS refunds,
  CASE
    WHEN COALESCE(s.units_sold, 0) = 0 THEN 0
    ELSE ROUND(COALESCE(r.returned_qty, 0)::numeric * 100 / s.units_sold, 2)
  END AS return_rate_pct
FROM business.products p
LEFT JOIN sales s   ON s.product_id = p.id
LEFT JOIN returns r ON r.product_id = p.id;

-- ---------------------------------------------------------------------------
-- Grants for the read-only SQL role
-- ---------------------------------------------------------------------------
GRANT SELECT ON
  business_ro.v_regions,
  business_ro.v_customers,
  business_ro.v_orders,
  business_ro.v_employees,
  business_ro.v_revenue_daily,
  business_ro.v_revenue_monthly,
  business_ro.v_product_performance
TO verity_sql_ro;

-- Keep the existing grants valid after replacing the views.
GRANT SELECT ON
  business_ro.v_products,
  business_ro.v_order_items,
  business_ro.v_returns,
  business_ro.v_support_tickets
TO verity_sql_ro;
