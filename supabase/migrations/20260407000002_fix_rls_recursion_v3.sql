-- Final recursion fix
-- The chain: organizations policy → user_org_ids() → organization_members policy → organizations policy
-- Solution: Make user_org_ids() SECURITY DEFINER so it bypasses all RLS

CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT om.org_id FROM organization_members om WHERE om.user_id = auth.uid()
  UNION
  SELECT o.id FROM organizations o WHERE o.owner_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
