-- Multi-format content support: threads and video shorts

-- Thread support
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS thread_tweets JSONB;
-- Format: [{"position":1,"text":"...","image_url":null}, ...]

-- Video support (for Phase B)
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS video_script JSONB;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS video_prompt TEXT;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS video_duration INTEGER;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS reel_caption TEXT;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS shorts_title TEXT;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS tiktok_description TEXT;
