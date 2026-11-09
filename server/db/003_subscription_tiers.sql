CREATE TABLE subscription_payments (
  subscription_payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            UUID NOT NULL REFERENCES businesses,
  plan_id                VARCHAR(20) NOT NULL CHECK (plan_id IN ('basic', 'standard', 'premium')),
  billing_cycle          VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
  amount                 NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paystack_reference     VARCHAR(100) NOT NULL UNIQUE,
  status                 VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  paystack_channel       VARCHAR(30),
  gateway_response       TEXT,
  paid_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription_payments
  USING (business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid))
  WITH CHECK (business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_payments TO app_user;
CREATE INDEX subscription_payments_business_created_idx ON subscription_payments (business_id, created_at DESC);
