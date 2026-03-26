-- Meta (Facebook + Instagram) accounts table
CREATE TABLE IF NOT EXISTS meta_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  facebook_page_id text NOT NULL,
  facebook_page_name text,
  instagram_business_account_id text,
  instagram_username text,
  page_access_token text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id)
);

-- Enable RLS
ALTER TABLE meta_accounts ENABLE ROW LEVEL SECURITY;

-- Policies matching twitter_accounts pattern
CREATE POLICY "Authenticated users can view all meta accounts"
  ON meta_accounts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert meta accounts"
  ON meta_accounts FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update meta accounts"
  ON meta_accounts FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete meta accounts"
  ON meta_accounts FOR DELETE TO authenticated USING (true);

-- Service role full access
CREATE POLICY "Service role can manage meta accounts"
  ON meta_accounts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Anon read access (for API clients like blog engine)
CREATE POLICY "Anon can view meta accounts"
  ON meta_accounts FOR SELECT TO anon USING (true);

CREATE INDEX IF NOT EXISTS idx_meta_accounts_company_id ON meta_accounts(company_id);

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_meta_accounts_updated_at ON meta_accounts;
CREATE TRIGGER update_meta_accounts_updated_at
  BEFORE UPDATE ON meta_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
