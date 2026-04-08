CREATE TABLE IF NOT EXISTS team_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days')
);

ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members see invites" ON team_invites FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY "Org admins manage invites" ON team_invites FOR ALL TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY "Service manage invites" ON team_invites FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
