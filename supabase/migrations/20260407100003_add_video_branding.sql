-- Add video intro/outro branding to company_settings
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS video_intro_url TEXT;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS video_outro_url TEXT;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS video_intro_duration NUMERIC DEFAULT 2;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS video_outro_duration NUMERIC DEFAULT 3;
