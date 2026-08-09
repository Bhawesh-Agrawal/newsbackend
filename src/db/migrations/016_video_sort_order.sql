-- 016: Add sort_order to video_articles for manual ordering
ALTER TABLE video_articles ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_video_articles_sort_order ON video_articles (sort_order ASC);
