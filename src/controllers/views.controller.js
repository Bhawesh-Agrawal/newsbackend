import sql from '../config/database.js';

export const trackView = async (req, res, next) => {
  try {
    const { id } = req.params;

    // req.body may be undefined if no body was sent — default to empty object
    const { session_id } = req.body || {};

    const userId    = req.user?.id    || null;
    const ipAddress = req.ip          || null;
    const userAgent = req.headers['user-agent'] || null;

    // Deduplicate: same user/IP + article within 24 hours counts as 1 view
    const existing = await sql`
      SELECT id FROM article_views
      WHERE article_id = ${id}
        AND (
          (user_id    IS NOT NULL AND user_id    = ${userId})
          OR
          (ip_address IS NOT NULL AND ip_address = ${ipAddress}::inet)
        )
        AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1
    `;

    if (existing.length > 0) {
      return res.status(200).json({ success: true, message: 'Already counted' });
    }

    await sql`
      INSERT INTO article_views
        (article_id, user_id, session_id, ip_address, user_agent)
      VALUES (
        ${id},
        ${userId},
        ${session_id || null},
        ${ipAddress ? sql`${ipAddress}::inet` : null},
        ${userAgent}
      )
    `;

    // Increment the cached view count on the article
    await sql`
      UPDATE articles
      SET view_count = view_count + 1
      WHERE id = ${id}
    `;

    return res.status(200).json({ success: true });

  } catch (err) {
    // Never crash the page over a view tracking failure
    console.error('[Views] Track error:', err.message);
    return res.status(200).json({ success: true });
  }
};