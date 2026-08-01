-- Add slug column to article_stories for SEO-friendly URLs
ALTER TABLE article_stories ADD COLUMN IF NOT EXISTS slug TEXT;

-- Unique index for slug lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_article_stories_slug ON article_stories(slug);

-- Backfill existing approved stories with slugs generated from their titles
-- Uses the same collision resolution as articles: append timestamp on conflict
DO $$
DECLARE
  row RECORD;
  base_slug TEXT;
  final_slug TEXT;
  slug_count INT;
BEGIN
  FOR row IN
    SELECT id, title FROM article_stories
    WHERE admin_status = 'approved' AND title IS NOT NULL AND slug IS NULL
  LOOP
    -- Generate base slug from title (lowercase, strict mode)
    base_slug := lower(regexp_replace(regexp_replace(trim(row.title), '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'));
    base_slug := trim(both '-' from base_slug);

    -- Truncate to reasonable length
    IF length(base_slug) > 280 THEN
      base_slug := left(base_slug, 280);
    END IF;

    -- Check for slug collision
    SELECT COUNT(*)::int INTO slug_count FROM article_stories WHERE slug = base_slug;

    IF slug_count > 0 THEN
      final_slug := base_slug || '-' || EXTRACT(EPOCH FROM NOW())::bigint;
    ELSE
      final_slug := base_slug;
    END IF;

    UPDATE article_stories SET slug = final_slug WHERE id = row.id;
  END LOOP;
END $$;
