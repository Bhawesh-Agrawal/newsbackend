import sql from '../config/database.js';

export const trackView = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { session_id, referrer } = req.body || {};

    const userId    = req.user?.id || null;
    const ipAddress = req.ip       || null;

    // ── Deduplication — one view per user/IP per article per 24h ──
    //
    // CRITICAL BUG FIX: SQL `col = NULL` is always false in standard SQL.
    // Must use `IS NULL` for null comparisons, not `= ${null}`.
    // The previous version used `user_id = ${null}` in the WHERE clause
    // which never matched any row, so anonymous views were NEVER deduped
    // and the counter incremented on every single request — causing the
    // +20 view jumps reported. This version separates the query by path:
    //   - Logged-in  → dedupe on user_id (exact match)
    //   - Anonymous  → dedupe on ip_address WHERE user_id IS NULL

    let existing;

    if (userId) {
      existing = await sql`
        SELECT id FROM article_views
        WHERE article_id = ${id}
          AND user_id    = ${userId}
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `;
    } else if (ipAddress) {
      existing = await sql`
        SELECT id FROM article_views
        WHERE article_id = ${id}
          AND user_id    IS NULL
          AND ip_address = ${ipAddress}::inet
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `;
    } else {
      // No identifier available — skip rather than inflate the count
      return res.status(200).json({ success: true, message: 'Skipped' });
    }

    if (existing.length > 0) {
      return res.status(200).json({ success: true, message: 'Already counted' });
    }

    // ── Record the view ───────────────────────────────────────────
    // Schema columns: article_id, user_id, session_id, ip_address, referrer
    // There is NO user_agent column — never add it to this INSERT.
    await sql`
      INSERT INTO article_views
        (article_id, user_id, session_id, ip_address, referrer)
      VALUES (
        ${id},
        ${userId},
        ${session_id || null},
        ${ipAddress ? sql`${ipAddress}::inet` : null},
        ${referrer   || null}
      )
    `;

    await sql`
      UPDATE articles
      SET view_count = view_count + 1
      WHERE id = ${id}
    `;

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[Views] Track error:', err.message);
    return res.status(200).json({ success: true });
  }
};