-- Voice library for ElevenLabs voices
CREATE TABLE IF NOT EXISTS voice_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  voice_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT DEFAULT 'elevenlabs',
  gender TEXT,
  accent TEXT,
  age TEXT,
  description TEXT,
  category TEXT,
  preview_url TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE voice_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members see voices" ON voice_library FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()) OR org_id IS NULL);

CREATE POLICY "Org members manage voices" ON voice_library FOR ALL TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY "Service manage voices" ON voice_library FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
