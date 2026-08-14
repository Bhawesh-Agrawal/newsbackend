-- ============================================================
-- Migration 017: Growth Intelligence - Engagement Tracking
-- ============================================================

-- 1. Raw engagement events (scroll, time, clicks, exits)
CREATE TABLE IF NOT EXISTS article_engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  session_id VARCHAR(255) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  -- event_type values: 'scroll', 'time_interval', 'exit', 'internal_click', 'read_complete'
  event_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_article_date
  ON article_engagement_events(article_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_session
  ON article_engagement_events(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_type
  ON article_engagement_events(event_type, created_at DESC);

-- 2. Pre-aggregated reading stats per article (refreshed hourly)
CREATE TABLE IF NOT EXISTS article_reading_stats (
  article_id UUID PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  avg_read_time_seconds FLOAT DEFAULT 0,
  median_read_time_seconds FLOAT DEFAULT 0,
  avg_scroll_depth FLOAT DEFAULT 0,
  read_completion_rate FLOAT DEFAULT 0,
  quality_read_rate FLOAT DEFAULT 0,
  skimmer_rate FLOAT DEFAULT 0,
  tab_opener_rate FLOAT DEFAULT 0,
  bounce_rate_adjusted FLOAT DEFAULT 0,
  drop_off_25 INT DEFAULT 0,
  drop_off_50 INT DEFAULT 0,
  drop_off_75 INT DEFAULT 0,
  drop_off_100 INT DEFAULT 0,
  avg_pages_after INT DEFAULT 0,
  internal_click_rate FLOAT DEFAULT 0,
  total_sessions INT DEFAULT 0,
  period VARCHAR(10) DEFAULT 'all',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Session journey tracking (what users read in sequence)
CREATE TABLE IF NOT EXISTS session_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(255) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  entry_page VARCHAR(500),
  page_number INT NOT NULL DEFAULT 1,
  time_on_page INT DEFAULT 0,
  scroll_depth INT DEFAULT 0,
  is_bounce BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journey_session
  ON session_journeys(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journey_article
  ON session_journeys(article_id, created_at DESC);

-- 4. SEO cache (for OpenSEO/GSC cached results)
CREATE TABLE IF NOT EXISTS seo_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key VARCHAR(500) NOT NULL UNIQUE,
  source VARCHAR(50) NOT NULL,
  -- source values: 'openseo', 'gsc', 'gemini'
  data JSONB NOT NULL,
  credits_used FLOAT DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_cache_key ON seo_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_seo_cache_expiry ON seo_cache(expires_at);

-- 5. OpenSEO credit tracking
CREATE TABLE IF NOT EXISTS openseo_credit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation VARCHAR(100) NOT NULL,
  credits_used FLOAT NOT NULL,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_log_date ON openseo_credit_log(created_at DESC);

-- 6. Reading stats period support — add a unique constraint for period
ALTER TABLE article_reading_stats DROP CONSTRAINT IF EXISTS article_reading_stats_period_key;
ALTER TABLE article_reading_stats ADD CONSTRAINT article_reading_stats_article_period_key
  UNIQUE (article_id, period);
