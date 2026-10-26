-- 0006_business.sql
-- Phase 4: business schema (company demo data) + business_ro views (safe SQL surface)
--
-- Tables live in the `business` schema (never queried directly by the app or SQL role).
-- The `business_ro` schema exposes only PII-stripped, read-only views for text-to-SQL.

-- ---------------------------------------------------------------------------
-- business.products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business.products (
  id          serial       PRIMARY KEY,
  sku         text         NOT NULL UNIQUE,
  name        text         NOT NULL,
  category    text         NOT NULL,
  subcategory text,
  unit_price  numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  cost_price  numeric(10,2) NOT NULL CHECK (cost_price >= 0),
  stock_qty   integer      NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- business.customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business.customers (
  id           serial      PRIMARY KEY,
  -- PII columns (email, phone, address) are intentionally excluded from business_ro views
  first_name   text        NOT NULL,
  last_name    text        NOT NULL,
  email        text        NOT NULL UNIQUE,
  phone        text,
  city         text,
  country      text        NOT NULL DEFAULT 'US',
  segment      text        NOT NULL CHECK (segment IN ('consumer', 'corporate', 'small_business')),
  acquired_at  date        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- business.orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business.orders (
  id            serial       PRIMARY KEY,
  customer_id   integer      NOT NULL REFERENCES business.customers(id),
  status        text         NOT NULL CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned')),
  channel       text         NOT NULL CHECK (channel IN ('web', 'mobile', 'api', 'phone')),
  subtotal      numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  discount      numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax           numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total         numeric(12,2) NOT NULL CHECK (total >= 0),
  currency      text         NOT NULL DEFAULT 'USD',
  ordered_at    timestamptz  NOT NULL,
  shipped_at    timestamptz,
  delivered_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON business.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON business.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_ordered_at  ON business.orders(ordered_at DESC);

-- ---------------------------------------------------------------------------
-- business.order_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business.order_items (
  id          serial       PRIMARY KEY,
  order_id    integer      NOT NULL REFERENCES business.orders(id) ON DELETE CASCADE,
  product_id  integer      NOT NULL REFERENCES business.products(id),
  qty         integer      NOT NULL CHECK (qty > 0),
  unit_price  numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  discount    numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total  numeric(12,2) NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id   ON business.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON business.order_items(product_id);

-- ---------------------------------------------------------------------------
-- business.returns
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business.returns (
  id          serial       PRIMARY KEY,
  order_id    integer      NOT NULL REFERENCES business.orders(id),
  product_id  integer      NOT NULL REFERENCES business.products(id),
  qty         integer      NOT NULL CHECK (qty > 0),
  reason      text         NOT NULL CHECK (reason IN ('defective', 'wrong_item', 'not_as_described', 'changed_mind', 'other')),
  refund_amt  numeric(12,2) NOT NULL DEFAULT 0,
  returned_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_returns_order_id ON business.returns(order_id);

-- ---------------------------------------------------------------------------
-- business.support_tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business.support_tickets (
  id           serial      PRIMARY KEY,
  customer_id  integer     NOT NULL REFERENCES business.customers(id),
  order_id     integer     REFERENCES business.orders(id),
  category     text        NOT NULL CHECK (category IN ('billing', 'shipping', 'product', 'account', 'other')),
  priority     text        NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status       text        NOT NULL CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  -- subject/body excluded from business_ro (may contain PII)
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  satisfaction smallint    CHECK (satisfaction BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON business.support_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status      ON business.support_tickets(status);

-- ---------------------------------------------------------------------------
-- business.employees
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business.employees (
  id          serial      PRIMARY KEY,
  -- name/email excluded from business_ro
  first_name  text        NOT NULL,
  last_name   text        NOT NULL,
  email       text        NOT NULL UNIQUE,
  department  text        NOT NULL,
  title       text        NOT NULL,
  level       text        NOT NULL CHECK (level IN ('ic1', 'ic2', 'ic3', 'ic4', 'mgr', 'sr_mgr', 'dir', 'vp')),
  -- salary excluded from business_ro
  salary      numeric(12,2) NOT NULL,
  hired_at    date        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- business_ro views — PII-stripped, non-sensitive columns only
-- ---------------------------------------------------------------------------

-- Products: full catalogue (no cost price in view — margin is sensitive)
CREATE OR REPLACE VIEW business_ro.v_products AS
SELECT
  id,
  sku,
  name,
  category,
  subcategory,
  unit_price,
  stock_qty,
  is_active,
  created_at::date AS created_date
FROM business.products;

-- Customers: no email, phone; city/country/segment are fine
CREATE OR REPLACE VIEW business_ro.v_customers AS
SELECT
  id,
  city,
  country,
  segment,
  acquired_at,
  is_active
FROM business.customers;

-- Orders: full order header (no PII, financials are business data)
CREATE OR REPLACE VIEW business_ro.v_orders AS
SELECT
  id,
  customer_id,
  status,
  channel,
  subtotal,
  discount,
  tax,
  total,
  currency,
  ordered_at,
  shipped_at,
  delivered_at
FROM business.orders;

-- Order items
CREATE OR REPLACE VIEW business_ro.v_order_items AS
SELECT
  id,
  order_id,
  product_id,
  qty,
  unit_price,
  discount,
  line_total
FROM business.order_items;

-- Returns
CREATE OR REPLACE VIEW business_ro.v_returns AS
SELECT
  id,
  order_id,
  product_id,
  qty,
  reason,
  refund_amt,
  returned_at
FROM business.returns;

-- Support tickets: no subject/body to avoid PII leakage
CREATE OR REPLACE VIEW business_ro.v_support_tickets AS
SELECT
  id,
  customer_id,
  order_id,
  category,
  priority,
  status,
  created_at,
  resolved_at,
  satisfaction,
  CASE WHEN resolved_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600
    ELSE NULL
  END AS resolution_hours
FROM business.support_tickets;

-- Employees: anonymised (no name, no email, no salary)
CREATE OR REPLACE VIEW business_ro.v_employees AS
SELECT
  id,
  department,
  title,
  level,
  hired_at,
  is_active
FROM business.employees;

-- ---------------------------------------------------------------------------
-- Grants: verity_sql_ro can only SELECT on business_ro views
-- ---------------------------------------------------------------------------
GRANT SELECT ON business_ro.v_products        TO verity_sql_ro;
GRANT SELECT ON business_ro.v_customers       TO verity_sql_ro;
GRANT SELECT ON business_ro.v_orders          TO verity_sql_ro;
GRANT SELECT ON business_ro.v_order_items     TO verity_sql_ro;
GRANT SELECT ON business_ro.v_returns         TO verity_sql_ro;
GRANT SELECT ON business_ro.v_support_tickets TO verity_sql_ro;
GRANT SELECT ON business_ro.v_employees       TO verity_sql_ro;
