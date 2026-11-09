ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE customer_interactions (
  interaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses,
  customer_id UUID NOT NULL REFERENCES customers ON DELETE CASCADE,
  user_id UUID REFERENCES users,
  interaction_type VARCHAR(16) NOT NULL CHECK (interaction_type IN ('CALL', 'EMAIL', 'MEETING', 'NOTE')),
  subject VARCHAR(120) NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  follow_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_complaints (
  complaint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses,
  customer_id UUID NOT NULL REFERENCES customers,
  sale_id UUID REFERENCES sales,
  created_by UUID REFERENCES users,
  assigned_to UUID REFERENCES users,
  category VARCHAR(20) NOT NULL CHECK (category IN ('PRODUCT', 'PAYMENT', 'DELIVERY', 'SERVICE', 'OTHER')),
  subject VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  priority VARCHAR(12) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX customer_interactions_timeline_idx
  ON customer_interactions (business_id, customer_id, created_at DESC);
CREATE INDEX customer_complaints_queue_idx
  ON customer_complaints (business_id, status, priority, created_at DESC);
CREATE INDEX customer_complaints_customer_idx
  ON customer_complaints (business_id, customer_id, created_at DESC);

ALTER TABLE customer_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_interactions
  USING (business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid))
  WITH CHECK (business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid));

ALTER TABLE customer_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_complaints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_complaints
  USING (business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid))
  WITH CHECK (business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON customer_interactions, customer_complaints TO app_user;