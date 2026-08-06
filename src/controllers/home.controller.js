import sql from '../config/database.js';
import { memCache, TTL } from '../utils/memCache.js';
import { fetchMarketQuotes } from './market.controller.js';

const LIST_COLS = sql`
  a.id, a.title, a.slug, a.subtitle, a.excerpt,
  a.cover_image, a.cover_crop, a.reading_time, a.status,
  a.is_featured, a.is_breaking,
  a.view_count, a.like_count, a.comment_count,
  a.published_at, a.created_at,
  a.ai_summary,
  u.full_name  AS author_name,
  u.avatar_url AS author_avatar,
  c.name  AS category_name,
  c.slug  AS category_slug,
  c.color AS category_color
`;

async function fetchCategories() {
  return memCache.wrap(
    'categories:all',
    () => sql`
      SELECT
        id, name, slug, color, sort_order,
        (
          SELECT COUNT(*)::int FROM articles
          WHERE category_id = categories.id AND status = 'published'
        ) AS article_count
      FROM categories
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, name ASC
    `,
    TTL.CATEGORIES
  );
}

// Fetches hero-pinned articles (ordered by position, then pinned_at)
async function fetchHeroPins() {
  return memCache.wrap(
    'home:heroPins',
    async () => {
      const pins = await sql`
        SELECT article_id, position
        FROM hero_pins
        ORDER BY position ASC, pinned_at DESC
      `;
      if (pins.length === 0) return [];

      const ids = pins.map(p => p.article_id);
      const articles = await sql`
        SELECT ${LIST_COLS}
        FROM articles a
        JOIN users      u ON a.author_id   = u.id
        JOIN categories c ON a.category_id = c.id
        WHERE a.id = ANY(${ids}::uuid[])
          AND a.status = 'published'
      `;
      // Preserve pin order by mapping back
      const articleMap = new Map(articles.map(a => [a.id, a]));
      return ids.map(id => articleMap.get(id)).filter(Boolean);
    },
    TTL.LIST
  );
}

// Merged: replaces fetchBreakingArticles + fetchHeroArticles (was 2 DB hits, now 1)
async function fetchRecentArticles() {
  return memCache.wrap(
    'home:recent:12',
    () => sql`
      SELECT ${LIST_COLS}
      FROM articles a
      JOIN users      u ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.status = 'published'
      ORDER BY a.published_at DESC NULLS LAST, a.created_at DESC
      LIMIT 12
    `,
    TTL.LIST
  );
}

async function fetchAiSummaries() {
  return memCache.wrap(
    'home:aiSummaries:20',
    () => sql`
      SELECT ${LIST_COLS}
      FROM articles a
      JOIN users      u ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.status = 'published'
        AND a.ai_summary IS NOT NULL
        AND a.ai_summary <> ''
        AND a.published_at >= NOW() - INTERVAL '24 HOURS'
      ORDER BY a.published_at DESC NULLS LAST, a.created_at DESC
      LIMIT 20
    `,
    TTL.LIST
  );
}

// Fetches per-category pinned articles, organised by category slug
async function fetchCategoryPinsBySlug() {
  const pins = await sql`
    SELECT cp.category_id, cp.article_id, cp.position,
           c.slug AS category_slug
    FROM category_pins cp
    JOIN categories c ON cp.category_id = c.id
    WHERE c.is_active = TRUE
    ORDER BY cp.position ASC, cp.pinned_at DESC
  `;
  if (pins.length === 0) return {};

  const pinGroup = {};
  const allIds = [];
  for (const p of pins) {
    if (!pinGroup[p.category_slug]) pinGroup[p.category_slug] = [];
    pinGroup[p.category_slug].push(p.article_id);
    allIds.push(p.article_id);
  }

  const uniqueIds = [...new Set(allIds)];
  const articles = await sql`
    SELECT ${LIST_COLS}
    FROM articles a
    JOIN users      u ON a.author_id   = u.id
    JOIN categories c ON a.category_id = c.id
    WHERE a.id = ANY(${uniqueIds}::uuid[])
      AND a.status = 'published'
  `;
  const articleMap = new Map(articles.map(a => [a.id, a]));

  const result = {};
  for (const [slug, ids] of Object.entries(pinGroup)) {
    const pinned = ids.map(id => articleMap.get(id)).filter(Boolean);
    if (pinned.length > 0) result[slug] = pinned;
  }
  return result;
}

// Returns up to 6 recent articles per category (excluding pinned ones)
async function fetchRecentCategoryArticles(excludeMap = {}) {
  const rows = await memCache.wrap(
    'home:categoryArticles',
    () => sql`
      WITH ranked AS (
        SELECT ${LIST_COLS},
          ROW_NUMBER() OVER (
            PARTITION BY c.slug
            ORDER BY a.published_at DESC NULLS LAST, a.created_at DESC
          ) AS rn
        FROM articles a
        JOIN categories c ON a.category_id = c.id
        JOIN users      u ON a.author_id   = u.id
        WHERE a.status = 'published'
          AND c.is_active = TRUE
      )
      SELECT * FROM ranked WHERE rn <= 12
      ORDER BY category_slug ASC, rn ASC
    `,
    TTL.LIST
  );

  const grouped = rows.reduce((acc, article) => {
    const key = article.category_slug;
    if (!acc[key]) acc[key] = [];
    acc[key].push(article);
    return acc;
  }, {});

  // Exclude pinned articles and limit to 6 per category
  for (const [slug, articles] of Object.entries(grouped)) {
    const excluded = new Set(excludeMap[slug] || []);
    grouped[slug] = articles.filter(a => !excluded.has(a.id)).slice(0, 6);
  }
  return grouped;
}

// Merged: combines pinned + recent per category, up to 6 each
async function fetchCategoryArticles() {
  const [pinnedBySlug, recentBySlug] = await Promise.all([
    fetchCategoryPinsBySlug(),
    fetchRecentCategoryArticles(),
  ]);

  const allSlugs = new Set([
    ...Object.keys(pinnedBySlug),
    ...Object.keys(recentBySlug),
  ]);

  const result = {};
  for (const slug of allSlugs) {
    const pinned = pinnedBySlug[slug] || [];
    const recent = recentBySlug[slug] || [];
    result[slug] = [...pinned, ...recent].slice(0, 6);
  }
  return result;
}

const VIDEO_LIST_COLS = sql`
  va.id, va.title, va.slug, va.subtitle, va.excerpt,
  va.cover_image, va.reading_time, va.status,
  va.video_type, va.video_provider, va.video_duration,
  va.is_featured, va.is_breaking,
  va.view_count, va.like_count, va.comment_count,
  va.published_at, va.created_at,
  va.ai_summary,
  u.full_name  AS author_name,
  u.avatar_url AS author_avatar,
  c.name  AS category_name,
  c.slug  AS category_slug,
  c.color AS category_color
`;

async function fetchRecentVideoArticles() {
  return memCache.wrap(
    'home:recentVideos:6',
    () => sql`
      SELECT ${VIDEO_LIST_COLS}
      FROM video_articles va
      JOIN users      u ON va.author_id   = u.id
      JOIN categories c ON va.category_id = c.id
      WHERE va.status = 'published'
      ORDER BY va.published_at DESC NULLS LAST, va.created_at DESC
      LIMIT 6
    `,
    TTL.LIST
  );
}

export const getHomeData = async (req, res, next) => {
  try {
    const [categories, pinnedHero, recent, aiSummaries, categoryArticles, recentVideos] = await Promise.all([
      fetchCategories(),
      fetchHeroPins(),
      fetchRecentArticles(),
      fetchAiSummaries(),
      fetchCategoryArticles(),
      fetchRecentVideoArticles(),
    ]);

    // Warm the market quotes cache in background for the dedicated /market endpoint
    fetchMarketQuotes().catch(() => {});

    // Build hero: pinned articles first, then fill remaining slots with recent articles
    const pinnedIds    = new Set((pinnedHero || []).map(a => a.id));
    const fillArticles = (recent || []).filter(a => !pinnedIds.has(a.id));
    const hero         = [...(pinnedHero || []), ...fillArticles].slice(0, 9);

    return res.json({
      success: true,
      data: {
        categories,
        breaking: recent,           // all 12 (for breaking bar)
        hero,                       // pinned + auto-fill, up to 9
        aiSummaries,
        categoryArticles,
        recentVideos,               // latest 6 video articles
        marketQuotes: [],           // fetched separately by the client
      },
    });
  } catch (err) {
    next(err);
  }
};