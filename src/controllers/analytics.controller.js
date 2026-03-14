import sql from '../config/database.js';

export const getDashboardStats = async (req, res, next) => {
  try {

    // ── 1. Article counts by status ──────────────────────────────
    const articleStats = await sql`
      SELECT
        COUNT(*)                                    AS total,
        COUNT(*) FILTER (WHERE status = 'published') AS published,
        COUNT(*) FILTER (WHERE status = 'draft')     AS drafts,
        COUNT(*) FILTER (WHERE status = 'review')    AS in_review,
        SUM(view_count)                             AS total_views,
        SUM(like_count)                             AS total_likes,
        SUM(comment_count)                          AS total_comments
      FROM articles
    `;

    // ── 2. User counts ───────────────────────────────────────────
    const userStats = await sql`
      SELECT
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE role = 'reader')           AS readers,
        COUNT(*) FILTER (WHERE role = 'author')           AS authors,
        COUNT(*) FILTER (WHERE
          created_at >= NOW() - INTERVAL '30 days')       AS new_this_month
      FROM users
    `;

    // ── 3. Comments pending moderation ───────────────────────────
    const pendingComments = await sql`
      SELECT COUNT(*) AS count
      FROM comments WHERE status = 'pending'
    `;

    // ── 4. Views per day — last 30 days (for line chart) ─────────
    const viewsTrend = await sql`
      SELECT
        DATE_TRUNC('day', created_at)::DATE AS date,
        COUNT(*)                            AS views
      FROM article_views
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date ASC
    `;

    // ── 5. Top 5 articles by views this month ────────────────────
    const topArticles = await sql`
      SELECT
        a.id,
        a.title,
        a.slug,
        a.view_count,
        a.like_count,
        a.comment_count,
        a.published_at,
        u.full_name AS author_name,
        c.name      AS category_name,
        COUNT(av.id) AS views_this_month
      FROM articles a
      LEFT JOIN article_views av
        ON a.id = av.article_id
        AND av.created_at >= NOW() - INTERVAL '30 days'
      LEFT JOIN users      u ON a.author_id   = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.status = 'published'
      GROUP BY a.id, u.id, c.id
      ORDER BY views_this_month DESC
      LIMIT 5
    `;

    // ── 6. Views breakdown by category ───────────────────────────
    const categoryStats = await sql`
      SELECT
        c.name,
        c.color,
        COUNT(DISTINCT a.id)  AS article_count,
        SUM(a.view_count)     AS total_views
      FROM categories c
      LEFT JOIN articles a ON c.id = a.category_id
        AND a.status = 'published'
      GROUP BY c.id
      ORDER BY total_views DESC NULLS LAST
    `;

    // ── 7. Recent activity (last 10 things that happened) ────────
    const recentActivity = await sql`
      SELECT
        'article'               AS type,
        a.title                 AS description,
        a.status,
        a.created_at            AS timestamp,
        u.full_name             AS actor
      FROM articles a
      JOIN users u ON a.author_id = u.id
      WHERE a.created_at >= NOW() - INTERVAL '7 days'

      UNION ALL

      SELECT
        'comment'               AS type,
        SUBSTRING(c.body, 1, 60) AS description,
        c.status::TEXT,
        c.created_at            AS timestamp,
        u.full_name             AS actor
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.created_at >= NOW() - INTERVAL '7 days'

      ORDER BY timestamp DESC
      LIMIT 10
    `;

    return res.status(200).json({
      success: true,
      data: {
        articles:        articleStats[0],
        users:           userStats[0],
        pendingComments: parseInt(pendingComments[0].count),
        viewsTrend,
        topArticles,
        categoryStats,
        recentActivity,
      },
    });

  } catch (err) {
    next(err);
  }
};

export const getArticleAnalytics = async (req, res, next) => {
  try {
    const { id }          = req.params;
    const { days = '30' } = req.query;
    const period          = Math.min(90, Math.max(1, parseInt(days)));

    // Verify article exists and requester has access
    const articles = await sql`
      SELECT id, title, author_id FROM articles WHERE id = ${id}
    `;

    if (articles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
      });
    }

    const article = articles[0];

    // Authors can only see analytics for their own articles
    const isOwner      = article.author_id === req.user.id;
    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isEditorPlus) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden',
      });
    }

    // ── Views per day ────────────────────────────────────────────
    const viewsPerDay = await sql`
      SELECT
        DATE_TRUNC('day', created_at)::DATE AS date,
        COUNT(*)                            AS views
      FROM article_views
      WHERE article_id = ${id}
        AND created_at >= NOW() - (${period} || ' days')::INTERVAL
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date ASC
    `;

    // ── Where traffic comes from ─────────────────────────────────
    const referrers = await sql`
      SELECT
        COALESCE(referrer, 'Direct') AS source,
        COUNT(*)                     AS visits
      FROM article_views
      WHERE article_id = ${id}
        AND created_at >= NOW() - (${period} || ' days')::INTERVAL
      GROUP BY referrer
      ORDER BY visits DESC
      LIMIT 10
    `;

    // ── Logged-in vs anonymous readers ───────────────────────────
    const audienceBreakdown = await sql`
      SELECT
        COUNT(*) FILTER (WHERE user_id IS NOT NULL)     AS logged_in,
        COUNT(*) FILTER (WHERE user_id IS NULL)         AS anonymous
      FROM article_views
      WHERE article_id = ${id}
    `;

    // ── Total numbers ────────────────────────────────────────────
    const totals = await sql`
      SELECT view_count, like_count, comment_count
      FROM articles WHERE id = ${id}
    `;

    return res.status(200).json({
      success: true,
      data: {
        totals:           totals[0],
        viewsPerDay,
        referrers,
        audienceBreakdown: audienceBreakdown[0],
        period,
      },
    });

  } catch (err) {
    next(err);
  }
};