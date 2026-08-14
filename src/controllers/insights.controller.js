import sql from '../config/database.js';
import * as ga4 from '../services/google-analytics.service.js';
import * as gsc from '../services/search-console.service.js';
import * as openseo from '../services/openseo.service.js';

// ── Action Center: What should I do today? ──────────────────────────────────
export const getActionCenter = async (req, res, next) => {
  try {
    const [decayArticles, risingQueries, postingTime, creditStatus] = await Promise.all([
      // Articles losing traffic (need refresh)
      sql`
        WITH current_period AS (
          SELECT article_id, COUNT(*)::INT AS views
          FROM article_views
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY article_id
        ),
        previous_period AS (
          SELECT article_id, COUNT(*)::INT AS views
          FROM article_views
          WHERE created_at >= NOW() - INTERVAL '60 days'
            AND created_at < NOW() - INTERVAL '30 days'
          GROUP BY article_id
        )
        SELECT
          a.id, a.title, a.slug,
          COALESCE(cp.views, 0) AS current_views,
          COALESCE(pp.views, 0) AS previous_views,
          ROUND(
            CASE WHEN COALESCE(pp.views, 0) > 0
            THEN ((COALESCE(cp.views, 0) - pp.views)::NUMERIC / pp.views * 100)
            ELSE 0 END, 1
          )::FLOAT AS change_pct
        FROM articles a
        LEFT JOIN current_period cp ON a.id = cp.article_id
        LEFT JOIN previous_period pp ON a.id = pp.article_id
        WHERE a.status = 'published'
          AND COALESCE(cp.views, 0) < COALESCE(pp.views, 0)
          AND pp.views >= 10
        ORDER BY change_pct ASC
        LIMIT 5
      `,

      // Rising queries (high impressions, low position — opportunities)
      gsc.getOpportunities('28d').catch(() => ({
        highImpressionLowCtr: [],
        positions4to10: [],
        positions11to20: [],
      })),

      // Best posting time analysis
      getOptimalPostingTimes().catch(() => null),

      // OpenSEO credit status
      openseo.getCreditStatus().catch(() => ({ remaining: 0, is_depleted: true })),
    ]);

    // Build action items
    const actions = [];

    // Decay alerts
    if (decayArticles.length > 0) {
      actions.push({
        type: 'refresh',
        priority: 'high',
        title: `${decayArticles.length} articles losing traffic`,
        description: `Consider refreshing: ${decayArticles.slice(0, 3).map(a => a.title).join(', ')}`,
        articles: decayArticles,
      });
    }

    // Quick wins from GSC
    const quickWins = (risingQueries.highImpressionLowCtr || []).slice(0, 5);
    if (quickWins.length > 0) {
      actions.push({
        type: 'optimize_title',
        priority: 'medium',
        title: `${quickWins.length} articles with low CTR — rewrite titles`,
        description: 'These articles get impressions but not clicks. Better titles could boost traffic.',
        queries: quickWins,
      });
    }

    // Striking distance
    const strikingDistance = (risingQueries.positions4to10 || []).slice(0, 5);
    if (strikingDistance.length > 0) {
      actions.push({
        type: 'add_links',
        priority: 'medium',
        title: `${strikingDistance.length} articles on page 1 bottom — add internal links`,
        description: 'These rank 4-10. A few internal links could push them higher.',
        queries: strikingDistance,
      });
    }

    // Posting time recommendation
    if (postingTime) {
      actions.push({
        type: 'best_time',
        priority: 'low',
        title: `Best time to publish: ${postingTime.bestHour}`,
        description: postingTime.insight,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        actions,
        creditStatus,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Growth Trends ────────────────────────────────────────────────────────────
export const getGrowthTrends = async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;

    const [ga4Trend, gscTrend, engagementTrend] = await Promise.all([
      ga4.getTrend('pageViews', period).catch(() => []),
      gsc.getPerformance(period, ['date']).catch(() => ({ rows: [] })),
      sql`
        SELECT
          DATE(created_at) AS date,
          COUNT(DISTINCT session_id)::INT AS sessions,
          AVG((event_data->>'scroll_pct')::FLOAT) AS avg_scroll
        FROM article_engagement_events
        WHERE event_type = 'time_interval'
          AND created_at > NOW() - (${period === '7d' ? 7 : period === '90d' ? 90 : 30} * INTERVAL '1 day')
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `,
    ]);

    return res.status(200).json({
      success: true,
      data: {
        pageViews: ga4Trend,
        searchClicks: (gscTrend.rows || []).map(r => ({
          date: r.keys?.[0],
          clicks: r.clicks,
          impressions: r.impressions,
        })),
        engagement: engagementTrend,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Title Pattern Analysis ───────────────────────────────────────────────────
export const getTitleAnalysis = async (req, res, next) => {
  try {
    // Get top queries from GSC
    const queries = await gsc.getQueries('28d', 200);

    // Analyze title patterns
    const patterns = {
      hasNumbers: { count: 0, totalCtr: 0, totalPosition: 0 },
      hasQuestion: { count: 0, totalCtr: 0, totalPosition: 0 },
      hasHowTo: { count: 0, totalCtr: 0, totalPosition: 0 },
      hasYear: { count: 0, totalCtr: 0, totalPosition: 0 },
      hasComparison: { count: 0, totalCtr: 0, totalPosition: 0 },
      hasColon: { count: 0, totalCtr: 0, totalPosition: 0 },
      other: { count: 0, totalCtr: 0, totalPosition: 0 },
    };

    // Get published articles and match against queries
    const articles = await sql`
      SELECT title, meta_title, slug FROM articles
      WHERE status = 'published' AND published_at > NOW() - INTERVAL '90 days'
    `;

    const insights = [];

    for (const article of articles) {
      const title = article.meta_title || article.title || '';

      // Classify title pattern
      let pattern = 'other';
      if (/\d+/.test(title)) pattern = 'hasNumbers';
      else if (/\?/.test(title)) pattern = 'hasQuestion';
      else if (/how\s+to/i.test(title)) pattern = 'hasHowTo';
      else if (/20\d{2}/.test(title)) pattern = 'hasYear';
      else if (/\bvs\.?\b|comparison|compared/i.test(title)) pattern = 'hasComparison';
      else if (/:/.test(title)) pattern = 'hasColon';

      // Find GSC data for this article's URL
      const matchingQuery = (queries || []).find(q =>
        q.page?.includes(article.slug)
      );

      if (matchingQuery) {
        patterns[pattern].count++;
        patterns[pattern].totalCtr += matchingQuery.ctr || 0;
        patterns[pattern].totalPosition += matchingQuery.position || 0;
      }
    }

    // Compute averages
    const patternSummary = Object.entries(patterns)
      .filter(([_, v]) => v.count > 0)
      .map(([key, v]) => ({
        pattern: key,
        count: v.count,
        avgCtr: v.totalCtr / v.count,
        avgPosition: v.totalPosition / v.count,
        ctrFormatted: `${((v.totalCtr / v.count) * 100).toFixed(1)}%`,
      }))
      .sort((a, b) => b.avgCtr - a.avgCtr);

    // Generate insights
    if (patternSummary.length > 0) {
      const best = patternSummary[0];
      const worst = patternSummary[patternSummary.length - 1];

      insights.push({
        type: 'best_pattern',
        text: `Your "${formatPatternName(best.pattern)}" titles get ${(best.avgCtr * 100).toFixed(1)}% CTR (avg position ${best.avgPosition.toFixed(0)})`,
      });

      if (best.avgCtr > worst.avgCtr * 1.5) {
        insights.push({
          type: 'improvement',
          text: `Switching "${formatPatternName(worst.pattern)}" titles to "${formatPatternName(best.pattern)}" format could improve CTR by ${((best.avgCtr / worst.avgCtr - 1) * 100).toFixed(0)}%`,
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        patterns: patternSummary,
        insights,
        totalArticlesAnalyzed: articles.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Optimal Posting Times ────────────────────────────────────────────────────
export const getPostingTimes = async (req, res, next) => {
  try {
    const result = await getOptimalPostingTimes();

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

async function getOptimalPostingTimes() {
  // Analyze engagement by hour of day
  const hourlyEngagement = await sql`
    SELECT
      EXTRACT(HOUR FROM sj.created_at)::INT AS hour,
      COUNT(*)::INT AS total_sessions,
      AVG(sj.time_on_page)::INT AS avg_time_on_page,
      AVG(sj.scroll_depth)::INT AS avg_scroll_depth,
      AVG(CASE WHEN sj.is_bounce THEN 0 ELSE 1 END)::FLOAT AS retention_rate
    FROM session_journeys sj
    WHERE sj.created_at > NOW() - INTERVAL '30 days'
    GROUP BY EXTRACT(HOUR FROM sj.created_at)
    ORDER BY hour ASC
  `;

  // Analyze by day of week
  const dailyEngagement = await sql`
    SELECT
      EXTRACT(DOW FROM sj.created_at)::INT AS dow,
      COUNT(*)::INT AS total_sessions,
      AVG(sj.time_on_page)::INT AS avg_time_on_page,
      AVG(CASE WHEN sj.is_bounce THEN 0 ELSE 1 END)::FLOAT AS retention_rate
    FROM session_journeys sj
    WHERE sj.created_at > NOW() - INTERVAL '30 days'
    GROUP BY EXTRACT(DOW FROM sj.created_at)
    ORDER BY dow ASC
  `;

  // Find best hours
  const bestHours = hourlyEngagement
    .sort((a, b) => b.retention_rate - a.retention_rate)
    .slice(0, 3);

  // Find publication times vs consumption times
  const publishTimes = await sql`
    SELECT
      EXTRACT(HOUR FROM published_at)::INT AS hour,
      COUNT(*)::INT AS articles_published
    FROM articles
    WHERE status = 'published'
      AND published_at > NOW() - INTERVAL '30 days'
    GROUP BY EXTRACT(HOUR FROM published_at)
    ORDER BY hour ASC
  `;

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return {
    hourly: hourlyEngagement,
    daily: dailyEngagement.map(d => ({ ...d, day_name: dayNames[d.dow] })),
    publishTimes,
    bestHours: bestHours.map(h => ({
      hour: h.hour,
      label: `${h.hour.toString().padStart(2, '0')}:00`,
      retentionRate: (h.retention_rate * 100).toFixed(1) + '%',
      avgTimeOnPage: h.avg_time_on_page,
    })),
    insight: bestHours.length > 0
      ? `Your audience is most engaged around ${bestHours[0].hour.toString().padStart(2, '0')}:00. Publishing 1-2 hours before this window maximizes early engagement.`
      : 'Not enough data yet to determine optimal posting times. Check back after a week of engagement tracking.',
  };
}

// ── Topic Clusters ───────────────────────────────────────────────────────────
export const getTopicClusters = async (req, res, next) => {
  try {
    // Build clusters based on category + tag co-occurrence
    const clusters = await sql`
      WITH article_data AS (
        SELECT
          a.id, a.title, a.slug, a.view_count, a.published_at,
          c.name AS category_name, c.slug AS category_slug, c.color AS category_color,
          ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL) AS tags
        FROM articles a
        LEFT JOIN categories c ON a.category_id = c.id
        LEFT JOIN article_tags at ON a.id = at.article_id
        LEFT JOIN tags t ON at.tag_id = t.id
        WHERE a.status = 'published'
        GROUP BY a.id, c.id
      )
      SELECT
        category_name,
        category_slug,
        category_color,
        COUNT(*)::INT AS article_count,
        SUM(view_count)::BIGINT AS total_views,
        AVG(view_count)::FLOAT AS avg_views,
        ARRAY_AGG(
          JSONB_BUILD_OBJECT(
            'id', id,
            'title', title,
            'slug', slug,
            'view_count', view_count,
            'tags', tags
          )
        ) AS articles
      FROM article_data
      WHERE category_name IS NOT NULL
      GROUP BY category_name, category_slug, category_color
      ORDER BY total_views DESC
    `;

    // Identify weak clusters (few articles, low views)
    const weakClusters = clusters.filter(c => c.article_count < 5 || c.avg_views < 100);

    return res.status(200).json({
      success: true,
      data: {
        clusters,
        weakClusters,
        insights: weakClusters.map(c => ({
          type: 'cluster_gap',
          text: `"${c.category_name}" has only ${c.article_count} articles (avg ${Math.round(c.avg_views)} views). Consider adding more content to strengthen this cluster.`,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Keyword Research (OpenSEO) ───────────────────────────────────────────────
export const getKeywordResearch = async (req, res, next) => {
  try {
    const { keywords, country = 'IN' } = req.query;

    if (!keywords) {
      return res.status(400).json({ success: false, message: 'keywords parameter required' });
    }

    const keywordList = keywords.split(',').map(k => k.trim()).filter(Boolean);
    const results = await openseo.keywordResearch(keywordList, { country });

    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
};

// ── OpenSEO Credit Status ────────────────────────────────────────────────────
export const getSeoCredits = async (req, res, next) => {
  try {
    const status = await openseo.getCreditStatus();
    return res.status(200).json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
};

// ── Content Decay Detection ──────────────────────────────────────────────────
export const getDecayDetection = async (req, res, next) => {
  try {
    const { threshold = -20 } = req.query;

    const declining = await sql`
      WITH current_period AS (
        SELECT article_id, COUNT(*)::INT AS views
        FROM article_views
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY article_id
      ),
      previous_period AS (
        SELECT article_id, COUNT(*)::INT AS views
        FROM article_views
        WHERE created_at >= NOW() - INTERVAL '60 days'
          AND created_at < NOW() - INTERVAL '30 days'
        GROUP BY article_id
      )
      SELECT
        a.id, a.title, a.slug, a.published_at, a.reading_time,
        COALESCE(cp.views, 0) AS current_views,
        COALESCE(pp.views, 0) AS previous_views,
        ROUND(
          CASE WHEN COALESCE(pp.views, 0) > 0
          THEN ((COALESCE(cp.views, 0) - pp.views)::NUMERIC / pp.views * 100)
          ELSE 0 END, 1
        )::FLOAT AS change_pct,
        u.full_name AS author_name,
        c.name AS category_name,
        ars.quality_read_rate,
        ars.avg_scroll_depth
      FROM articles a
      LEFT JOIN current_period cp ON a.id = cp.article_id
      LEFT JOIN previous_period pp ON a.id = pp.article_id
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN article_reading_stats ars ON a.id = ars.article_id AND ars.period = 'all'
      WHERE a.status = 'published'
        AND COALESCE(cp.views, 0) < COALESCE(pp.views, 0)
        AND pp.views >= 10
      ORDER BY change_pct ASC
      LIMIT 20
    `;

    // Classify decay reasons
    const analyzed = declining.map(article => {
      let reason = 'unknown';
      if (article.change_pct < -50) reason = 'severe_decline';
      else if (article.change_pct < -30) reason = 'significant_decline';
      else reason = 'moderate_decline';

      let recommendation = 'Consider updating with fresh information.';
      if (article.quality_read_rate && article.quality_read_rate < 0.3) {
        recommendation = 'Low read quality + declining views. Rewrite with better structure and hook.';
      } else if (article.change_pct < -50) {
        recommendation = 'Severe decline. Major refresh needed or topic may be seasonal.';
      }

      return { ...article, reason, recommendation };
    });

    return res.status(200).json({ success: true, data: analyzed });
  } catch (err) {
    next(err);
  }
};

// ── Helper ───────────────────────────────────────────────────────────────────
function formatPatternName(key) {
  const names = {
    hasNumbers: 'numbers in title',
    hasQuestion: 'question format',
    hasHowTo: 'how-to',
    hasYear: 'year reference',
    hasComparison: 'comparison/vs',
    hasColon: 'colon/subtitle',
    other: 'plain',
  };
  return names[key] || key;
}
