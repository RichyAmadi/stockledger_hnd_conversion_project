-- SME Sales & Inventory SaaS: schema (shared database, shared schema, RLS)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE businesses (
  business_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name VARCHAR(150) NOT NULL,
  business_type VARCHAR(40)  NOT NULL,
  email         VARCHAR(120) UNIQUE NOT NULL,
  phone         VARCHAR(15)  NOT NULL,
  address       VARCHAR(255),
  state         VARCHAR(50)  NOT NULL,
  logo_url      VARCHAR(255),
  currency      CHAR(3)      DEFAULT 'NGN',
  tax_rate      NUMERIC(5,2) DEFAULT 7.50,
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE branches (
  branch_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses,
  branch_name VARCHAR(100) NOT NULL,
  address     VARCHAR(255),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses,
  branch_id     UUID REFERENCES branches,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(120) UNIQUE NOT NULL,
  phone         VARCHAR(15),
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(30)  NOT NULL CHECK (role IN ('OWNER','ADMIN','INVENTORY_MANAGER','SALES_STAFF')),
  is_active     BOOLEAN DEFAULT TRUE,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE categories (
  category_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses,
  category_name VARCHAR(80) NOT NULL,
  UNIQUE (business_id, category_name)
);

CREATE TABLE products (
  product_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses,
  category_id     UUID REFERENCES categories,
  product_name    VARCHAR(150) NOT NULL,
  sku             VARCHAR(60) NOT NULL,
  barcode         VARCHAR(60),
  description     TEXT,
  unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'piece',
  cost_price      NUMERIC(14,2) NOT NULL CHECK (cost_price >= 0),
  selling_price   NUMERIC(14,2) NOT NULL CHECK (selling_price >= 0),
  reorder_level   INTEGER DEFAULT 0,
  expiry_date     DATE,
  image_url       VARCHAR(255),
  attributes      JSONB,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_id, sku)
);
CREATE INDEX ON products (business_id, barcode);

CREATE TABLE inventory (
  inventory_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses,
  product_id      UUID NOT NULL REFERENCES products,
  branch_id       UUID NOT NULL REFERENCES branches,
  quantity        INTEGER NOT NULL CHECK (quantity >= 0),
  last_counted_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_id, branch_id)
);
CREATE INDEX ON inventory (business_id, branch_id);

CREATE TABLE stock_movements (
  movement_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses,
  product_id    UUID NOT NULL REFERENCES products,
  branch_id     UUID NOT NULL REFERENCES branches,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('OPENING','SALE','PURCHASE','RETURN','ADJUSTMENT')),
  quantity      INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference_id  UUID,
  reason        VARCHAR(120),
  user_id       UUID REFERENCES users,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON stock_movements (business_id, product_id, created_at);

CREATE TABLE customers (
  customer_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses,
  customer_name       VARCHAR(120) NOT NULL,
  phone               VARCHAR(15),
  email               VARCHAR(120),
  address             VARCHAR(255),
  credit_limit        NUMERIC(14,2) DEFAULT 0,
  outstanding_balance NUMERIC(14,2) DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_id, phone)
);

CREATE TABLE sales (
  sale_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses,
  branch_id      UUID NOT NULL REFERENCES branches,
  user_id        UUID NOT NULL REFERENCES users,
  customer_id    UUID REFERENCES customers,
  invoice_no     VARCHAR(30) NOT NULL,
  subtotal       NUMERIC(14,2) NOT NULL,
  discount       NUMERIC(14,2) DEFAULT 0,
  tax_amount     NUMERIC(14,2) DEFAULT 0,
  grand_total    NUMERIC(14,2) NOT NULL,
  amount_paid    NUMERIC(14,2) DEFAULT 0,
  payment_status VARCHAR(20) NOT NULL,
  sale_status    VARCHAR(20) DEFAULT 'COMPLETED',
  sync_uuid      UUID UNIQUE,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_id, invoice_no)
);
CREATE INDEX ON sales (business_id, created_at);

CREATE TABLE sale_items (
  sale_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses,
  sale_id      UUID NOT NULL REFERENCES sales ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(14,2) NOT NULL,
  unit_cost    NUMERIC(14,2) NOT NULL,
  discount     NUMERIC(14,2) DEFAULT 0,
  line_total   NUMERIC(14,2) NOT NULL
);
CREATE INDEX ON sale_items (sale_id);

CREATE TABLE payments (
  payment_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES businesses,
  sale_id            UUID NOT NULL REFERENCES sales,
  amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method     VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH','TRANSFER','CARD','PAYSTACK','CREDIT')),
  paystack_reference VARCHAR(100) UNIQUE,
  paystack_channel   VARCHAR(30),
  status             VARCHAR(20) NOT NULL,
  gateway_response   TEXT,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE suppliers (
  supplier_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses,
  supplier_name       VARCHAR(150) NOT NULL,
  phone               VARCHAR(15),
  email               VARCHAR(120),
  address             VARCHAR(255),
  outstanding_payable NUMERIC(14,2) DEFAULT 0
);

CREATE TABLE purchases (
  purchase_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses,
  branch_id     UUID NOT NULL REFERENCES branches,
  supplier_id   UUID NOT NULL REFERENCES suppliers,
  po_number     VARCHAR(30) NOT NULL,
  order_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  total_amount  NUMERIC(14,2) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'ORDERED',
  UNIQUE (business_id, po_number)
);

CREATE TABLE purchase_items (
  purchase_item_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses,
  purchase_id       UUID NOT NULL REFERENCES purchases ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products,
  quantity_ordered  INTEGER NOT NULL,
  quantity_received INTEGER DEFAULT 0,
  unit_cost         NUMERIC(14,2) NOT NULL
);

CREATE TABLE subscriptions (
  subscription_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                UUID NOT NULL REFERENCES businesses,
  plan_name                  VARCHAR(30) NOT NULL,
  amount                     NUMERIC(14,2) NOT NULL,
  billing_cycle              VARCHAR(20) NOT NULL,
  max_users                  INTEGER NOT NULL,
  max_branches               INTEGER NOT NULL,
  max_products               INTEGER NOT NULL,
  paystack_subscription_code VARCHAR(60),
  start_date                 DATE NOT NULL,
  expiry_date                DATE NOT NULL,
  status                     VARCHAR(20) NOT NULL
);

CREATE TABLE audit_logs (
  log_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses,
  user_id     UUID REFERENCES users,
  action      VARCHAR(60) NOT NULL,
  entity      VARCHAR(40) NOT NULL,
  entity_id   UUID,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses,
  channel         VARCHAR(10) NOT NULL,
  title           VARCHAR(120) NOT NULL,
  body            TEXT,
  is_read         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Row-Level Security: every tenant table is filtered by app.business_id
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','users','categories','products','inventory','stock_movements',
    'customers','sales','sale_items','payments','suppliers','purchases','purchase_items',
    'subscriptions','audit_logs','notifications']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (business_id = NULLIF(current_setting('app.business_id', true), '')::uuid)
      WITH CHECK (business_id = NULLIF(current_setting('app.business_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- Application role (not a superuser, so RLS is enforced)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_pass';
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- Login lookup must find the user before the tenant is known
CREATE FUNCTION auth_lookup(p_email TEXT)
RETURNS TABLE (user_id UUID, business_id UUID, branch_id UUID, full_name VARCHAR, role VARCHAR, password_hash VARCHAR)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT user_id, business_id, branch_id, full_name, role, password_hash FROM users WHERE email = p_email AND is_active $$;
GRANT EXECUTE ON FUNCTION auth_lookup(TEXT) TO app_user;
