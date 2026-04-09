-- Switch from video count limits to granular credit system
-- Credits: full video 100/200, scene regen 20/40, voiceover 10, recompose 10, preview 5

-- Add credits column to tier_config, replace videos_per_company
ALTER TABLE tier_config ADD COLUMN IF NOT EXISTS video_credits_per_company INTEGER DEFAULT 0;

-- Update tier allocations
UPDATE tier_config SET video_credits_per_company = 0 WHERE tier = 'starter';
UPDATE tier_config SET video_credits_per_company = 300 WHERE tier = 'growth';
UPDATE tier_config SET video_credits_per_company = 1500 WHERE tier = 'pro';
UPDATE tier_config SET video_credits_per_company = 99999 WHERE tier = 'enterprise';

-- Add credit tracking columns to company_usage
ALTER TABLE company_usage ADD COLUMN IF NOT EXISTS video_credits_consumed INTEGER DEFAULT 0;
