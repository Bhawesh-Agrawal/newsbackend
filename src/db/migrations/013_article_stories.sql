CREATE TABLE IF NOT EXISTS article_stories (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_url            TEXT UNIQUE NOT NULL,
  source_domain         TEXT,
  title                 TEXT,
  author                TEXT,
  published_at          TIMESTAMPTZ,
  raw_extracted_text    TEXT,
  hero_image_url        TEXT,
  additional_image_urls JSONB,
  short_story_content   TEXT,
  extraction_method_used TEXT,
  extraction_status     TEXT NOT NULL DEFAULT 'pending',
  failure_reason        TEXT,
  ai_model_used         TEXT,
  admin_status          TEXT NOT NULL DEFAULT 'pending_review',
  admin_notes           TEXT,
  reviewed_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_article_stories_admin_status ON article_stories(admin_status);
CREATE INDEX IF NOT EXISTS idx_article_stories_created_at ON article_stories(created_at DESC);

CREATE OR REPLACE FUNCTION update_article_stories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_article_stories_updated_at ON article_stories;
CREATE TRIGGER trg_article_stories_updated_at
  BEFORE UPDATE ON article_stories
  FOR EACH ROW
  EXECUTE FUNCTION update_article_stories_updated_at();
