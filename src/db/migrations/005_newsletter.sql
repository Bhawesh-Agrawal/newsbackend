CREATE TABLE newsletter_subscribers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             VARCHAR(255) NOT NULL UNIQUE,
  full_name         VARCHAR(150),
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  is_confirmed      BOOLEAN NOT NULL DEFAULT FALSE,
  confirm_token     TEXT UNIQUE,
  confirmed_at      TIMESTAMPTZ,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  unsubscribed_at   TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  source            VARCHAR(50),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE newsletter_campaigns (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       VARCHAR(300) NOT NULL,
  subject     VARCHAR(300) NOT NULL,
  body_html   TEXT NOT NULL,
  body_text   TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'draft',
  sent_at     TIMESTAMPTZ,
  sent_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_newsletter_email    ON newsletter_subscribers(email);
CREATE INDEX idx_newsletter_active   ON newsletter_subscribers(is_active)
  WHERE is_active = TRUE;
CREATE INDEX idx_newsletter_confirm  ON newsletter_subscribers(confirm_token)
  WHERE confirm_token IS NOT NULL;
CREATE INDEX idx_newsletter_unsub    ON newsletter_subscribers(unsubscribe_token);

CREATE TRIGGER set_updated_at_newsletter
  BEFORE UPDATE ON newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_campaigns
  BEFORE UPDATE ON newsletter_campaigns
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();