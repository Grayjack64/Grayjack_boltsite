-- ============================================================
-- MULTI-TENANT SAAS FOUNDATION
-- Organizations, team members, user profiles, company settings
-- ============================================================

-- 1. Organizations (the tenant)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id),
  subscription_tier TEXT DEFAULT 'starter',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Team members
CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, user_id)
);

-- 3. User profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  current_org_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Company settings (replaces hardcoded engine config)
CREATE TABLE IF NOT EXISTS company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  publish_mode TEXT DEFAULT 'draft',
  posts_per_day INTEGER DEFAULT 2,
  cron_times JSONB DEFAULT '["0 9 * * *", "0 15 * * *"]',
  topic_cooldown_days INTEGER DEFAULT 30,
  platforms_enabled JSONB DEFAULT '["twitter", "facebook", "instagram"]',
  blog_enabled BOOLEAN DEFAULT true,
  blog_base_url TEXT,
  blog_supabase_url TEXT,
  blog_supabase_key TEXT,
  image_storage_url TEXT,
  image_storage_key TEXT,
  industry TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Google Business accounts
CREATE TABLE IF NOT EXISTS google_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  location_id TEXT NOT NULL,
  location_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ADD org_id TO ALL EXISTING TABLES
-- ============================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

ALTER TABLE company_content_config ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE company_knowledge ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE company_media ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE company_events ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE social_messages ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE social_responses ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE post_metrics ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE brand_characters ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE twitter_accounts ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE meta_accounts ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE google_accounts ADD COLUMN IF NOT EXISTS org_id UUID;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_org ON user_profiles(current_org_id);
CREATE INDEX IF NOT EXISTS idx_companies_org ON companies(org_id);
CREATE INDEX IF NOT EXISTS idx_company_settings_company ON company_settings(company_id);

-- ============================================================
-- HELPER FUNCTION: Get user's org IDs
-- ============================================================

CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT org_id FROM organization_members WHERE user_id = auth.uid()
  UNION
  SELECT id FROM organizations WHERE owner_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- RLS ON NEW TABLES
-- ============================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_accounts ENABLE ROW LEVEL SECURITY;

-- Organizations: users see their own orgs
CREATE POLICY "Users see own orgs" ON organizations FOR SELECT TO authenticated
  USING (id IN (SELECT user_org_ids()));
CREATE POLICY "Users create orgs" ON organizations FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "Owners update orgs" ON organizations FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY "Service manage orgs" ON organizations FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Organization members
CREATE POLICY "Members see own org members" ON organization_members FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));
CREATE POLICY "Admins manage members" ON organization_members FOR ALL TO authenticated
  USING (org_id IN (SELECT id FROM organizations WHERE owner_user_id = auth.uid()));
CREATE POLICY "Service manage members" ON organization_members FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- User profiles
CREATE POLICY "Users see own profile" ON user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY "Users manage own profile" ON user_profiles FOR ALL TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Service manage profiles" ON user_profiles FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Company settings
CREATE POLICY "Org members see company settings" ON company_settings FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));
CREATE POLICY "Org members manage company settings" ON company_settings FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));
CREATE POLICY "Service manage company settings" ON company_settings FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Google accounts
CREATE POLICY "Org members see google accounts" ON google_accounts FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));
CREATE POLICY "Org members manage google accounts" ON google_accounts FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));
CREATE POLICY "Service manage google accounts" ON google_accounts FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- REPLACE EXISTING RLS POLICIES WITH ORG-SCOPED VERSIONS
-- ============================================================

-- Companies: drop old open policies, add org-scoped
DROP POLICY IF EXISTS "Authenticated users can view all companies" ON companies;
DROP POLICY IF EXISTS "Authenticated users can insert companies" ON companies;
DROP POLICY IF EXISTS "Authenticated users can update companies" ON companies;
DROP POLICY IF EXISTS "Authenticated users can delete companies" ON companies;

CREATE POLICY "Org members see companies" ON companies FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()) OR org_id IS NULL);
CREATE POLICY "Org members insert companies" ON companies FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT user_org_ids()));
CREATE POLICY "Org members update companies" ON companies FOR UPDATE TO authenticated
  USING (org_id IN (SELECT user_org_ids()));
CREATE POLICY "Org members delete companies" ON companies FOR DELETE TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

-- Twitter accounts
DROP POLICY IF EXISTS "Authenticated users can view all twitter accounts" ON twitter_accounts;
DROP POLICY IF EXISTS "Authenticated users can insert twitter accounts" ON twitter_accounts;
DROP POLICY IF EXISTS "Authenticated users can update twitter accounts" ON twitter_accounts;
DROP POLICY IF EXISTS "Authenticated users can delete twitter accounts" ON twitter_accounts;

CREATE POLICY "Org members see twitter accounts" ON twitter_accounts FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));
CREATE POLICY "Org members manage twitter accounts" ON twitter_accounts FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- Meta accounts
DROP POLICY IF EXISTS "Authenticated users can view all meta accounts" ON meta_accounts;
DROP POLICY IF EXISTS "Authenticated users can insert meta accounts" ON meta_accounts;
DROP POLICY IF EXISTS "Authenticated users can update meta accounts" ON meta_accounts;
DROP POLICY IF EXISTS "Authenticated users can delete meta accounts" ON meta_accounts;
DROP POLICY IF EXISTS "Anon can view meta accounts" ON meta_accounts;

CREATE POLICY "Org members see meta accounts" ON meta_accounts FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));
CREATE POLICY "Org members manage meta accounts" ON meta_accounts FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- Content tables: replace open policies with org-scoped
-- (Using a pattern: drop old, create org-scoped)

-- company_content_config
DROP POLICY IF EXISTS "Auth read company_content_config" ON company_content_config;
DROP POLICY IF EXISTS "Auth write company_content_config" ON company_content_config;
DROP POLICY IF EXISTS "Auth update company_content_config" ON company_content_config;
DROP POLICY IF EXISTS "Auth delete company_content_config" ON company_content_config;
CREATE POLICY "Org scoped content config" ON company_content_config FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- company_knowledge
DROP POLICY IF EXISTS "Auth read company_knowledge" ON company_knowledge;
DROP POLICY IF EXISTS "Auth write company_knowledge" ON company_knowledge;
DROP POLICY IF EXISTS "Auth update company_knowledge" ON company_knowledge;
DROP POLICY IF EXISTS "Auth delete company_knowledge" ON company_knowledge;
CREATE POLICY "Org scoped knowledge" ON company_knowledge FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- company_media
DROP POLICY IF EXISTS "Auth read company_media" ON company_media;
DROP POLICY IF EXISTS "Auth write company_media" ON company_media;
DROP POLICY IF EXISTS "Auth update company_media" ON company_media;
DROP POLICY IF EXISTS "Auth delete company_media" ON company_media;
CREATE POLICY "Org scoped media" ON company_media FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- company_events
DROP POLICY IF EXISTS "Auth read company_events" ON company_events;
DROP POLICY IF EXISTS "Auth write company_events" ON company_events;
DROP POLICY IF EXISTS "Auth update company_events" ON company_events;
DROP POLICY IF EXISTS "Auth delete company_events" ON company_events;
CREATE POLICY "Org scoped events" ON company_events FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- content_drafts
DROP POLICY IF EXISTS "Auth read content_drafts" ON content_drafts;
DROP POLICY IF EXISTS "Auth write content_drafts" ON content_drafts;
DROP POLICY IF EXISTS "Auth update content_drafts" ON content_drafts;
DROP POLICY IF EXISTS "Auth delete content_drafts" ON content_drafts;
CREATE POLICY "Org scoped drafts" ON content_drafts FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- social_messages
DROP POLICY IF EXISTS "Authenticated read social_messages" ON social_messages;
CREATE POLICY "Org scoped messages" ON social_messages FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- social_responses
DROP POLICY IF EXISTS "Authenticated read social_responses" ON social_responses;
DROP POLICY IF EXISTS "Authenticated update social_responses" ON social_responses;
CREATE POLICY "Org scoped responses" ON social_responses FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- post_metrics
DROP POLICY IF EXISTS "Authenticated read post_metrics" ON post_metrics;
DROP POLICY IF EXISTS "Authenticated update post_metrics" ON post_metrics;
CREATE POLICY "Org scoped metrics" ON post_metrics FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- content_performance
DROP POLICY IF EXISTS "Auth read content_performance" ON content_performance;
CREATE POLICY "Org scoped performance" ON content_performance FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- brand_characters
DROP POLICY IF EXISTS "Auth read brand_characters" ON brand_characters;
DROP POLICY IF EXISTS "Auth write brand_characters" ON brand_characters;
DROP POLICY IF EXISTS "Auth update brand_characters" ON brand_characters;
DROP POLICY IF EXISTS "Auth delete brand_characters" ON brand_characters;
CREATE POLICY "Org scoped characters" ON brand_characters FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

-- metrics_snapshots (indirect via post_metrics)
DROP POLICY IF EXISTS "Authenticated read metrics_snapshots" ON metrics_snapshots;
CREATE POLICY "Org scoped snapshots" ON metrics_snapshots FOR ALL TO authenticated
  USING (post_metric_id IN (
    SELECT id FROM post_metrics WHERE company_id IN (
      SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())
    )
  ));

-- ============================================================
-- KEEP ANON + SERVICE ROLE POLICIES FOR API/ENGINE ACCESS
-- ============================================================

-- Anon read policies (for public blog pages, API clients, engine access)
-- Drop any existing anon policies first to avoid conflicts
DROP POLICY IF EXISTS "Anon read companies" ON companies;
DROP POLICY IF EXISTS "Anon read content config" ON company_content_config;
DROP POLICY IF EXISTS "Anon read knowledge" ON company_knowledge;
DROP POLICY IF EXISTS "Anon read media" ON company_media;
DROP POLICY IF EXISTS "Anon read events" ON company_events;
DROP POLICY IF EXISTS "Anon read drafts" ON content_drafts;
DROP POLICY IF EXISTS "Anon read metrics" ON post_metrics;
DROP POLICY IF EXISTS "Anon read performance" ON content_performance;
DROP POLICY IF EXISTS "Anon read characters" ON brand_characters;
DROP POLICY IF EXISTS "Anon read company_content_config" ON company_content_config;
DROP POLICY IF EXISTS "Anon read company_knowledge" ON company_knowledge;
DROP POLICY IF EXISTS "Anon read company_media" ON company_media;
DROP POLICY IF EXISTS "Anon read company_events" ON company_events;
DROP POLICY IF EXISTS "Anon read content_drafts" ON content_drafts;
DROP POLICY IF EXISTS "Anon read post_metrics" ON post_metrics;
DROP POLICY IF EXISTS "Anon read content_performance" ON content_performance;

CREATE POLICY "Anon read companies" ON companies FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read content config" ON company_content_config FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read knowledge" ON company_knowledge FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read media" ON company_media FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read events" ON company_events FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read drafts" ON content_drafts FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read metrics" ON post_metrics FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read performance" ON content_performance FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read characters" ON brand_characters FOR SELECT TO anon USING (true);

-- ============================================================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- BACKFILL: Create Grayjack org and link existing companies
-- ============================================================

-- Create Grayjack Holdings organization for existing user
INSERT INTO organizations (id, name, slug, owner_user_id, subscription_tier, status)
SELECT
  gen_random_uuid(),
  'Grayjack Holdings',
  'grayjack-holdings',
  '06464150-ccdc-4dda-8a6e-a039fe29c274', -- existing admin user
  'pro',
  'active'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'grayjack-holdings');

-- Create user profile for existing admin
INSERT INTO user_profiles (id, full_name, current_org_id)
SELECT
  '06464150-ccdc-4dda-8a6e-a039fe29c274',
  'grayjack',
  (SELECT id FROM organizations WHERE slug = 'grayjack-holdings')
WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = '06464150-ccdc-4dda-8a6e-a039fe29c274');

-- Link existing companies to Grayjack org
UPDATE companies SET org_id = (SELECT id FROM organizations WHERE slug = 'grayjack-holdings')
WHERE org_id IS NULL;

-- Backfill org_id on all content tables from their company's org
UPDATE company_content_config SET org_id = (SELECT org_id FROM companies WHERE companies.id = company_content_config.company_id) WHERE org_id IS NULL;
UPDATE company_knowledge SET org_id = (SELECT org_id FROM companies WHERE companies.id = company_knowledge.company_id) WHERE org_id IS NULL;
UPDATE company_media SET org_id = (SELECT org_id FROM companies WHERE companies.id = company_media.company_id) WHERE org_id IS NULL;
UPDATE company_events SET org_id = (SELECT org_id FROM companies WHERE companies.id = company_events.company_id) WHERE org_id IS NULL;
UPDATE content_drafts SET org_id = (SELECT org_id FROM companies WHERE companies.id = content_drafts.company_id) WHERE org_id IS NULL;
UPDATE social_messages SET org_id = (SELECT org_id FROM companies WHERE companies.id = social_messages.company_id) WHERE org_id IS NULL;
UPDATE social_responses sr SET org_id = (SELECT c.org_id FROM companies c JOIN social_messages sm ON sm.id = sr.message_id WHERE c.id = sm.company_id LIMIT 1) WHERE sr.org_id IS NULL;
UPDATE post_metrics SET org_id = (SELECT org_id FROM companies WHERE companies.id = post_metrics.company_id) WHERE org_id IS NULL;
UPDATE content_performance SET org_id = (SELECT org_id FROM companies WHERE companies.id = content_performance.company_id) WHERE org_id IS NULL;
UPDATE brand_characters SET org_id = (SELECT org_id FROM companies WHERE companies.id = brand_characters.company_id) WHERE org_id IS NULL;
UPDATE twitter_accounts SET org_id = (SELECT org_id FROM companies WHERE companies.id = twitter_accounts.company_id) WHERE org_id IS NULL;
UPDATE meta_accounts SET org_id = (SELECT org_id FROM companies WHERE companies.id = meta_accounts.company_id) WHERE org_id IS NULL;

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_company_settings_updated_at ON company_settings;
CREATE TRIGGER update_company_settings_updated_at
  BEFORE UPDATE ON company_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
