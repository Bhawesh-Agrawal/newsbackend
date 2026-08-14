import sql from '../config/database.js';

/**
 * Aggregation Job: Compute reading stats from raw engagement events
 * Runs hourly via the scheduler.
 *
 * Processes the last 24 hours of events and updates article_reading_stats.
 */
export async function aggregateReadingStats() {
  console.log('[Aggregation] Starting reading stats aggregation...');

  try {
    // Get articles with events in the last 24 hours
    const activeArticles = await sql`
      SELECT DISTINCT article_id
      FROM article_engagement_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;

    if (activeArticles.length === 0) {
      console.log('[Aggregation] No active articles to process');
      return;
    }

    console.log(`[Aggregation] Processing ${activeArticles.length} articles...`);

    for (const { article_id } of activeArticles) {
      await aggregateArticle(article_id);
    }

    console.log(`[Aggregation] Done. Processed ${activeArticles.length} articles.`);
  } catch (err) {
    console.error('[Aggregation] Error:', err.message);
  }
}

async function aggregateArticle(articleId) {
  // Gather all events for this article
  const events = await sql`
    SELECT event_type, event_data, session_id, created_at
    FROM article_engagement_events
    WHERE article_id = ${articleId}
    ORDER BY created_at ASC
  `;

  if (events.length === 0) return;

  // Group events by session
  const sessions = {};
  for (const event of events) {
    const sid = event.session_id;
    if (!sessions[sid]) sessions[sid] = [];
    sessions[sid].push(event);
  }

  const sessionCount = Object.keys(sessions).length;

  // Compute per-session metrics
  let totalTime = 0;
  let totalScrollDepth = 0;
  let completedReads = 0;
  let qualityReads = 0;
  let skimmers = 0;
  let tabOpeners = 0;
  let bounces = 0;
  let internalClicks = 0;
  const dropOffs = { 25: 0, 50: 0, 75: 0, 100: 0 };

  for (const [sid, sessionEvents] of Object.entries(sessions)) {
    const timeEvents = sessionEvents.filter(e => e.event_type === 'time_interval');
    const scrollEvents = sessionEvents.filter(e => e.event_type === 'scroll');
    const exitEvent = sessionEvents.find(e => e.event_type === 'exit');
    const clickEvents = sessionEvents.filter(e => e.event_type === 'internal_click');
    const readComplete = sessionEvents.find(e => e.event_type === 'read_complete');

    // Time on page (sum of time_interval durations)
    const sessionTime = timeEvents.reduce((sum, e) => {
      return sum + (e.event_data?.seconds || 0);
    }, 0);

    // Max scroll depth
    const maxScroll = scrollEvents.reduce((max, e) => {
      return Math.max(max, e.event_data?.scroll_pct || 0);
    }, 0);

    // Classify reader type
    const hasEnoughTime = sessionTime > 30; // More than 30 seconds
    const readTo75 = maxScroll >= 75;
    const readToEnd = maxScroll >= 95;
    const scrolledFast = readToEnd && sessionTime < 15; // Scrolled to end in <15s

    if (readToEnd && hasEnoughTime) {
      completedReads++;
      qualityReads++;
    } else if (scrolledFast) {
      skimmers++;
    } else if (hasEnoughTime && !readTo75) {
      tabOpeners++;
    } else if (sessionTime < 10 && maxScroll < 25) {
      bounces++;
    }

    // Track drop-off points
    if (maxScroll < 25) dropOffs[25]++;
    else if (maxScroll < 50) dropOffs[50]++;
    else if (maxScroll < 75) dropOffs[75]++;
    else dropOffs[100]++;

    if (clickEvents.length > 0) internalClicks++;

    totalTime += sessionTime;
    totalScrollDepth += maxScroll;
  }

  // Compute aggregate stats
  const stats = {
    avg_read_time_seconds: sessionCount > 0 ? totalTime / sessionCount : 0,
    avg_scroll_depth: sessionCount > 0 ? totalScrollDepth / sessionCount : 0,
    read_completion_rate: sessionCount > 0 ? completedReads / sessionCount : 0,
    quality_read_rate: sessionCount > 0 ? qualityReads / sessionCount : 0,
    skimmer_rate: sessionCount > 0 ? skimmers / sessionCount : 0,
    tab_opener_rate: sessionCount > 0 ? tabOpeners / sessionCount : 0,
    bounce_rate_adjusted: sessionCount > 0 ? bounces / sessionCount : 0,
    drop_off_25: dropOffs[25],
    drop_off_50: dropOffs[50],
    drop_off_75: dropOffs[75],
    drop_off_100: dropOffs[100],
    internal_click_rate: sessionCount > 0 ? internalClicks / sessionCount : 0,
    total_sessions: sessionCount,
  };

  // Upsert stats
  await sql`
    INSERT INTO article_reading_stats
      (article_id, avg_read_time_seconds, avg_scroll_depth,
       read_completion_rate, quality_read_rate, skimmer_rate,
       tab_opener_rate, bounce_rate_adjusted,
       drop_off_25, drop_off_50, drop_off_75, drop_off_100,
       internal_click_rate, total_sessions, period, updated_at)
    VALUES (
      ${articleId},
      ${stats.avg_read_time_seconds},
      ${stats.avg_scroll_depth},
      ${stats.read_completion_rate},
      ${stats.quality_read_rate},
      ${stats.skimmer_rate},
      ${stats.tab_opener_rate},
      ${stats.bounce_rate_adjusted},
      ${stats.drop_off_25},
      ${stats.drop_off_50},
      ${stats.drop_off_75},
      ${stats.drop_off_100},
      ${stats.internal_click_rate},
      ${stats.total_sessions},
      'all',
      NOW()
    )
    ON CONFLICT (article_id, period) DO UPDATE SET
      avg_read_time_seconds = EXCLUDED.avg_read_time_seconds,
      avg_scroll_depth = EXCLUDED.avg_scroll_depth,
      read_completion_rate = EXCLUDED.read_completion_rate,
      quality_read_rate = EXCLUDED.quality_read_rate,
      skimmer_rate = EXCLUDED.skimmer_rate,
      tab_opener_rate = EXCLUDED.tab_opener_rate,
      bounce_rate_adjusted = EXCLUDED.bounce_rate_adjusted,
      drop_off_25 = EXCLUDED.drop_off_25,
      drop_off_50 = EXCLUDED.drop_off_50,
      drop_off_75 = EXCLUDED.drop_off_75,
      drop_off_100 = EXCLUDED.drop_off_100,
      internal_click_rate = EXCLUDED.internal_click_rate,
      total_sessions = EXCLUDED.total_sessions,
      updated_at = NOW()
  `;
}

/**
 * Update session_journeys with time_on_page and scroll_depth
 * Called periodically to fill in exit data
 */
export async function updateSessionJourneys() {
  try {
    // Update journeys that are missing time_on_page
    const incomplete = await sql`
      SELECT sj.id, sj.session_id, sj.article_id
      FROM session_journeys sj
      WHERE sj.time_on_page = 0
        AND sj.created_at > NOW() - INTERVAL '7 days'
      LIMIT 500
    `;

    for (const journey of incomplete) {
      // Sum time_interval events for this session+article
      const timeResult = await sql`
        SELECT COALESCE(SUM((event_data->>'seconds')::INT), 0) AS total_time
        FROM article_engagement_events
        WHERE session_id = ${journey.session_id}
          AND article_id = ${journey.article_id}
          AND event_type = 'time_interval'
      `;

      const maxScrollResult = await sql`
        SELECT COALESCE(MAX((event_data->>'scroll_pct')::INT), 0) AS max_scroll
        FROM article_engagement_events
        WHERE session_id = ${journey.session_id}
          AND article_id = ${journey.article_id}
          AND event_type = 'scroll'
      `;

      await sql`
        UPDATE session_journeys
        SET time_on_page = ${timeResult[0]?.total_time || 0},
            scroll_depth = ${maxScrollResult[0]?.max_scroll || 0},
            is_bounce = (${timeResult[0]?.total_time || 0} < 10 AND ${maxScrollResult[0]?.max_scroll || 0} < 25)
        WHERE id = ${journey.id}
      `;
    }
  } catch (err) {
    console.error('[Aggregation] Journey update error:', err.message);
  }
}
