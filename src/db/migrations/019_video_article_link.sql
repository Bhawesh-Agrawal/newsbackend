-- ── Link video articles to articles ─────────────────────────────────────────────

ALTER TABLE video_articles
  ADD COLUMN linked_article_id UUID REFERENCES articles(id) ON DELETE SET NULL;

CREATE INDEX idx_video_articles_linked_article ON video_articles(linked_article_id)
  WHERE linked_article_id IS NOT NULL;
