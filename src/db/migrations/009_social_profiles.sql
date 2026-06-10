-- Add optional social media profile fields to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS instagram_profile VARCHAR(255),
ADD COLUMN IF NOT EXISTS twitter_profile VARCHAR(255),
ADD COLUMN IF NOT EXISTS linkedin_profile VARCHAR(255);

-- Create indexes for quick lookup if needed
CREATE INDEX IF NOT EXISTS idx_users_instagram_profile ON users(instagram_profile) WHERE instagram_profile IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_twitter_profile ON users(twitter_profile) WHERE twitter_profile IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_linkedin_profile ON users(linkedin_profile) WHERE linkedin_profile IS NOT NULL;
