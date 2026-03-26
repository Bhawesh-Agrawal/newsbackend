import sql from '../config/database.js';
import { automod } from '../utils/Automod.js';

export const createComment = async (req, res, next) => {
  try {
    const { article_id, body, parent_id } = req.body;

    // ── 1. Validate article exists and is published ──────────────
    const articles = await sql`
      SELECT id FROM articles WHERE id = ${article_id} AND status = 'published'
    `;

    if (articles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
      });
    }

    // ── 2. Validate parent comment if this is a reply ────────────
    if (parent_id) {
      const parent = await sql`
        SELECT id FROM comments
        WHERE id = ${parent_id} AND article_id = ${article_id}
      `;

      if (parent.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Parent comment not found for this article',
        });
      }
    }

    // ── 3. Run auto-moderation ───────────────────────────────────
    // Returns { status: 'approved' | 'pending' | 'spam', reason?: string }
    const modResult = automod(body);

    if (modResult.status === 'spam') {
      // Hard block — don't even insert spam into the DB
      return res.status(422).json({
        success: false,
        message: 'Your comment could not be posted. Please review its content.',
      });
    }

    // ── 4. Insert with auto-determined status ────────────────────
    const result = await sql`
      INSERT INTO comments (article_id, user_id, parent_id, body, ip_address, status)
      VALUES (
        ${article_id},
        ${req.user.id},
        ${parent_id || null},
        ${body},
        ${req.ip},
        ${modResult.status}
      )
      RETURNING *
    `;

    // ── 5. If auto-approved, increment article comment count ─────
    if (modResult.status === 'approved') {
      await sql`
        UPDATE articles
        SET comment_count = comment_count + 1
        WHERE id = ${article_id}
      `;
    }

    const message =
      modResult.status === 'approved'
        ? 'Comment posted'
        : 'Comment submitted and will appear after review';

    return res.status(201).json({
      success: true,
      message,
      data: result[0],
    });

  } catch (err) {
    next(err);
  }
};

export const getComments = async (req, res, next) => {
  try {
    const { article_id } = req.params;

    // ── IMPORTANT: alias must match the Comment type on the frontend ──
    // Frontend expects: author_name, author_avatar (not user_name, avatar_url)
    const comments = await sql`
      SELECT
        c.id,
        c.body,
        c.like_count,
        c.is_pinned,
        c.created_at,
        u.id                                   AS user_id,
        COALESCE(u.full_name, 'Anonymous')     AS author_name,
        u.avatar_url                           AS author_avatar
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.article_id = ${article_id}
        AND c.status     = 'approved'
        AND c.parent_id  IS NULL
      ORDER BY c.is_pinned DESC, c.created_at ASC
    `;

    // For each top-level comment, fetch its approved replies
    for (const comment of comments) {
      const replies = await sql`
        SELECT
          c.id,
          c.body,
          c.like_count,
          c.created_at,
          COALESCE(u.full_name, 'Anonymous')   AS author_name,
          u.avatar_url                         AS author_avatar
        FROM comments c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.parent_id = ${comment.id}
          AND c.status    = 'approved'
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
        COALESCE(u.full_name, 'Anonymous') AS user_name,
        u.email                            AS user_email,
        a.title                            AS article_title,
        a.slug                             AS article_slug
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

    const comment      = existing[0];
    const isOwner      = comment.user_id === req.user.id;
    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isEditorPlus) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    await sql`DELETE FROM comments WHERE id = ${id}`;

    // Decrement count only if it was approved (it was visible to the public)
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