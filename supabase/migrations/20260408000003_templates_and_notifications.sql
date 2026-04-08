-- Content templates (saved prompts)
CREATE TABLE IF NOT EXISTS content_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  content_type TEXT DEFAULT 'post',
  tone TEXT,
  must_include TEXT,
  platforms JSONB DEFAULT '["twitter","facebook","instagram"]',
  is_video BOOLEAN DEFAULT false,
  video_style TEXT,
  video_duration INTEGER,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- draft_ready, post_published, post_failed, video_complete, message_received, usage_warning, invite_received
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT, -- optional URL to navigate to
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE content_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage templates" ON content_templates FOR ALL TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE org_id IN (SELECT user_org_ids())));

CREATE POLICY "Users see own notifications" ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications" ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service manage notifications" ON notifications FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service manage templates" ON content_templates FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_content_templates_company ON content_templates(company_id);
