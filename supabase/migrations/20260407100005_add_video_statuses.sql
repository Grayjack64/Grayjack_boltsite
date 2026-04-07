-- Add video generation statuses to content_drafts CHECK constraint
ALTER TABLE content_drafts DROP CONSTRAINT IF EXISTS content_drafts_status_check;
ALTER TABLE content_drafts ADD CONSTRAINT content_drafts_status_check
  CHECK (status IN ('draft', 'approved', 'publishing', 'published', 'rejected', 'failed', 'pending_video', 'generating_video'));
