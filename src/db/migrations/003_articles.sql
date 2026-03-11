CREATE TYPE article_status AS ENUM (
  'draft',
  'review',
  'published',
  'scheduled',
  'archived'
);

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  slug        VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  color       VARCHAR(7) DEFAULT '#6366f1',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(80) NOT NULL UNIQUE,
  slug       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE articles (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title            VARCHAR(300) NOT NULL,
  slug             VARCHAR(350) NOT NULL UNIQUE,
  subtitle         VARCHAR(500),
  body             TEXT NOT NULL,
  body_text        TEXT,
  excerpt          TEXT,
  ai_summary       TEXT,
  cover_image      TEXT,
  category_id      UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  author_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status           article_status NOT NULL DEFAULT 'draft',
  is_featured      BOOLEAN NOT NULL DEFAULT FALSE,
  is_breaking      BOOLEAN NOT NULL DEFAULT FALSE,
  reading_time     INTEGER,
  view_count       BIGINT NOT NULL DEFAULT 0,
  like_count       INTEGER NOT NULL DEFAULT 0,
  comment_count    INTEGER NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ,
  scheduled_at     TIMESTAMPTZ,
  meta_title       VARCHAR(160),
  meta_description VARCHAR(320),
  search_vector    TSVECTOR,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE article_tags (
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

CREATE INDEX idx_articles_slug        ON articles(slug);
CREATE INDEX idx_articles_status      ON articles(status);
CREATE INDEX idx_articles_author      ON articles(author_id);
CREATE INDEX idx_articles_category    ON articles(category_id);
CREATE INDEX idx_articles_published   ON articles(published_at DESC);
CREATE INDEX idx_articles_featured    ON articles(is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_articles_search      ON articles USING GIN(search_vector);
CREATE INDEX idx_article_tags_tag     ON article_tags(tag_id);

CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.subtitle, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.body_text, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_article_search
BEFORE INSERT OR UPDATE ON articles
FOR EACH ROW EXECUTE FUNCTION update_search_vector();

CREATE TRIGGER set_updated_at_articles
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();