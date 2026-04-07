-- Fix remaining RLS recursion
-- The super admin check was causing self-referencing recursion on user_profiles.
-- Solution: use a SECURITY DEFINER function that bypasses RLS.

-- Function to check if current user is super admin (bypasses RLS)
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM user_profiles WHERE id = auth.uid()),
    false
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Fix user_profiles policies — remove self-referencing super admin check
DROP POLICY IF EXISTS "Super admin sees all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users see own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users manage own profile" ON user_profiles;

CREATE POLICY "Users see own profile" ON user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_super_admin());

CREATE POLICY "Users manage own profile" ON user_profiles FOR ALL TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Fix organizations — use is_super_admin() function
DROP POLICY IF EXISTS "Users see own orgs" ON organizations;

CREATE POLICY "Users see own orgs" ON organizations FOR SELECT TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR id IN (SELECT om.org_id FROM organization_members om WHERE om.user_id = auth.uid())
    OR is_super_admin()
  );

-- Fix companies — use is_super_admin() function
DROP POLICY IF EXISTS "Org members see companies" ON companies;

CREATE POLICY "Org members see companies" ON companies FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT user_org_ids()) OR org_id IS NULL
    OR is_super_admin()
  );

-- Fix organization_members — avoid recursion in SELECT
DROP POLICY IF EXISTS "Members see own org members" ON organization_members;

CREATE POLICY "Members see own org members" ON organization_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT o.id FROM organizations o WHERE o.owner_user_id = auth.uid())
    OR is_super_admin()
  );
