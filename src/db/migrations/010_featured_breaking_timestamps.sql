ALTER TABLE articles
  ADD COLUMN featured_at TIMESTAMPTZ,
  ADD COLUMN breaking_at TIMESTAMPTZ;

-- Initialize timestamps for existing active featured/breaking articles
UPDATE articles SET featured_at = COALESCE(published_at, created_at) WHERE is_featured = TRUE;
UPDATE articles SET breaking_at = COALESCE(published_at, created_at) WHERE is_breaking = TRUE;
