// src/controllers/saved.controller.js
// Handles saving / unsaving articles and listing a user's saved articles.
// All routes require authentication (authenticate middleware).

import sql from '../config/database.js'

// ── GET /users/me/saved ───────────────────────────────────────
// Returns paginated list of articles the current user has saved.
// Ordered newest-save first.
export const getSaved = async (req, res, next) => {
  try {
    const userId = req.user.id
    const page   = Math.max(1, parseInt(req.query.page  ?? '1',  10))
    const limit  = Math.min(50, parseInt(req.query.limit ?? '20', 10))
    const offset = (page - 1) * limit

    const rows = await sql`
      SELECT
        a.id,
        a.slug,
        a.title,
        a.excerpt,
        a.cover_image,
        a.reading_time,
        a.view_count,
        a.like_count,
        a.comment_count,
        a.published_at,
        a.is_breaking,
        a.is_featured,
        c.name  AS category_name,
        c.slug  AS category_slug,
        c.color AS category_color,
        u.full_name  AS author_name,
        u.avatar_url AS author_avatar,
        sa.created_at AS saved_at
      FROM saved_articles sa
      JOIN articles a ON a.id = sa.article_id
      LEFT JOIN categories c ON c.id = a.category_id
      LEFT JOIN users      u ON u.id = a.author_id
      WHERE sa.user_id = ${userId}
        AND a.status   = 'published'
      ORDER BY sa.created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `

    const [{ count }] = await sql`
      SELECT COUNT(*) AS count
      FROM saved_articles sa
      JOIN articles a ON a.id = sa.article_id
      WHERE sa.user_id = ${userId}
        AND a.status   = 'published'
    `

    const total       = parseInt(count, 10)
    const total_pages = Math.ceil(total / limit)

    return res.status(200).json({
      success: true,
      data:        rows,
      page,
      limit,
      total,
      total_pages,
    })

  } catch (err) {
    next(err)
  }
}

// ── POST /users/me/saved ──────────────────────────────────────
// Save an article. Body: { article_id }
// Idempotent — saving the same article twice returns 200, not 409.
export const saveArticle = async (req, res, next) => {
  try {
    const userId    = req.user.id
    const { article_id } = req.body

    if (!article_id) {
      return res.status(400).json({ success: false, message: 'article_id is required' })
    }

    // Verify article exists and is published
    const articles = await sql`
      SELECT id FROM articles WHERE id = ${article_id} AND status = 'published'
    `
    if (articles.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' })
    }

    // INSERT ... ON CONFLICT DO NOTHING makes this idempotent
    await sql`
      INSERT INTO saved_articles (user_id, article_id)
      VALUES (${userId}, ${article_id})
      ON CONFLICT (user_id, article_id) DO NOTHING
    `

    return res.status(200).json({ success: true, message: 'Article saved' })

  } catch (err) {
    next(err)
  }
}

// ── DELETE /users/me/saved/:articleId ────────────────────────
// Unsave an article. Idempotent — silently succeeds if not saved.
export const unsaveArticle = async (req, res, next) => {
  try {
    const userId    = req.user.id
    const { articleId } = req.params

    await sql`
      DELETE FROM saved_articles
      WHERE user_id = ${userId} AND article_id = ${articleId}
    `

    return res.status(200).json({ success: true, message: 'Article removed from saved' })

  } catch (err) {
    next(err)
  }
}

// ── GET /users/me/saved/:articleId/status ────────────────────
// Check if a specific article is saved by the current user.
// Used by ArticlePage to set the initial bookmark state.
export const getSaveStatus = async (req, res, next) => {
  try {
    const userId    = req.user.id
    const { articleId } = req.params

    const rows = await sql`
      SELECT id FROM saved_articles
      WHERE user_id = ${userId} AND article_id = ${articleId}
    `

    return res.status(200).json({
      success: true,
      data: { saved: rows.length > 0 },
    })

  } catch (err) {
    next(err)
  }
}