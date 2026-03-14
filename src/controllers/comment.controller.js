import sql from '../config/database.js';

export const createComment = async (req, res, next) => {
    try {

        const { article_id, body, parent_id} = req.body;

        const articles = await sql`
        SELECT id FROM articles WHERE id = ${article_id} AND status = 'published'
        `

        if (articles.length === 0) {
            return res.status(404).json({ 
                success : false,
                message: 'Article not found' });
        }

        if (parent_id) {
            const parent = await sql`
            SELECT id FROM comments WHERE id = ${parent_id} AND article_id = ${article_id}`

            if (parent.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Parent comment not found for this article'
                });
            }
        };

        const result = await sql`
            INSERT INTO comments (article_id, user_id, parent_id, body, ip_address)
            VALUES (
                ${article_id},
                ${req.user.id},
                ${parent_id || null},
                ${body},
                ${req.ip}
            )
            RETURNING *
        `;

        return res.status(201).json({
            success: true,
            message: 'Comment submitted for review',
            data: result[0],
        });

    }catch(err){
        next(err);
    }
}

export const getComments = async (req, res, next) => {
  try {
    const { article_id } = req.params;

    // Get top-level approved comments only
    const comments = await sql`
      SELECT
        c.id, c.body, c.like_count, c.is_pinned, c.created_at,
        u.id        AS user_id,
        u.full_name AS user_name,
        u.avatar_url
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.article_id = ${article_id}
        AND c.status    = 'approved'
        AND c.parent_id IS NULL
      ORDER BY c.is_pinned DESC, c.created_at ASC
    `;

    // For each comment, get its approved replies
    for (const comment of comments) {
      const replies = await sql`
        SELECT
          c.id, c.body, c.like_count, c.created_at,
          u.full_name AS user_name,
          u.avatar_url
        FROM comments c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.parent_id = ${comment.id}
          AND c.status   = 'approved'
        ORDER BY c.created_at ASC
      `;

      comment.replies = replies;
    }

    return res.status(200).json({
      success: true,
      data: comments,
    });

  } catch (err) {
    next(err);
  }
};

export const getCommentQueue = async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;

    const comments = await sql`
      SELECT
        c.*,
        u.full_name  AS user_name,
        u.email      AS user_email,
        a.title      AS article_title,
        a.slug       AS article_slug
      FROM comments c
      LEFT JOIN users    u ON c.user_id    = u.id
      LEFT JOIN articles a ON c.article_id = a.id
      WHERE c.status = ${status}
      ORDER BY c.created_at ASC
    `;

    return res.status(200).json({
      success: true,
      data: comments,
    });

  } catch (err) {
    next(err);
  }
};

export const moderateComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    const validActions = ['approve', 'reject', 'spam'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use approve, reject, or spam',
      });
    }

    const statusMap = {
      approve: 'approved',
      reject:  'rejected',
      spam:    'spam',
    };

    const result = await sql`
      UPDATE comments SET
        status       = ${statusMap[action]},
        moderated_by = ${req.user.id},
        moderated_at = NOW()
      WHERE id = ${id}
      RETURNING article_id, status
    `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found',
      });
    }

    // Only increment article comment count when approving
    if (action === 'approve') {
      await sql`
        UPDATE articles
        SET comment_count = comment_count + 1
        WHERE id = ${result[0].article_id}
      `;
    }

    return res.status(200).json({
      success: true,
      message: `Comment ${action}d`,
    });

  } catch (err) {
    next(err);
  }
};

export const deleteComment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await sql`
      SELECT user_id, article_id, status FROM comments WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    const comment = existing[0];
    const isOwner    = comment.user_id === req.user.id;
    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isEditorPlus) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    await sql`DELETE FROM comments WHERE id = ${id}`;

    // Decrement count if it was approved
    if (comment.status === 'approved') {
      await sql`
        UPDATE articles
        SET comment_count = GREATEST(0, comment_count - 1)
        WHERE id = ${comment.article_id}
      `;
    }

    return res.status(200).json({ success: true, message: 'Comment deleted' });

  } catch (err) {
    next(err);
  }
};