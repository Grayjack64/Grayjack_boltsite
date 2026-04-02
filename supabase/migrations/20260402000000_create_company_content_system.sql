-- ============================================================
-- Company Content Management System
-- Content config, knowledge base, media library, events calendar
-- ============================================================

-- 1. Content Configuration — defines content types and weights per company
CREATE TABLE IF NOT EXISTS company_content_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,        -- 'product_ad', 'trending_blog', 'feature_blog', 'quick_tip', 'pain_point_humor', 'ingredient_education', 'lifestyle', 'app_ad', 'event_promo', etc.
  weight INTEGER NOT NULL DEFAULT 25, -- relative weight for random selection (0-100)
  enabled BOOLEAN DEFAULT true,
  creates_blog BOOLEAN DEFAULT false, -- whether this type generates a blog article or social-only post
  description TEXT,                   -- human-readable description of this content type
  prompt_template TEXT,               -- optional custom prompt template for this type
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, content_type)
);

-- 2. Knowledge Base — company-specific information the AI can draw on
CREATE TABLE IF NOT EXISTS company_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category TEXT NOT NULL,             -- 'product', 'feature', 'faq', 'brand_voice', 'testimonial', 'ingredient', 'pricing', 'differentiator', 'target_audience', 'competitor_positioning'
  title TEXT NOT NULL,                -- short title for the entry
  content TEXT NOT NULL,              -- detailed content the AI can use
  priority INTEGER DEFAULT 5,        -- 1-10, higher = more likely to be included in prompts
  tags TEXT[],                        -- array of tags for filtering/search
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Media Library — graphic assets with descriptions for AI selection
CREATE TABLE IF NOT EXISTS company_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,            -- public URL to the asset
  media_type TEXT NOT NULL,           -- 'logo', 'screenshot', 'product_photo', 'lifestyle', 'video', 'infographic', 'banner', 'icon'
  file_type TEXT,                     -- 'image/png', 'image/jpeg', 'video/mp4', etc.
  title TEXT NOT NULL,                -- short title
  description TEXT NOT NULL,          -- detailed description for AI to understand what the asset shows
  tags TEXT[],                        -- searchable tags
  width INTEGER,                     -- pixel dimensions (for images)
  height INTEGER,
  use_frequency TEXT DEFAULT 'sometimes', -- 'always' (logo), 'often', 'sometimes', 'rarely'
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Events Calendar — upcoming events, launches, sales, announcements
CREATE TABLE IF NOT EXISTS company_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  description TEXT NOT NULL,          -- what the AI should know about this event
  event_type TEXT NOT NULL,           -- 'product_launch', 'sale', 'holiday', 'announcement', 'partnership', 'milestone', 'seasonal', 'contest'
  start_date DATE NOT NULL,
  end_date DATE,                      -- null for single-day events
  promo_start_days_before INTEGER DEFAULT 3, -- start mentioning this N days before
  priority INTEGER DEFAULT 5,         -- 1-10, higher = more prominent in posts
  hashtag TEXT,                       -- event-specific hashtag if any
  promo_text TEXT,                    -- specific promotional text to include
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_content_config_company ON company_content_config(company_id);
CREATE INDEX idx_content_config_enabled ON company_content_config(company_id, enabled) WHERE enabled = true;
CREATE INDEX idx_knowledge_company ON company_knowledge(company_id);
CREATE INDEX idx_knowledge_category ON company_knowledge(company_id, category);
CREATE INDEX idx_knowledge_active ON company_knowledge(company_id, active) WHERE active = true;
CREATE INDEX idx_media_company ON company_media(company_id);
CREATE INDEX idx_media_type ON company_media(company_id, media_type);
CREATE INDEX idx_media_active ON company_media(company_id, active) WHERE active = true;
CREATE INDEX idx_events_company ON company_events(company_id);
CREATE INDEX idx_events_dates ON company_events(start_date, end_date);
CREATE INDEX idx_events_active ON company_events(company_id, active) WHERE active = true;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE company_content_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users (admin dashboard) can read and write all
CREATE POLICY "Auth read company_content_config" ON company_content_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth write company_content_config" ON company_content_config FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update company_content_config" ON company_content_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete company_content_config" ON company_content_config FOR DELETE TO authenticated USING (true);

CREATE POLICY "Auth read company_knowledge" ON company_knowledge FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth write company_knowledge" ON company_knowledge FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update company_knowledge" ON company_knowledge FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete company_knowledge" ON company_knowledge FOR DELETE TO authenticated USING (true);

CREATE POLICY "Auth read company_media" ON company_media FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth write company_media" ON company_media FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update company_media" ON company_media FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete company_media" ON company_media FOR DELETE TO authenticated USING (true);

CREATE POLICY "Auth read company_events" ON company_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth write company_events" ON company_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update company_events" ON company_events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete company_events" ON company_events FOR DELETE TO authenticated USING (true);

-- Service role full access (for the social engine)
CREATE POLICY "Service manage company_content_config" ON company_content_config FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service manage company_knowledge" ON company_knowledge FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service manage company_media" ON company_media FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service manage company_events" ON company_events FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Anon read for API clients
CREATE POLICY "Anon read company_content_config" ON company_content_config FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read company_knowledge" ON company_knowledge FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read company_media" ON company_media FOR SELECT TO anon USING (true);
CREATE POLICY "Anon read company_events" ON company_events FOR SELECT TO anon USING (true);

-- ============================================================
-- Updated_at triggers
-- ============================================================

DROP TRIGGER IF EXISTS update_content_config_updated_at ON company_content_config;
CREATE TRIGGER update_content_config_updated_at
  BEFORE UPDATE ON company_content_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_knowledge_updated_at ON company_knowledge;
CREATE TRIGGER update_knowledge_updated_at
  BEFORE UPDATE ON company_knowledge FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_media_updated_at ON company_media;
CREATE TRIGGER update_media_updated_at
  BEFORE UPDATE ON company_media FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_events_updated_at ON company_events;
CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON company_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Seed default content configs for existing companies
-- ============================================================

-- Ora: skincare app with blog + social
INSERT INTO company_content_config (company_id, content_type, weight, enabled, creates_blog, description) VALUES
  ('a88331bc-0222-4cf7-a123-8b917e4851db', 'trending_blog', 30, true, true, 'Trending skincare topic — full blog article with social cross-posting'),
  ('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature_blog', 25, true, true, 'App feature showcase — blog article highlighting a specific Ora feature'),
  ('a88331bc-0222-4cf7-a123-8b917e4851db', 'quick_tip', 25, true, false, 'Quick skincare tip — social-only post, short and actionable'),
  ('a88331bc-0222-4cf7-a123-8b917e4851db', 'app_ad', 20, true, false, 'App download promotion — catchy social post driving app installs')
ON CONFLICT (company_id, content_type) DO NOTHING;

-- The A Balm: product-focused social ads only
INSERT INTO company_content_config (company_id, content_type, weight, enabled, creates_blog, description) VALUES
  ('e57a627c-3b29-44d5-9396-a2478d33ac44', 'product_ad', 40, true, false, 'Direct product promotion — funny, irreverent, buy-now energy'),
  ('e57a627c-3b29-44d5-9396-a2478d33ac44', 'pain_point_humor', 30, true, false, 'Relatable muscle pain humor — memes, jokes, "we feel you" energy'),
  ('e57a627c-3b29-44d5-9396-a2478d33ac44', 'ingredient_education', 15, true, false, 'Ingredient spotlight — arnica, camphor, etc. with product tie-in'),
  ('e57a627c-3b29-44d5-9396-a2478d33ac44', 'lifestyle', 15, true, false, 'Gym culture, athlete recovery, fitness lifestyle with subtle product placement')
ON CONFLICT (company_id, content_type) DO NOTHING;
