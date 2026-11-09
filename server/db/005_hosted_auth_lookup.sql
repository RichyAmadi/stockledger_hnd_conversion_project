DROP POLICY tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
  USING (
    business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid)
    OR email = (SELECT NULLIF(current_setting('app.auth_email', true), ''))
  )
  WITH CHECK (
    business_id = (SELECT NULLIF(current_setting('app.business_id', true), '')::uuid)
  );

CREATE OR REPLACE FUNCTION auth_lookup(p_email TEXT)
RETURNS TABLE (user_id UUID, business_id UUID, branch_id UUID, full_name VARCHAR, role VARCHAR, password_hash VARCHAR)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
BEGIN
  PERFORM set_config('app.auth_email', p_email, true);
  RETURN QUERY
    SELECT u.user_id, u.business_id, u.branch_id, u.full_name, u.role, u.password_hash
    FROM users u
    WHERE u.email = p_email AND u.is_active;
END;
$$;