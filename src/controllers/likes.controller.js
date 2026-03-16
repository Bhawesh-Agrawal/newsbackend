import sql from '../config/database.js';

export const toggleLike = async (req, res, next) => {
  try {
    const { id: article_id } = req.params;
    const { fingerprint }    = req.body;

    const userId = req.user?.id || null;
    console.log('toggleLike called:', { article_id, userId, fingerprint })

    // Must have either a user ID or a fingerprint
    if (!userId && !fingerprint) {
      return res.status(400).json({
        success: false,
        message: 'fingerprint required for anonymous likes',
      });
    }

    // Check if already liked
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

    if (existing) {
      // Already liked — remove it (unlike)
      await sql`DELETE FROM article_likes WHERE id = ${existing.id}`;

      await sql`
        UPDATE articles
        SET like_count = GREATEST(0, like_count - 1)
        WHERE id = ${article_id}
      `;

      return res.status(200).json({
        success: true,
        data: { liked: false },
      });

    } else {
      // Not liked yet — add it
      await sql`
        INSERT INTO article_likes (article_id, user_id, fingerprint, ip_address)
        VALUES (
          ${article_id},
          ${userId},
          ${fingerprint || null},
          ${req.ip}
        )
      `;

      await sql`
        UPDATE articles SET like_count = like_count + 1
        WHERE id = ${article_id}
      `;

      return res.status(200).json({
        success: true,
        data: { liked: true },
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

    return res.status(200).json({
      success: true,
      data: { liked },
    });

  } catch (err) {
    next(err);
  }
};