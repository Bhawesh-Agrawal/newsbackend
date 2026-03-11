CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'editor', 'author', 'reader');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'suspended', 'pending_verification');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE auth_provider AS ENUM ('email', 'google', 'magic_link');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     TEXT,
  full_name         VARCHAR(150) NOT NULL,
  display_name      VARCHAR(100),
  avatar_url        TEXT,
  bio               TEXT,
  role              user_role NOT NULL DEFAULT 'reader',
  status            user_status NOT NULL DEFAULT 'pending_verification',
  auth_provider     auth_provider NOT NULL DEFAULT 'email',
  google_id         VARCHAR(255) UNIQUE,
  email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  last_login_ip     INET,
  login_count       INTEGER NOT NULL DEFAULT 0,
  preferences       JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_updated_at_users'
  ) THEN
    CREATE TRIGGER set_updated_at_users
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;