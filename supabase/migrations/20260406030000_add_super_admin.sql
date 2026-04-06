-- Super admin flag for platform-level access
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;

-- Mark existing admin as super admin
UPDATE user_profiles SET is_super_admin = true WHERE id = '06464150-ccdc-4dda-8a6e-a039fe29c274';

-- Super admins can see all organizations (bypass org-scoped RLS)
DROP POLICY IF EXISTS "Users see own orgs" ON organizations;
CREATE POLICY "Users see own orgs" ON organizations FOR SELECT TO authenticated
  USING (
    id IN (SELECT user_org_ids())
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_super_admin = true)
  );

-- Super admins can see all companies
DROP POLICY IF EXISTS "Org members see companies" ON companies;
CREATE POLICY "Org members see companies" ON companies FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT user_org_ids()) OR org_id IS NULL
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_super_admin = true)
  );

-- Super admins can update any organization
DROP POLICY IF EXISTS "Owners update orgs" ON organizations;
CREATE POLICY "Owners update orgs" ON organizations FOR UPDATE TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_super_admin = true)
  );

-- Super admins can see all user profiles
DROP POLICY IF EXISTS "Users see own profile" ON user_profiles;
CREATE POLICY "Users see profiles" ON user_profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_super_admin = true)
  );
