-- Brand Characters for consistent video personas
CREATE TABLE IF NOT EXISTS brand_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL, -- 'narrator', 'presenter', 'mascot'
  appearance TEXT NOT NULL, -- detailed visual description for AI consistency
  personality TEXT NOT NULL, -- speaking style, energy level
  voice_id TEXT, -- ElevenLabs voice ID
  voice_provider TEXT DEFAULT 'elevenlabs',
  default_setting TEXT, -- environment they appear in
  wardrobe TEXT, -- consistent clothing description
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_brand_characters_company ON brand_characters(company_id);

ALTER TABLE brand_characters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read brand_characters" ON brand_characters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth write brand_characters" ON brand_characters FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update brand_characters" ON brand_characters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete brand_characters" ON brand_characters FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service manage brand_characters" ON brand_characters FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Anon read brand_characters" ON brand_characters FOR SELECT TO anon USING (true);

DROP TRIGGER IF EXISTS update_brand_characters_updated_at ON brand_characters;
CREATE TRIGGER update_brand_characters_updated_at
  BEFORE UPDATE ON brand_characters FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
