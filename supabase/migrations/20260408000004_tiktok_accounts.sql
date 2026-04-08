CREATE TABLE IF NOT EXISTS tiktok_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  open_id TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members see tiktok accounts" ON tiktok_accounts FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

CREATE POLICY "Service manage tiktok accounts" ON tiktok_accounts FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
