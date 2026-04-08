-- ============================================================
-- PER-COMPANY PRICING WITH TIERED VIDEO QUALITY
-- ============================================================

-- 1. Tier configuration — defines limits per tier
CREATE TABLE IF NOT EXISTS tier_config (
  tier TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  base_price_cents INTEGER NOT NULL DEFAULT 0,
  extra_company_price_cents INTEGER NOT NULL DEFAULT 0,
  max_companies INTEGER NOT NULL DEFAULT 1,
  max_team_members INTEGER NOT NULL DEFAULT 1,
  posts_per_company INTEGER NOT NULL DEFAULT 15, -- 0 = unlimited
  videos_per_company INTEGER NOT NULL DEFAULT 0,
  extra_video_price_cents INTEGER NOT NULL DEFAULT 0,
  video_quality TEXT NOT NULL DEFAULT 'none', -- none, standard, premium, all
  storyboard_previews INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
  threads_enabled BOOLEAN DEFAULT false,
  response_drafting_enabled BOOLEAN DEFAULT false,
  ab_testing_enabled BOOLEAN DEFAULT false,
  google_reviews_enabled BOOLEAN DEFAULT false,
  performance_ai_enabled BOOLEAN DEFAULT false,
  analytics_level TEXT DEFAULT 'basic', -- basic, full
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed tier config
INSERT INTO tier_config (tier, display_name, base_price_cents, extra_company_price_cents, max_companies, max_team_members, posts_per_company, videos_per_company, extra_video_price_cents, video_quality, storyboard_previews, threads_enabled, response_drafting_enabled, ab_testing_enabled, google_reviews_enabled, performance_ai_enabled, analytics_level) VALUES
  ('starter', 'Starter', 0, 0, 1, 1, 15, 0, 0, 'none', 0, false, false, false, false, false, 'basic'),
  ('growth', 'Growth', 4900, 2900, 5, 5, 0, 2, 500, 'standard', 10, true, true, false, false, false, 'full'),
  ('pro', 'Pro', 14900, 5900, 10, 15, 0, 5, 300, 'all', 0, true, true, true, true, true, 'full'),
  ('enterprise', 'Enterprise', 0, 0, 999, 999, 0, 999, 200, 'all', 0, true, true, true, true, true, 'full')
ON CONFLICT (tier) DO NOTHING;

-- 2. Usage tracking — monthly per company
CREATE TABLE IF NOT EXISTS company_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- '2026-04'
  posts_generated INTEGER DEFAULT 0,
  videos_generated INTEGER DEFAULT 0,
  video_credits_used INTEGER DEFAULT 0, -- standard=1, premium=2, premium+lipsync=3
  storyboard_previews_used INTEGER DEFAULT 0,
  ai_responses_drafted INTEGER DEFAULT 0,
  ab_tests_run INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, month)
);

-- 3. Video credit packs — purchased extra credits
CREATE TABLE IF NOT EXISTS video_credit_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  credits_purchased INTEGER NOT NULL,
  credits_remaining INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  stripe_payment_id TEXT,
  purchased_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ -- null = never expires
);

-- 4. Add video_quality to content_drafts
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS video_quality TEXT DEFAULT 'standard';

-- 5. RLS policies
ALTER TABLE tier_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_credit_packs ENABLE ROW LEVEL SECURITY;

-- Tier config readable by everyone
CREATE POLICY "Anyone can read tier config" ON tier_config FOR SELECT USING (true);

-- Usage scoped to org
CREATE POLICY "Org members see usage" ON company_usage FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY "Service manage usage" ON company_usage FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Credit packs scoped to org
CREATE POLICY "Org members see credit packs" ON video_credit_packs FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY "Service manage credit packs" ON video_credit_packs FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Index for fast usage lookups
CREATE INDEX IF NOT EXISTS idx_company_usage_month ON company_usage(company_id, month);
CREATE INDEX IF NOT EXISTS idx_video_credit_packs_org ON video_credit_packs(org_id) WHERE credits_remaining > 0;
