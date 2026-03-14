import sql from '../config/database.js';

export const trackView = async (req, res, next) => {
  try {
    const { id: article_id } = req.params;
    const { session_id }     = req.body;
    const userId = req.user?.id || null;

    // Check if this session already viewed this article
    if (session_id) {
      const existing = await sql`
        SELECT id FROM article_views
        WHERE article_id = ${article_id}
          AND session_id = ${session_id}
      `;

      if (existing.length > 0) {
        // Already counted this session — return silently
        return res.status(200).json({
          success: true,
          data: { counted: false },
        });
      }
    }

    // Log the view
    await sql`
      INSERT INTO article_views (article_id, user_id, session_id, ip_address, referrer)
      VALUES (
        ${article_id},
        ${userId},
        ${session_id || null},
        ${req.ip},
        ${req.headers.referer || null}
      )
    `;

    // Increment counter
    await sql`
      UPDATE articles SET view_count = view_count + 1
      WHERE id = ${article_id}
    `;

    return res.status(200).json({
      success: true,
      data: { counted: true },
    });

  } catch (err) {
    next(err);
  }
};