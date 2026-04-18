import sql               from '../config/database.js';
import { memCache, TTL } from '../utils/memCache.js';

const ADMIN_TTL     = 60       * 1_000;   //  1 min  — dashboard stats
const ANALYTICS_TTL =  2 * 60  * 1_000;   //  2 min  — per-article analytics

// ── getDashboardStats ─────────────────────────────────────────────────────────
// 7 independent queries → parallelised with Promise.all.
// Entire result cached for 1 min under 'stats:dashboard'.

export const getDashboardStats = async (req, res, next) => {
  try {
    const cached = await memCache.wrap(
      'stats:dashboard',
      async () => {
        // All 7 queries are independent — run them in parallel.
        const [
          articleStats,
          userStats,
          pendingComments,
          viewsTrend,
          topArticles,
          categoryStats,
          recentActivity,
        ] = await Promise.all([

          // 1. Article counts + engagement totals
          sql`
            SELECT
              COUNT(*)                                         AS total,
              COUNT(*) FILTER (WHERE status = 'published')    AS published,
              COUNT(*) FILTER (WHERE status = 'draft')        AS drafts,
              COUNT(*) FILTER (WHERE status = 'review')       AS in_review,
              COALESCE(SUM(view_count),    0)                  AS total_views,
              COALESCE(SUM(like_count),    0)                  AS total_likes,
              COALESCE(SUM(comment_count), 0)                  AS total_comments
            FROM articles
          `,

          // 2. User counts
          sql`
            SELECT
              COUNT(*)                                                 AS total,
              COUNT(*) FILTER (WHERE role = 'reader')                  AS readers,
              COUNT(*) FILTER (WHERE role = 'author')                  AS authors,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_this_month
            FROM users
          `,

          // 3. Pending comment count
          sql`
            SELECT COUNT(*) AS count
            FROM comments WHERE status = 'pending'
          `,

          // 4. Views per day — last 30 days (line chart)
          sql`
            SELECT
              DATE_TRUNC('day', created_at)::DATE AS date,
              COUNT(*)                            AS views
            FROM article_views
            WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE_TRUNC('day', created_at)
            ORDER BY date ASC
          `,

          // 5. Top 5 articles by views this month
          sql`
            SELECT
              a.id,
              a.title,
              a.slug,
              a.view_count,
              a.like_count,
              a.comment_count,
              a.published_at,
              u.full_name  AS author_name,
              c.name       AS category_name,
              COUNT(av.id) AS views_this_month
            FROM articles a
            LEFT JOIN article_views av
              ON  a.id = av.article_id
              AND av.created_at >= NOW() - INTERVAL '30 days'
            LEFT JOIN users      u ON a.author_id   = u.id
            LEFT JOIN categories c ON a.category_id = c.id
            WHERE a.status = 'published'
            GROUP BY a.id, u.id, c.id
            ORDER BY views_this_month DESC
            LIMIT 5
          `,

          // 6. Views + article count broken down by category
          sql`
            SELECT
              c.name,
              c.color,
              COUNT(DISTINCT a.id)            AS article_count,
              COALESCE(SUM(a.view_count), 0)  AS total_views
            FROM categories c
            LEFT JOIN articles a
              ON  c.id = a.category_id
              AND a.status = 'published'
            GROUP BY c.id
            ORDER BY total_views DESC NULLS LAST
          `,

          // 7. Recent activity — last 10 events across articles + comments
          sql`
            SELECT
              'article'                AS type,
              a.title                  AS description,
              a.status::TEXT, 
              a.created_at             AS timestamp,
              u.full_name              AS actor
            FROM articles a
            JOIN users u ON a.author_id = u.id
            WHERE a.created_at >= NOW() - INTERVAL '7 days'

            UNION ALL

            SELECT
              'comment'                      AS type,
              SUBSTRING(c.body, 1, 60)       AS description,
              c.status::TEXT,
              c.created_at                   AS timestamp,
              u.full_name                    AS actor
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.created_at >= NOW() - INTERVAL '7 days'

            ORDER BY timestamp DESC
            LIMIT 10
          `,
        ]);

        return {
          articles:        articleStats[0],
          users:           userStats[0],
          pendingComments: parseInt(pendingComments[0].count),
          viewsTrend,
          topArticles,
          categoryStats,
          recentActivity,
        };
      },
      ADMIN_TTL,
    );

    return res.status(200).json({ success: true, data: cached });

  } catch (err) {
    next(err);
  }
};

// ── getArticleAnalytics ───────────────────────────────────────────────────────
// 4 independent queries → parallelised with Promise.all.
// Cached per (article id × period) for 2 min.
// The access-control check (does this user own the article, or are they
// editor+?) runs against a tiny single-row lookup BEFORE the heavy queries
// so unauthorised requests never touch the analytics cache.

export const getArticleAnalytics = async (req, res, next) => {
  try {
    const { id }          = req.params;
    const { days = '30' } = req.query;
    const period          = Math.min(90, Math.max(1, parseInt(days)));

    // ── Access control — cheap single-row check, not cached ──────
    const articles = await sql`
      SELECT id, title, author_id FROM articles WHERE id = ${id}
    `;

    if (articles.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    const article      = articles[0];
    const isOwner      = article.author_id === req.user.id;
    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isEditorPlus) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    // ── Heavy analytics — cached per article × period ────────────
    const cacheKey = `analytics:${id}:${period}`;

    const data = await memCache.wrap(
      cacheKey,
      async () => {
        const intervalExpr = sql`(${period} * INTERVAL '1 day')`;

        const [viewsPerDay, referrers, audienceBreakdown, totals] = await Promise.all([

          // Views per day over the requested window
          sql`
            SELECT
              DATE_TRUNC('day', created_at)::DATE AS date,
              COUNT(*)                            AS views
            FROM article_views
            WHERE article_id = ${id}
              AND created_at >= NOW() - ${intervalExpr}
            GROUP BY DATE_TRUNC('day', created_at)
            ORDER BY date ASC
          `,

          // Referrer breakdown
          sql`
            SELECT
              COALESCE(referrer, 'Direct') AS source,
              COUNT(*)                     AS visits
            FROM article_views
            WHERE article_id = ${id}
              AND created_at >= NOW() - ${intervalExpr}
            GROUP BY referrer
            ORDER BY visits DESC
            LIMIT 10
          `,

          // Logged-in vs anonymous — all-time (not period-scoped, intentional:
          // gives a stable audience split ratio that isn't distorted by the
          // window)
          sql`
            SELECT
              COUNT(*) FILTER (WHERE user_id IS NOT NULL) AS logged_in,
              COUNT(*) FILTER (WHERE user_id IS NULL)     AS anonymous
            FROM article_views
            WHERE article_id = ${id}
          `,

          // Snapshot totals from the denormalised columns — much cheaper than
          // COUNT(*) over article_views for a rough number
          sql`
            SELECT view_count, like_count, comment_count
            FROM articles WHERE id = ${id}
          `,
        ]);

        return {
          totals:            totals[0],
          viewsPerDay,
          referrers,
          audienceBreakdown: audienceBreakdown[0],
          period,
        };
      },
      ANALYTICS_TTL,
    );

    return res.status(200).json({ success: true, data });

  } catch (err) {
    next(err);
  }
};