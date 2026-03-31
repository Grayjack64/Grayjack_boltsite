-- ============================================================
-- Social Engagement System Tables
-- ============================================================

-- Incoming messages: comments, mentions, DMs from all platforms
CREATE TABLE IF NOT EXISTS social_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- 'twitter', 'facebook', 'instagram'
  message_type TEXT NOT NULL, -- 'comment', 'mention', 'reply', 'dm'
  platform_message_id TEXT NOT NULL, -- platform's native message ID
  platform_post_id TEXT, -- the post this message is on (if comment/reply)
  author_id TEXT, -- platform user ID of the author
  author_username TEXT,
  author_display_name TEXT,
  content TEXT NOT NULL,
  parent_message_id UUID REFERENCES social_messages(id), -- for threaded replies
  category TEXT DEFAULT 'uncategorized', -- 'question_skincare', 'question_app', 'compliment', 'complaint', 'spam', 'irrelevant', 'uncategorized'
  sentiment TEXT, -- 'positive', 'neutral', 'negative'
  is_spam BOOLEAN DEFAULT false,
  needs_response BOOLEAN DEFAULT true,
  response_status TEXT DEFAULT 'pending', -- 'pending', 'drafted', 'approved', 'sent', 'skipped'
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, platform_message_id)
);

-- AI-drafted responses awaiting approval
CREATE TABLE IF NOT EXISTS social_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES social_messages(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  draft_text TEXT NOT NULL,
  edited_text TEXT, -- human-edited version (if changed before approval)
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'sent', 'failed'
  approved_by TEXT, -- username of approver
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  platform_response_id TEXT, -- platform's ID for the sent response
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Post engagement metrics (pulled every 3 hours)
CREATE TABLE IF NOT EXISTS post_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- 'twitter', 'facebook', 'instagram'
  platform_post_id TEXT NOT NULL,
  post_type TEXT, -- 'blog', 'feature', 'manual'
  blog_post_id UUID, -- link to blog_posts table if applicable
  content_preview TEXT, -- first 200 chars of the post
  post_url TEXT,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0, -- retweets, shares, etc.
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0, -- Instagram saves, Twitter bookmarks
  engagement_rate NUMERIC(5,2) DEFAULT 0, -- (interactions / impressions) * 100
  is_boosted BOOLEAN DEFAULT false,
  boost_spend NUMERIC(10,2) DEFAULT 0,
  boost_start_date TIMESTAMPTZ,
  boost_end_date TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  metrics_updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, platform_post_id)
);

-- Metrics history snapshots (for tracking changes over time)
CREATE TABLE IF NOT EXISTS metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_metric_id UUID NOT NULL REFERENCES post_metrics(id) ON DELETE CASCADE,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_social_messages_company ON social_messages(company_id);
CREATE INDEX idx_social_messages_platform ON social_messages(platform);
CREATE INDEX idx_social_messages_status ON social_messages(response_status);
CREATE INDEX idx_social_messages_category ON social_messages(category);
CREATE INDEX idx_social_messages_received ON social_messages(received_at DESC);
CREATE INDEX idx_social_responses_status ON social_responses(status);
CREATE INDEX idx_social_responses_message ON social_responses(message_id);
CREATE INDEX idx_post_metrics_company ON post_metrics(company_id);
CREATE INDEX idx_post_metrics_platform ON post_metrics(platform);
CREATE INDEX idx_post_metrics_posted ON post_metrics(posted_at DESC);
CREATE INDEX idx_post_metrics_boosted ON post_metrics(is_boosted) WHERE is_boosted = true;
CREATE INDEX idx_metrics_snapshots_post ON metrics_snapshots(post_metric_id);

-- RLS
ALTER TABLE social_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics_snapshots ENABLE ROW LEVEL SECURITY;

-- Authenticated users (dashboard) can read all
CREATE POLICY "Authenticated read social_messages" ON social_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read social_responses" ON social_responses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read post_metrics" ON post_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read metrics_snapshots" ON metrics_snapshots FOR SELECT TO authenticated USING (true);

-- Authenticated users can update responses (approve/reject)
CREATE POLICY "Authenticated update social_responses" ON social_responses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Authenticated users can update post_metrics (manual boost tracking)
CREATE POLICY "Authenticated update post_metrics" ON post_metrics FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Service role full access (for the monitoring engine)
CREATE POLICY "Service role manage social_messages" ON social_messages FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role manage social_responses" ON social_responses FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role manage post_metrics" ON post_metrics FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role manage metrics_snapshots" ON metrics_snapshots FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Anon read for API clients
CREATE POLICY "Anon read post_metrics" ON post_metrics FOR SELECT TO anon USING (true);

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_social_responses_updated_at ON social_responses;
CREATE TRIGGER update_social_responses_updated_at
  BEFORE UPDATE ON social_responses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
