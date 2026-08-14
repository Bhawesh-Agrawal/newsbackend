import sql from '../config/database.js';

// ── Batch engagement event ingestion ─────────────────────────────────────────
// Receives batched events from the frontend tracker and writes them to the DB.
// Events are fire-and-forget: the client sends them via sendBeacon on exit.
export const trackEngagement = async (req, res, next) => {
  try {
    const { article_id, session_id, events } = req.body;

    if (!article_id || !session_id || !Array.isArray(events) || events.length === 0) {
      return res.status(200).json({ success: true, message: 'Skipped: invalid payload' });
    }

    const userId = req.user?.id || null;
    const ipAddress = req.ip || null;

    // Validate and sanitize events
    const validTypes = new Set(['scroll', 'time_interval', 'exit', 'internal_click', 'read_complete']);
    const rows = events
      .filter(e => e && typeof e.type === 'string' && validTypes.has(e.type))
      .slice(0, 50) // max 50 events per batch
      .map(e => ({
        article_id,
        session_id: session_id.slice(0, 255),
        user_id: userId,
        event_type: e.type,
        event_data: JSON.stringify(e.data || {}),
        created_at: new Date(e.ts || Date.now()).toISOString(),
      }));

    if (rows.length === 0) {
      return res.status(200).json({ success: true, message: 'No valid events' });
    }

    // Batch insert
    await sql`
      INSERT INTO article_engagement_events
        (article_id, session_id, user_id, event_type, event_data, created_at)
      SELECT * FROM UNNEST(
        ${rows.map(r => r.article_id)}::uuid[],
        ${rows.map(r => r.session_id)}::varchar[],
        ${rows.map(r => r.user_id)}::uuid[],
        ${rows.map(r => r.event_type)}::varchar[],
        ${rows.map(r => r.event_data)}::jsonb[],
        ${rows.map(r => r.created_at)}::timestamptz[]
      )
    `;

    // Track session journey (first page in session)
    if (userId || ipAddress) {
      const existing = await sql`
        SELECT id FROM session_journeys
        WHERE session_id = ${session_id}
        LIMIT 1
      `;

      if (existing.length === 0) {
        await sql`
          INSERT INTO session_journeys
            (session_id, user_id, article_id, page_number, created_at)
          VALUES (${session_id}, ${userId}, ${article_id}, 1, NOW())
        `;
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    // Non-critical — don't break anything
    console.error('[Engagement] Track error:', err.message);
    return res.status(200).json({ success: true });
  }
};

// ── Get aggregated reading stats for an article ─────────────────────────────
export const getArticleReadingStats = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { period = 'all' } = req.query;

    const stats = await sql`
      SELECT * FROM article_reading_stats
      WHERE article_id = ${id} AND period = ${period}
    `;

    if (stats.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No reading data yet. Stats are computed hourly.',
      });
    }

    return res.status(200).json({ success: true, data: stats[0] });
  } catch (err) {
    next(err);
  }
};

// ── Get site-wide engagement aggregates ──────────────────────────────────────
export const getSiteEngagement = async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

    const [totals, topByReadRate] = await Promise.all([
      sql`
        SELECT
          COALESCE(AVG(avg_read_time_seconds), 0)::FLOAT AS avg_read_time,
          COALESCE(AVG(avg_scroll_depth), 0)::FLOAT AS avg_scroll_depth,
          COALESCE(AVG(read_completion_rate), 0)::FLOAT AS avg_completion_rate,
          COALESCE(AVG(quality_read_rate), 0)::FLOAT AS avg_quality_rate,
          COALESCE(AVG(bounce_rate_adjusted), 0)::FLOAT AS avg_bounce_rate,
          SUM(total_sessions)::INT AS total_sessions
        FROM article_reading_stats
        WHERE period = 'all'
      `,
      sql`
        SELECT
          a.id, a.title, a.slug,
          ars.quality_read_rate,
          ars.avg_read_time_seconds,
          ars.avg_scroll_depth,
          ars.total_sessions
        FROM article_reading_stats ars
        JOIN articles a ON ars.article_id = a.id
        WHERE ars.period = 'all'
          AND ars.total_sessions >= 5
        ORDER BY ars.quality_read_rate DESC
        LIMIT 10
      `,
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totals: totals[0] || {},
        topByReadRate,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Get session journey for a specific session ──────────────────────────────
export const getSessionJourney = async (req, res, next) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ success: false, message: 'session_id required' });
    }

    const journey = await sql`
      SELECT
        sj.*,
        a.title, a.slug, a.category_id,
        c.name AS category_name
      FROM session_journeys sj
      JOIN articles a ON sj.article_id = a.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE sj.session_id = ${session_id}
      ORDER BY sj.page_number ASC
    `;

    return res.status(200).json({ success: true, data: journey });
  } catch (err) {
    next(err);
  }
};

// ── Post-read journey: what do readers do after a specific article? ──────────
export const getPostReadJourney = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { limit = 10 } = req.query;

    // Find sessions that included this article, then see what came next
    const journeys = await sql`
      WITH target_sessions AS (
        SELECT DISTINCT session_id
        FROM session_journeys
        WHERE article_id = ${id}
      ),
      after_article AS (
        SELECT
          sj2.article_id,
          a.title, a.slug,
          COUNT(DISTINCT sj2.session_id)::INT AS session_count,
          AVG(sj2.time_on_page)::INT AS avg_time,
          c.name AS category_name
        FROM session_journeys sj2
        JOIN target_sessions ts ON sj2.session_id = ts.session_id
        JOIN articles a ON sj2.article_id = a.id
        LEFT JOIN categories c ON a.category_id = c.id
        WHERE sj2.article_id != ${id}
          AND sj2.created_at > (
            SELECT MIN(sj1.created_at)
            FROM session_journeys sj1
            WHERE sj1.session_id = sj2.session_id
              AND sj1.article_id = ${id}
          )
        GROUP BY sj2.article_id, a.title, a.slug, c.name
        ORDER BY session_count DESC
        LIMIT ${parseInt(limit)}
      )
      SELECT * FROM after_article
    `;

    return res.status(200).json({ success: true, data: journeys });
  } catch (err) {
    next(err);
  }
};
