-- ============================================================
-- Migration 018: User Feedback (Micro-Surveys)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  fingerprint VARCHAR(255),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  feedback_type VARCHAR(50) NOT NULL DEFAULT 'survey',
  question_id VARCHAR(100) NOT NULL,
  answer TEXT NOT NULL,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  session_id VARCHAR(255),
  reading_time_seconds INT DEFAULT 0,
  scroll_depth INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for looking up existing submissions
CREATE INDEX IF NOT EXISTS idx_feedback_user
  ON user_feedback(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_fingerprint
  ON user_feedback(fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_article
  ON user_feedback(article_id, created_at DESC);

-- Prevent duplicate submissions per user/fingerprint per question
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_unique_user_question
  ON user_feedback(user_id, question_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_unique_fp_question
  ON user_feedback(fingerprint, question_id)
  WHERE fingerprint IS NOT NULL;
