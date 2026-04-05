-- Performance Feedback Loop + A/B Testing

-- Add tracking fields to content_drafts
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS content_config_id UUID;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS topic TEXT;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS topic_source TEXT;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS variant_group_id UUID;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS variant_label TEXT DEFAULT 'control';
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS variant_param TEXT;

-- Index for A/B test queries
CREATE INDEX IF NOT EXISTS idx_content_drafts_variant_group ON content_drafts(variant_group_id) WHERE variant_group_id IS NOT NULL;

-- Aggregated performance scores per content type
CREATE TABLE IF NOT EXISTS content_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  period TEXT NOT NULL,
  post_count INTEGER DEFAULT 0,
  avg_likes NUMERIC(10,2) DEFAULT 0,
  avg_comments NUMERIC(10,2) DEFAULT 0,
  avg_shares NUMERIC(10,2) DEFAULT 0,
  avg_engagement_rate NUMERIC(5,2) DEFAULT 0,
  avg_impressions NUMERIC(10,2) DEFAULT 0,
  performance_score NUMERIC(5,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, content_type, platform, period)
);

CREATE INDEX IF NOT EXISTS idx_content_performance_company ON content_performance(company_id);
CREATE INDEX IF NOT EXISTS idx_content_performance_lookup ON content_performance(company_id, content_type, period);

ALTER TABLE content_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read content_performance" ON content_performance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service manage content_performance" ON content_performance FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Anon read content_performance" ON content_performance FOR SELECT TO anon USING (true);

-- Add post_type to post_metrics if not tracking content type yet
-- (post_type column already exists but may not be populated)
