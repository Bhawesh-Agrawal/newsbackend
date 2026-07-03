import sql from "../config/database.js";
import { memCache, TTL } from '../utils/memCache.js';
import { submitToIndexNow } from '../utils/indexnow.js';
import { scheduleAiProcessing } from './articles.controller.js';

// ── getReviewQueue ────────────────────────────────────────────────────────────
// Returns all articles with status = 'review', newest first.
// Super admin only — enforced at the route level via middleware.

export const getReviewQueue = async (req, res, next) => {
  try {
    const articles = await sql`
      SELECT
        a.id, a.title, a.slug, a.subtitle, a.excerpt,
        a.cover_image, a.reading_time, a.status,
        a.is_featured, a.is_breaking,
        a.view_count, a.like_count, a.comment_count,
        a.published_at, a.created_at, a.body,
        u.full_name  AS author_name,
        u.avatar_url AS author_avatar,
        u.bio        AS author_bio,
        c.name  AS category_name,
        c.slug  AS category_slug,
        c.color AS category_color,
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'slug', t.slug))
           FROM tags t
           JOIN article_tags at ON t.id = at.tag_id
           WHERE at.article_id = a.id),
          '[]'
        ) AS tags
      FROM articles a
      JOIN users      u ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.status = 'review'
      ORDER BY a.created_at DESC
    `

    return res.status(200).json({ success: true, data: articles })
  } catch (err) { next(err) }
}

// ── reviewAction ──────────────────────────────────────────────────────────────
// PATCH /articles/:id/review-action
// body: { action: 'approve' | 'request_changes' | 'reject' }

export const reviewAction = async (req, res, next) => {
  try {
    const { id }     = req.params
    const { action } = req.body

    if (!['approve', 'request_changes', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' })
    }

    const [existing] = await sql`SELECT * FROM articles WHERE id = ${id}`
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Article not found' })
    }
    if (existing.status !== 'review') {
      return res.status(400).json({ success: false, message: 'Article is not in review' })
    }

    const newStatus = action === 'approve'
      ? 'published'
      : action === 'request_changes'
        ? 'draft'
        : 'archived'

    const publishedAt = action === 'approve' ? new Date() : existing.published_at

    const [updated] = await sql`
      UPDATE articles
      SET status       = ${newStatus},
          published_at = ${publishedAt}
      WHERE id = ${id}
      RETURNING id, slug, title, status
    `

    // Bust all relevant caches
    memCache.invalidate(`article:${existing.slug}`)
    memCache.invalidate('articles:')
    memCache.invalidate('stats:')
    if (action === 'approve') {
      memCache.invalidate('trending:')
      scheduleAiProcessing(id, existing.body_text, [], existing.title, existing.excerpt, existing.cover_image)
      submitToIndexNow(updated.slug)
    }

    const messages = {
      approve:         'Article approved and published',
      request_changes: 'Article sent back to author for changes',
      reject:          'Article rejected and archived',
    }

    return res.status(200).json({
      success: true,
      message: messages[action],
      data:    updated,
    })
  } catch (err) { next(err) }
}