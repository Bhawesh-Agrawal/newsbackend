-- ─────────────────────────────────────────────────────────────────
-- Homepage Pinning
-- Allows editors to manually curate which articles appear in the
-- hero section and which articles are featured per category.
-- ─────────────────────────────────────────────────────────────────

-- Hero pins: articles manually pinned to the homepage hero section.
CREATE TABLE IF NOT EXISTS hero_pins (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  pinned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(article_id)
);

CREATE INDEX IF NOT EXISTS idx_hero_pins_position
  ON hero_pins(position ASC, pinned_at DESC);

-- Category pins: articles manually featured per category.
CREATE TABLE IF NOT EXISTS category_pins (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  pinned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(article_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_category_pins_category_position
  ON category_pins(category_id ASC, position ASC, pinned_at DESC);
