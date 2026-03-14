CREATE TYPE comment_status AS ENUM ('pending', 'approved', 'rejected', 'spam');

CREATE TABLE comments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id   UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  parent_id    UUID REFERENCES comments(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  status       comment_status NOT NULL DEFAULT 'pending',
  like_count   INTEGER NOT NULL DEFAULT 0,
  ip_address   INET,
  is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
  moderated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE article_likes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  fingerprint VARCHAR(255),
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(article_id, user_id),
  UNIQUE(article_id, fingerprint)
);

CREATE TABLE article_views (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id  VARCHAR(255),
  ip_address  INET,
  referrer    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_article    ON comments(article_id);
CREATE INDEX idx_comments_user       ON comments(user_id);
CREATE INDEX idx_comments_parent     ON comments(parent_id);
CREATE INDEX idx_comments_status     ON comments(status);
CREATE INDEX idx_likes_article       ON article_likes(article_id);
CREATE INDEX idx_views_article       ON article_views(article_id);
CREATE INDEX idx_views_created       ON article_views(created_at DESC);

CREATE TRIGGER set_updated_at_comments
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();