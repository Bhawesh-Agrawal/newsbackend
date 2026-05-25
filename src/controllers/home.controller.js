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

// Fixed: was missing memCache.wrap — ran raw SQL on every request
async function fetchCategoryArticles() {
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
      SELECT * FROM ranked WHERE rn <= 6
      ORDER BY category_slug ASC, rn ASC
    `,
    TTL.LIST
  );

  return rows.reduce((acc, article) => {
    const key = article.category_slug;
    if (!acc[key]) acc[key] = [];
    acc[key].push(article);
    return acc;
  }, {});
}

export const getHomeData = async (req, res, next) => {
  try {
    // Market quotes removed from critical path — no longer blocks response
    const [categories, recent, aiSummaries, categoryArticles] = await Promise.all([
      fetchCategories(),
      fetchRecentArticles(),
      fetchAiSummaries(),
      fetchCategoryArticles(),
    ]);

    // Warm the market quotes cache in background for the dedicated /market endpoint
    fetchMarketQuotes().catch(() => {});

    return res.json({
      success: true,
      data: {
        categories,
        breaking: recent,           // all 12
        hero:     recent.slice(0, 9), // first 9 — no extra DB call
        aiSummaries,
        categoryArticles,
        marketQuotes: [],           // fetched separately by the client
      },
    });
  } catch (err) {
    next(err);
  }
};