// src/controllers/saved.controller.js
// Handles saving / unsaving articles and listing a user's saved articles.
// All routes require authentication (authenticate middleware).

import sql from '../config/database.js'

// ── GET /users/me/saved ───────────────────────────────────────
// Returns paginated list of articles and video articles the current user has saved.
// Ordered newest-save first.
export const getSaved = async (req, res, next) => {
  try {
    const userId = req.user.id
    const page   = Math.max(1, parseInt(req.query.page  ?? '1',  10))
    const limit  = Math.min(50, parseInt(req.query.limit ?? '20', 10))
    const offset = (page - 1) * limit

    // Fetch saved articles
    const savedArticles = await sql`
      SELECT
        'article' AS content_type,
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
        AND sa.article_id IS NOT NULL
        AND a.status   = 'published'
      ORDER BY sa.created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `

    // Fetch saved video articles
    const savedVideos = await sql`
      SELECT
        'video_article' AS content_type,
        va.id,
        va.slug,
        va.title,
        va.excerpt,
        va.cover_image,
        va.reading_time,
        va.video_type,
        va.video_provider,
        va.video_duration,
        va.view_count,
        va.like_count,
        va.comment_count,
        va.published_at,
        va.is_breaking,
        va.is_featured,
        c.name  AS category_name,
        c.slug  AS category_slug,
        c.color AS category_color,
        u.full_name  AS author_name,
        u.avatar_url AS author_avatar,
        sa.created_at AS saved_at
      FROM saved_articles sa
      JOIN video_articles va ON va.id = sa.video_article_id
      LEFT JOIN categories c ON c.id = va.category_id
      LEFT JOIN users      u ON u.id = va.author_id
      WHERE sa.user_id = ${userId}
        AND sa.video_article_id IS NOT NULL
        AND va.status   = 'published'
      ORDER BY sa.created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `

    // Merge and sort by saved_at
    const allSaved = [...savedArticles, ...savedVideos]
      .sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at))
      .slice(0, limit)

    const [{ count }] = await sql`
      SELECT COUNT(*) AS count
      FROM saved_articles sa
      WHERE sa.user_id = ${userId}
        AND (
          (sa.article_id IS NOT NULL AND EXISTS (SELECT 1 FROM articles a WHERE a.id = sa.article_id AND a.status = 'published'))
          OR
          (sa.video_article_id IS NOT NULL AND EXISTS (SELECT 1 FROM video_articles va WHERE va.id = sa.video_article_id AND va.status = 'published'))
        )
    `

    const total       = parseInt(count, 10)
    const total_pages = Math.ceil(total / limit)

    return res.status(200).json({
      success: true,
      data:        allSaved,
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
// Save an article or video article. Body: { article_id } or { video_article_id }
// Idempotent — saving the same content twice returns 200, not 409.
export const saveArticle = async (req, res, next) => {
  try {
    const userId    = req.user.id
    const { article_id, video_article_id } = req.body

    if (!article_id && !video_article_id) {
      return res.status(400).json({ success: false, message: 'article_id or video_article_id is required' })
    }

    if (article_id && video_article_id) {
      return res.status(400).json({ success: false, message: 'Provide only one of article_id or video_article_id' })
    }

    // Verify content exists and is published
    if (article_id) {
      const articles = await sql`
        SELECT id FROM articles WHERE id = ${article_id} AND status = 'published'
      `
      if (articles.length === 0) {
        return res.status(404).json({ success: false, message: 'Article not found' })
      }

      await sql`
        INSERT INTO saved_articles (user_id, article_id)
        VALUES (${userId}, ${article_id})
        ON CONFLICT (user_id, article_id) DO NOTHING
      `
    } else {
      const videos = await sql`
        SELECT id FROM video_articles WHERE id = ${video_article_id} AND status = 'published'
      `
      if (videos.length === 0) {
        return res.status(404).json({ success: false, message: 'Video article not found' })
      }

      await sql`
        INSERT INTO saved_articles (user_id, video_article_id)
        VALUES (${userId}, ${video_article_id})
        ON CONFLICT (user_id, video_article_id) DO NOTHING
      `
    }

    return res.status(200).json({ success: true, message: 'Content saved' })

  } catch (err) {
    next(err)
  }
}

// ── DELETE /users/me/saved/:articleId ────────────────────────
// Unsave an article or video article. Idempotent — silently succeeds if not saved.
export const unsaveArticle = async (req, res, next) => {
  try {
    const userId    = req.user.id
    const { articleId } = req.params

    // Try deleting from both article_id and video_article_id
    await sql`
      DELETE FROM saved_articles
      WHERE user_id = ${userId} AND article_id = ${articleId}
    `
    await sql`
      DELETE FROM saved_articles
      WHERE user_id = ${userId} AND video_article_id = ${articleId}
    `

    return res.status(200).json({ success: true, message: 'Content removed from saved' })

  } catch (err) {
    next(err)
  }
}

// ── GET /users/me/saved/:articleId/status ────────────────────
// Check if a specific article or video article is saved by the current user.
// Used by ArticlePage/VideoPage to set the initial bookmark state.
export const getSaveStatus = async (req, res, next) => {
  try {
    const userId    = req.user.id
    const { articleId } = req.params

    const rows = await sql`
      SELECT id FROM saved_articles
      WHERE user_id = ${userId} AND article_id = ${articleId}
    `
    const videoRows = await sql`
      SELECT id FROM saved_articles
      WHERE user_id = ${userId} AND video_article_id = ${articleId}
    `

    return res.status(200).json({
      success: true,
      data: { saved: rows.length > 0 || videoRows.length > 0 },
    })

  } catch (err) {
    next(err)
  }
}