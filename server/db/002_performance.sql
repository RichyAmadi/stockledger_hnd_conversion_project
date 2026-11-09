-- Sprint tuning: indexes for tenant-filtered joins and a cached RLS predicate
CREATE INDEX IF NOT EXISTS sale_items_business_idx ON sale_items (business_id, product_id);
CREATE INDEX IF NOT EXISTS payments_sale_idx ON payments (sale_id);
CREATE INDEX IF NOT EXISTS sales_business_user_idx ON sales (business_id, user_id, created_at);
-- Evaluate current_setting() once per query instead of once per row
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','users','categories','products','inventory','stock_movements',
    'customers','sales','sale_items','payments','suppliers','purchases','purchase_items',
    'subscriptions','audit_logs','notifications']
  LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid))
      WITH CHECK (business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid))$p$, t);
  END LOOP;
END $$;
ANALYZE;
