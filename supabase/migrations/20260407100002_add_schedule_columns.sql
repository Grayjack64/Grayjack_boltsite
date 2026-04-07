-- Add flexible posting schedule columns to company_settings
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS post_frequency TEXT DEFAULT 'daily';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS posts_per_week INTEGER DEFAULT 7;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS posts_per_month INTEGER DEFAULT 30;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS preferred_times JSONB DEFAULT '["09:00", "15:00"]';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS preferred_days JSONB DEFAULT '["mon", "tue", "wed", "thu", "fri"]';
