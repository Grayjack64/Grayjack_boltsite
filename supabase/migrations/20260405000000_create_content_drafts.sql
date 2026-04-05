-- Content Drafts — draft/approval/scheduling workflow for social posts
CREATE TABLE IF NOT EXISTS content_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Content
  content_type TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  excerpt TEXT,
  tweet_text TEXT,
  facebook_text TEXT,
  instagram_text TEXT,
  blog_content TEXT,
  image_url TEXT,
  image_prompt TEXT,
  article_url TEXT,

  -- Scheduling
  scheduled_for TIMESTAMPTZ NOT NULL,
  platforms JSONB NOT NULL DEFAULT '["twitter","facebook","instagram"]',

  -- Workflow: draft → approved → publishing → published / rejected / failed
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','publishing','published','rejected','failed')),

  -- Approval
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Publishing results
  tweet_id TEXT,
  facebook_post_id TEXT,
  instagram_media_id TEXT,
  published_at TIMESTAMPTZ,
  publish_error TEXT,

  -- Metadata
  generation_source TEXT DEFAULT 'engine',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_content_drafts_company_status ON content_drafts(company_id, status);
CREATE INDEX idx_content_drafts_approved_due ON content_drafts(scheduled_for) WHERE status = 'approved';
CREATE INDEX idx_content_drafts_calendar ON content_drafts(company_id, scheduled_for);

-- RLS
ALTER TABLE content_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read content_drafts" ON content_drafts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth write content_drafts" ON content_drafts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update content_drafts" ON content_drafts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete content_drafts" ON content_drafts FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service manage content_drafts" ON content_drafts FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Anon read content_drafts" ON content_drafts FOR SELECT TO anon USING (true);

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_content_drafts_updated_at ON content_drafts;
CREATE TRIGGER update_content_drafts_updated_at
  BEFORE UPDATE ON content_drafts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
