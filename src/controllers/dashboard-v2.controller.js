import sql from '../config/database.js';
import { memCache, TTL } from '../utils/memCache.js';
import * as ga4 from '../services/google-analytics.service.js';
import * as gsc from '../services/search-console.service.js';
import * as monitor from '../services/cloud-monitoring.service.js';

const ADMIN_TTL = 60 * 1_000;

// ── Dashboard KPIs ───────────────────────────────────────────────────────────
export const getDashboardKPIs = async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;

    const [ga4Kpis, articleCount, searchMetrics] = await Promise.all([
      ga4.getKPIs(period).catch(() => null),
      sql`SELECT COUNT(*)::INT AS count FROM articles WHERE status = 'published'`,
      gsc.getPerformance(period, ['date']).catch(() => null),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        pageViews: ga4Kpis?.pageViews || { value: 0, change: 0 },
        uniqueVisitors: ga4Kpis?.uniqueVisitors || { value: 0, change: 0 },
        organicClicks: {
          value: searchMetrics?.totalClicks || 0,
          change: 0,
        },
        searchImpressions: {
          value: searchMetrics?.totalImpressions || 0,
          change: 0,
        },
        avgEngagementTime: ga4Kpis?.avgEngagementTime || { value: 0, change: 0 },
        publishedArticles: {
          value: articleCount[0]?.count || 0,
          change: 0,
        },
        viewsTrend: ga4Kpis?.viewsTrend || [],
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Dashboard Trend ──────────────────────────────────────────────────────────
export const getDashboardTrend = async (req, res, next) => {
  try {
    const { metric = 'pageViews', period = '30d' } = req.query;

    let trendData;
    if (metric === 'organicClicks' || metric === 'searchImpressions') {
      const gscData = await gsc.getPerformance(period, ['date']);
      trendData = gscData.rows.map(r => ({
        date: r.keys[0],
        value: metric === 'organicClicks' ? r.clicks : r.impressions,
      }));
    } else {
      trendData = await ga4.getTrend(metric, period);
    }

    return res.status(200).json({ success: true, data: trendData });
  } catch (err) {
    next(err);
  }
};

// ── Dashboard Top Articles ───────────────────────────────────────────────────
export const getTopArticles = async (req, res, next) => {
  try {
    const { period = '30d', limit = 10 } = req.query;
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

    const articles = await sql`
      SELECT
        a.id,
        a.title,
        a.slug,
        a.view_count,
        a.like_count,
        a.published_at,
        u.full_name AS author_name,
        c.name AS category_name,
        COUNT(av.id)::INT AS period_views
      FROM articles a
      LEFT JOIN article_views av
        ON a.id = av.article_id
        AND av.created_at >= NOW() - (${days} * INTERVAL '1 day')
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.status = 'published'
      GROUP BY a.id, u.id, c.id
      ORDER BY period_views DESC
      LIMIT ${parseInt(limit)}
    `;

    return res.status(200).json({ success: true, data: articles });
  } catch (err) {
    next(err);
  }
};

// ── Dashboard Declining Articles ─────────────────────────────────────────────
export const getDecliningArticles = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    const articles = await sql`
      WITH current_period AS (
        SELECT
          article_id,
          COUNT(*)::INT AS views
        FROM article_views
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY article_id
      ),
      previous_period AS (
        SELECT
          article_id,
          COUNT(*)::INT AS views
        FROM article_views
        WHERE created_at >= NOW() - INTERVAL '60 days'
          AND created_at < NOW() - INTERVAL '30 days'
        GROUP BY article_id
      )
      SELECT
        a.id,
        a.title,
        a.slug,
        COALESCE(cp.views, 0) AS current_views,
        COALESCE(pp.views, 0) AS previous_views,
        CASE
          WHEN COALESCE(pp.views, 0) > 0
          THEN ROUND(((COALESCE(cp.views, 0) - pp.views)::NUMERIC / pp.views * 100), 1)
          ELSE 0
        END::FLOAT AS change_pct,
        u.full_name AS author_name,
        c.name AS category_name
      FROM articles a
      LEFT JOIN current_period cp ON a.id = cp.article_id
      LEFT JOIN previous_period pp ON a.id = pp.article_id
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.status = 'published'
        AND COALESCE(cp.views, 0) < COALESCE(pp.views, 0)
      ORDER BY change_pct ASC
      LIMIT ${parseInt(limit)}
    `;

    return res.status(200).json({ success: true, data: articles });
  } catch (err) {
    next(err);
  }
};

// ── Dashboard Opportunities (GSC) ───────────────────────────────────────────
export const getOpportunities = async (req, res, next) => {
  try {
    const { period = '28d' } = req.query;

    const opportunities = await gsc.getOpportunities(period);

    return res.status(200).json({ success: true, data: opportunities });
  } catch (err) {
    next(err);
  }
};

// ── Dashboard Health ─────────────────────────────────────────────────────────
export const getHealth = async (req, res, next) => {
  try {
    const health = await monitor.getServiceHealth();

    return res.status(200).json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
};

// ── Analytics Overview ───────────────────────────────────────────────────────
export const getAnalyticsOverview = async (req, res, next) => {
  try {
    const {
      period = '30d',
      source,
      device,
      country,
    } = req.query;

    const filters = {};
    if (source) filters.source = source;
    if (device) filters.device = device;
    if (country) filters.country = country;

    const [pageViews, visitors, engagement, sources, devices, geo, searchPerf] = await Promise.all([
      ga4.getPageViews(period, filters).catch(() => []),
      ga4.getUniqueVisitors(period, filters).catch(() => []),
      ga4.getEngagementMetrics(period, filters).catch(() => ({})),
      ga4.getTrafficSources(period, filters).catch(() => []),
      ga4.getDeviceBreakdown(period, filters).catch(() => []),
      ga4.getGeoBreakdown(period, filters).catch(() => []),
      gsc.getPerformance(period, ['date']).catch(() => ({ rows: [], totalClicks: 0, totalImpressions: 0 })),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        pageViews,
        visitors,
        engagement,
        sources,
        devices,
        geo,
        searchPerformance: searchPerf,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Analytics Article Table ──────────────────────────────────────────────────
export const getAnalyticsArticles = async (req, res, next) => {
  try {
    const {
      period = '30d',
      sort = 'views',
      order = 'desc',
      page = 1,
      limit = 20,
      category,
      author,
      format,
    } = req.query;

    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = sql`WHERE a.status = 'published'`;
    if (category) whereClause = sql`${whereClause} AND c.slug = ${category}`;
    if (author) whereClause = sql`${whereClause} AND u.id = ${author}`;

    const sortColumn = {
      views: 'period_views',
      likes: 'period_likes',
      comments: 'period_comments',
      title: 'a.title',
      date: 'a.published_at',
    }[sort] || 'period_views';

    const orderDir = order === 'asc' ? sql`ASC` : sql`DESC`;

    const articles = await sql.unsafe(`
      SELECT
        a.id,
        a.title,
        a.slug,
        a.published_at,
        a.view_count AS total_views,
        a.like_count AS total_likes,
        a.comment_count AS total_comments,
        u.full_name AS author_name,
        c.name AS category_name,
        c.slug AS category_slug,
        (SELECT COUNT(*)::INT FROM article_views av2
         WHERE av2.article_id = a.id
         AND av2.created_at >= NOW() - INTERVAL '${days} days') AS period_views,
        (SELECT COUNT(*)::INT FROM article_likes al
         WHERE al.article_id = a.id
         AND al.created_at >= NOW() - INTERVAL '${days} days') AS period_likes,
        (SELECT COUNT(*)::INT FROM comments cm
         WHERE cm.article_id = a.id
         AND cm.created_at >= NOW() - INTERVAL '${days} days') AS period_comments
      FROM articles a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      ${whereClause}
      ORDER BY ${sql.unsafe(sortColumn)} ${orderDir} NULLS LAST
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `);

    const [countResult] = await sql.unsafe(`
      SELECT COUNT(*)::INT AS total
      FROM articles a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      ${whereClause}
    `);

    return res.status(200).json({
      success: true,
      data: {
        articles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult?.total || 0,
          pages: Math.ceil((countResult?.total || 0) / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Search Console Queries ───────────────────────────────────────────────────
export const getGSCQueries = async (req, res, next) => {
  try {
    const { period = '28d', limit = 100 } = req.query;

    const queries = await gsc.getQueries(period, parseInt(limit));

    return res.status(200).json({ success: true, data: queries });
  } catch (err) {
    next(err);
  }
};

// ── Search Console Pages ─────────────────────────────────────────────────────
export const getGSCPages = async (req, res, next) => {
  try {
    const { period = '28d', limit = 100 } = req.query;

    const pages = await gsc.getPages(period, parseInt(limit));

    return res.status(200).json({ success: true, data: pages });
  } catch (err) {
    next(err);
  }
};

// ── Search Console Opportunities ─────────────────────────────────────────────
export const getGSCOpportunities = async (req, res, next) => {
  try {
    const { period = '28d' } = req.query;

    const opportunities = await gsc.getOpportunities(period);

    return res.status(200).json({ success: true, data: opportunities });
  } catch (err) {
    next(err);
  }
};

// ── Operations: Requests ─────────────────────────────────────────────────────
export const getOperationsRequests = async (req, res, next) => {
  try {
    const { duration = 60 } = req.query;

    const data = await monitor.getRequestMetrics(parseInt(duration));

    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// ── Operations: Errors ───────────────────────────────────────────────────────
export const getOperationsErrors = async (req, res, next) => {
  try {
    const { duration = 60 } = req.query;

    const data = await monitor.getErrorMetrics(parseInt(duration));

    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// ── Operations: Health ───────────────────────────────────────────────────────
export const getOperationsHealth = async (req, res, next) => {
  try {
    const [health, requests, errors] = await Promise.all([
      monitor.getServiceHealth(),
      monitor.getRequestMetrics(60),
      monitor.getErrorMetrics(60),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        health,
        requests,
        errors,
      },
    });
  } catch (err) {
    next(err);
  }
};
