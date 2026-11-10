CREATE TABLE platform_admins (
  platform_admin_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(120) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE TABLE platform_admin_audit_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL REFERENCES platform_admins,
  business_id UUID REFERENCES businesses,
  action VARCHAR(60) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX platform_admin_audit_business_idx
  ON platform_admin_audit_logs (business_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches','users','categories','products','inventory','stock_movements',
    'customers','sales','sale_items','payments','suppliers','purchases','purchase_items',
    'subscriptions','audit_logs','notifications','subscription_payments',
    'customer_interactions','customer_complaints'
  ] LOOP
    EXECUTE format($policy$
      CREATE POLICY platform_admin_read ON %I FOR SELECT
      USING (current_setting('app.platform_admin', true) = 'true')
    $policy$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON platform_admins TO app_user;
GRANT SELECT, INSERT ON platform_admin_audit_logs TO app_user;