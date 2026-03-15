CREATE TABLE site_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Default settings
INSERT INTO site_settings (key, value) VALUES
  ('site_name',           'Mango People News'),
  ('site_tagline',        'News for Every Indian'),
  ('adsense_enabled',     'false'),
  ('adsense_client_id',   ''),
  ('comment_moderation',  'true'),
  ('articles_per_page',   '10'),
  ('maintenance_mode',    'false');