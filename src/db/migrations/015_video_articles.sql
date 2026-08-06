-- ── Video Articles Feature ──────────────────────────────────────────────────────

CREATE TYPE video_type AS ENUM ('uploaded', 'embedded');

-- ── video_articles table ────────────────────────────────────────────────────────

CREATE TABLE video_articles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title             VARCHAR(300) NOT NULL,
  slug              VARCHAR(350) NOT NULL UNIQUE,
  subtitle          VARCHAR(500),
  body              TEXT NOT NULL,
  body_text         TEXT,
  excerpt           TEXT,
  ai_summary        TEXT,
  cover_image       TEXT,
  video_type        video_type NOT NULL,
  video_url         TEXT NOT NULL,
  video_public_id   TEXT,
  video_provider    VARCHAR(50),
  video_duration    INTEGER,
  category_id       UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  author_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status            article_status NOT NULL DEFAULT 'draft',
  is_featured       BOOLEAN NOT NULL DEFAULT FALSE,
  is_breaking       BOOLEAN NOT NULL DEFAULT FALSE,
  reading_time      INTEGER,
  view_count        BIGINT NOT NULL DEFAULT 0,
  like_count        INTEGER NOT NULL DEFAULT 0,
  comment_count     INTEGER NOT NULL DEFAULT 0,
  published_at      TIMESTAMPTZ,
  scheduled_at      TIMESTAMPTZ,
  meta_title        VARCHAR(160),
  meta_description  VARCHAR(320),
  search_vector     TSVECTOR,
  featured_at       TIMESTAMPTZ,
  breaking_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── video_article_tags junction table ───────────────────────────────────────────

CREATE TABLE video_article_tags (
  video_article_id UUID NOT NULL REFERENCES video_articles(id) ON DELETE CASCADE,
  tag_id           UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (video_article_id, tag_id)
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX idx_video_articles_slug       ON video_articles(slug);
CREATE INDEX idx_video_articles_status     ON video_articles(status);
CREATE INDEX idx_video_articles_author     ON video_articles(author_id);
CREATE INDEX idx_video_articles_category   ON video_articles(category_id);
CREATE INDEX idx_video_articles_published  ON video_articles(published_at DESC);
CREATE INDEX idx_video_articles_featured   ON video_articles(is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_video_articles_search     ON video_articles USING GIN(search_vector);
CREATE INDEX idx_video_article_tags_tag    ON video_article_tags(tag_id);

-- ── Polymorphic engagement: add video_article_id to existing tables ─────────────

ALTER TABLE article_likes    ADD COLUMN content_type     VARCHAR(20)  DEFAULT 'article';
ALTER TABLE article_likes    ADD COLUMN video_article_id UUID REFERENCES video_articles(id) ON DELETE CASCADE;

ALTER TABLE article_views    ADD COLUMN content_type     VARCHAR(20)  DEFAULT 'article';
ALTER TABLE article_views    ADD COLUMN video_article_id UUID REFERENCES video_articles(id) ON DELETE CASCADE;

ALTER TABLE comments         ADD COLUMN video_article_id UUID REFERENCES video_articles(id) ON DELETE CASCADE;

ALTER TABLE saved_articles   ADD COLUMN video_article_id UUID REFERENCES video_articles(id) ON DELETE CASCADE;

-- ── Unique constraints for polymorphic likes ────────────────────────────────────

ALTER TABLE article_likes ADD CONSTRAINT uq_video_like_user
  UNIQUE (video_article_id, user_id);

ALTER TABLE article_likes ADD CONSTRAINT uq_video_like_fingerprint
  UNIQUE (video_article_id, fingerprint);

-- ── Indexes for polymorphic engagement lookups ──────────────────────────────────

CREATE INDEX idx_video_likes_video_article    ON article_likes(video_article_id) WHERE video_article_id IS NOT NULL;
CREATE INDEX idx_video_views_video_article    ON article_views(video_article_id) WHERE video_article_id IS NOT NULL;
CREATE INDEX idx_video_comments_video_article ON comments(video_article_id) WHERE video_article_id IS NOT NULL;
CREATE INDEX idx_video_saved_video_article    ON saved_articles(video_article_id) WHERE video_article_id IS NOT NULL;

-- ── Full-text search trigger for video_articles ─────────────────────────────────

CREATE OR REPLACE FUNCTION update_video_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.subtitle, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.body_text, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_video_article_search
BEFORE INSERT OR UPDATE ON video_articles
FOR EACH ROW EXECUTE FUNCTION update_video_search_vector();

-- ── Auto-update updated_at trigger ──────────────────────────────────────────────

CREATE TRIGGER set_updated_at_video_articles
  BEFORE UPDATE ON video_articles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
