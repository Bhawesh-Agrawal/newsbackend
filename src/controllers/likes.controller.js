import sql from '../config/database.js';

export const toggleLike = async (req, res, next) => {
  try {
    const { id: article_id } = req.params;

    // req.body is guaranteed to exist now — frontend always sends { fingerprint }
    // For logged-in users, userId takes precedence and fingerprint is ignored.
    // For anonymous users, fingerprint is the sole identifier.
    const { fingerprint } = req.body || {};
    const userId = req.user?.id || null;

    console.log('toggleLike called:', { article_id, userId, fingerprint: fingerprint ? '[set]' : '[missing]' });

    // Must have either a user ID (authenticated) or a fingerprint (anonymous)
    if (!userId && !fingerprint) {
      return res.status(400).json({
        success: false,
        message: 'A fingerprint is required for anonymous likes',
      });
    }

    // ── Check if already liked ─────────────────────────────────
    let existing;

    if (userId) {
      const result = await sql`
        SELECT id FROM article_likes
        WHERE article_id = ${article_id} AND user_id = ${userId}
      `;
      existing = result[0];
    } else {
      const result = await sql`
        SELECT id FROM article_likes
        WHERE article_id = ${article_id} AND fingerprint = ${fingerprint}
      `;
      existing = result[0];
    }

    // ── Toggle ─────────────────────────────────────────────────
    if (existing) {
      // Already liked — unlike it
      await sql`DELETE FROM article_likes WHERE id = ${existing.id}`;

      const updated = await sql`
        UPDATE articles
        SET like_count = GREATEST(0, like_count - 1)
        WHERE id = ${article_id}
        RETURNING like_count
      `;

      return res.status(200).json({
        success: true,
        data: {
          liked:      false,
          like_count: updated[0]?.like_count ?? 0,
        },
      });

    } else {
      // Not liked — add it
      await sql`
        INSERT INTO article_likes (article_id, user_id, fingerprint, ip_address)
        VALUES (
          ${article_id},
          ${userId},
          ${fingerprint || null},
          ${req.ip}
        )
      `;

      const updated = await sql`
        UPDATE articles
        SET like_count = like_count + 1
        WHERE id = ${article_id}
        RETURNING like_count
      `;

      return res.status(200).json({
        success: true,
        data: {
          liked:      true,
          like_count: updated[0]?.like_count ?? 0,
        },
      });
    }

  } catch (err) {
    next(err);
  }
};

export const getLikeStatus = async (req, res, next) => {
  try {
    const { id: article_id } = req.params;
    const { fingerprint }    = req.query;
    const userId = req.user?.id || null;

    let liked = false;

    if (userId) {
      const result = await sql`
        SELECT id FROM article_likes
        WHERE article_id = ${article_id} AND user_id = ${userId}
      `;
      liked = result.length > 0;
    } else if (fingerprint) {
      const result = await sql`
        SELECT id FROM article_likes
        WHERE article_id = ${article_id} AND fingerprint = ${fingerprint}
      `;
      liked = result.length > 0;
    }

    // Also return the current like count so the frontend stays in sync
    const article = await sql`
      SELECT like_count FROM articles WHERE id = ${article_id}
    `;

    return res.status(200).json({
      success: true,
      data: {
        liked,
        like_count: article[0]?.like_count ?? 0,
      },
    });

  } catch (err) {
    next(err);
  }
};