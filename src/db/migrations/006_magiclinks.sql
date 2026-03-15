CREATE TABLE magic_link_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_magic_link_token_hash ON magic_link_tokens(token_hash);
CREATE INDEX idx_magic_link_user       ON magic_link_tokens(user_id);
CREATE INDEX idx_magic_link_expires    ON magic_link_tokens(expires_at);