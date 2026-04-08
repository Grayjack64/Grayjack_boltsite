-- Add YouTube fields to google_accounts
ALTER TABLE google_accounts ADD COLUMN IF NOT EXISTS youtube_channel_id TEXT;
ALTER TABLE google_accounts ADD COLUMN IF NOT EXISTS youtube_channel_name TEXT;
ALTER TABLE google_accounts ADD COLUMN IF NOT EXISTS youtube_enabled BOOLEAN DEFAULT false;
