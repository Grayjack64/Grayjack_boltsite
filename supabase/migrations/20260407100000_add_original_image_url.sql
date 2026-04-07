-- Add original_image_url to content_drafts so edits can be reverted
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS original_image_url TEXT;
