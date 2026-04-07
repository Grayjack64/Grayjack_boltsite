-- Fix infinite recursion in RLS policies
-- The user_org_ids() function was causing circular references between
-- organizations, organization_members, and user_profiles tables.

-- Replace the function with one that doesn't trigger other RLS policies
CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT om.org_id FROM organization_members om WHERE om.user_id = auth.uid()
  UNION
  SELECT o.id FROM organizations o WHERE o.owner_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Fix organization_members: use direct auth.uid() check, not user_org_ids()
DROP POLICY IF EXISTS "Members see own org members" ON organization_members;
DROP POLICY IF EXISTS "Admins manage members" ON organization_members;

CREATE POLICY "Members see own org members" ON organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR org_id IN (
    SELECT om2.org_id FROM organization_members om2 WHERE om2.user_id = auth.uid()
  ));

CREATE POLICY "Admins manage members" ON organization_members FOR ALL TO authenticated
  USING (org_id IN (SELECT o.id FROM organizations o WHERE o.owner_user_id = auth.uid()));

-- Fix user_profiles: don't reference user_org_ids() for super admin check
DROP POLICY IF EXISTS "Users see profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users see own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users manage own profile" ON user_profiles;

CREATE POLICY "Users see own profile" ON user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users update own profile" ON user_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Users insert own profile" ON user_profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- Super admin: separate policy for viewing all profiles
CREATE POLICY "Super admin sees all profiles" ON user_profiles FOR SELECT TO authenticated
  USING ((SELECT is_super_admin FROM user_profiles WHERE id = auth.uid()));

-- Fix organizations: avoid recursion through user_org_ids by inlining
DROP POLICY IF EXISTS "Users see own orgs" ON organizations;

CREATE POLICY "Users see own orgs" ON organizations FOR SELECT TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR id IN (SELECT om.org_id FROM organization_members om WHERE om.user_id = auth.uid())
    OR (SELECT is_super_admin FROM user_profiles WHERE id = auth.uid())
  );
