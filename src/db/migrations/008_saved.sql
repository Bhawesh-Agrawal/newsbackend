CREATE TABLE IF NOT EXISTS saved_articles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id    UUID        NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One save per user per article
  CONSTRAINT saved_articles_user_article_unique UNIQUE (user_id, article_id)
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_saved_articles_user_id
  ON saved_articles (user_id, created_at DESC);