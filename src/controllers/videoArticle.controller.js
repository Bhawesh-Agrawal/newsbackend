import sql from "../config/database.js";
import {
  generateSlug, calculateReadingTime,
  stripHtml, generateExcerpt, parsePagination
} from "../utils/helpers.js";
import { generateSummary, generateTags } from '../services/ai.services.js';
import { memCache, TTL } from '../utils/memCache.js';
import { submitToIndexNow } from '../utils/indexnow.js';
import { deleteImage } from '../services/cloudinary.services.js';

// ── Shared video article SELECT columns ─────────────────────────────────────────
const VIDEO_LIST_COLS = sql`
  va.id, va.author_id, va.title, va.slug, va.subtitle, va.excerpt,
  va.cover_image, va.reading_time, va.status,
  va.video_type, va.video_url, va.video_provider, va.video_duration,
  va.is_featured, va.is_breaking,
  va.view_count, va.like_count, va.comment_count,
  va.published_at, va.created_at,
  va.ai_summary,
  va.linked_article_id,
  u.full_name  AS author_name,
  u.avatar_url AS author_avatar,
  c.name  AS category_name,
  c.slug  AS category_slug,
  c.color AS category_color
`;

// ── Helpers ────────────────────────────────────────────────────────────────────

export function scheduleVideoAiProcessing(videoId, bodyText, tagIds, titleText, excerpt, coverImage, slug, oldBodyText = null) {
  (async () => {
    try {
      let summary = null
      try {
        summary = await generateSummary(bodyText)
        if (summary) {
          await sql`UPDATE video_articles SET ai_summary = ${summary} WHERE id = ${videoId}`
        }
      } catch (err) {
        console.error('[AI] Video summary generation failed:', err.message)
      }

      if (!tagIds || tagIds.length === 0) {
        try {
          const suggestedTags = await generateTags(titleText, bodyText)
          for (const tagName of suggestedTags) {
            const slug = generateSlug(tagName)
            const tag  = await sql`
              INSERT INTO tags (name, slug) VALUES (${tagName}, ${slug})
              ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
              RETURNING id
            `
            await sql`
              INSERT INTO video_article_tags (video_article_id, tag_id)
              VALUES (${videoId}, ${tag[0].id})
              ON CONFLICT DO NOTHING
            `
          }
        } catch (err) {
          console.error('[AI] Video tag generation failed:', err.message)
        }
      }
    } catch (err) {
      console.error('[AI] Video post-publish processing failed:', err.message)
    }
  })()
}

// ── createVideoArticle ─────────────────────────────────────────────────────────

export const createVideoArticle = async (req, res, next) => {
  try {
    const {
      title, subtitle, body, excerpt, category_id,
      tag_ids = [], cover_image,
      video_type, video_url, video_public_id, video_provider, video_duration,
      status = 'draft',
      is_featured = false, is_breaking = false,
      scheduled_at, meta_title, meta_description,
      sort_order = 0,
      linked_article_id,
    } = req.body

    const isAuthor  = req.user.role === 'author'
    const finalStatus = (isAuthor && status === 'published') ? 'review' : status

    const baseSlug = generateSlug(title)
    const existing = await sql`SELECT id FROM video_articles WHERE slug = ${baseSlug}`
    const slug     = existing.length > 0 ? `${baseSlug}-${Date.now()}` : baseSlug

    const bodyText     = stripHtml(body)
    const finalExcerpt = excerpt || generateExcerpt(bodyText)
    const reading_time = calculateReadingTime(bodyText)
    const publishedAt  = finalStatus === 'published' ? new Date() : null
    const featuredAt   = is_featured ? new Date() : null
    const breakingAt   = is_breaking ? new Date() : null

    const [videoArticle] = await sql`
      INSERT INTO video_articles (
        title, slug, subtitle, body, body_text, excerpt,
        cover_image,
        video_type, video_url, video_public_id, video_provider, video_duration,
        category_id, author_id,
        status, is_featured, is_breaking,
        reading_time, published_at, scheduled_at,
        meta_title, meta_description,
        featured_at, breaking_at, sort_order,
        linked_article_id
      ) VALUES (
        ${title}, ${slug}, ${subtitle || null}, ${body}, ${bodyText}, ${finalExcerpt},
        ${cover_image || null},
        ${video_type}, ${video_url}, ${video_public_id || null}, ${video_provider || null}, ${video_duration || null},
        ${category_id}, ${req.user.id},
        ${finalStatus}, ${is_featured}, ${is_breaking},
        ${reading_time}, ${publishedAt}, ${scheduled_at || null},
        ${meta_title || title}, ${meta_description || finalExcerpt},
        ${featuredAt}, ${breakingAt}, ${sort_order},
        ${linked_article_id || null}
      ) RETURNING id, slug, title, status
    `

    if (tag_ids.length > 0) {
      for (const tagId of tag_ids) {
        await sql`
          INSERT INTO video_article_tags (video_article_id, tag_id)
          VALUES (${videoArticle.id}, ${tagId}) ON CONFLICT DO NOTHING
        `
      }
    }

    if (finalStatus === 'published') {
      memCache.invalidate('video:')
      memCache.invalidate('stats:')
      memCache.invalidate('videoTrending:')
      memCache.invalidate('home:')
      scheduleVideoAiProcessing(videoArticle.id, bodyText, tag_ids, title, finalExcerpt, cover_image, videoArticle.slug)
      submitToIndexNow(videoArticle.slug, 'video')
    }

    const message = finalStatus === 'review'
      ? 'Video article submitted for review'
      : 'Video article created'

    return res.status(201).json({ success: true, message, data: videoArticle })

  } catch (err) { next(err) }
}

// ── getVideoArticleById ────────────────────────────────────────────────────────

export const getVideoArticleById = async (req, res, next) => {
  try {
    const { id } = req.params

    const result = await sql`
      SELECT
        va.*,
        u.full_name  AS author_name,
        u.avatar_url AS author_avatar,
        u.bio        AS author_bio,
        c.name  AS category_name,
        c.slug  AS category_slug,
        c.color AS category_color,
        la.id    AS linked_article_id,
        la.title AS linked_article_title,
        la.slug  AS linked_article_slug,
        la.cover_image AS linked_article_cover,
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'slug', t.slug))
           FROM tags t
           JOIN video_article_tags vat ON t.id = vat.tag_id
           WHERE vat.video_article_id = va.id),
          '[]'
        ) AS tags,
        COALESCE(
          (SELECT json_agg(t.id)
           FROM tags t
           JOIN video_article_tags vat ON t.id = vat.tag_id
           WHERE vat.video_article_id = va.id),
          '[]'
        ) AS tag_ids
      FROM video_articles va
      JOIN users      u ON va.author_id   = u.id
      JOIN categories c ON va.category_id = c.id
      LEFT JOIN articles la ON va.linked_article_id = la.id
      WHERE va.id = ${id}
    `

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: 'Video article not found' })
    }

    const videoArticle = result[0]

    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role)
    if (!isEditorPlus && videoArticle.author_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    return res.status(200).json({ success: true, data: videoArticle })

  } catch (err) { next(err) }
}

// ── getVideoArticles ───────────────────────────────────────────────────────────

export const getVideoArticles = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query)

    const category  = req.query.category?.trim() || null
    const search    = req.query.search?.trim()   || null
    const featured  = req.query.featured === 'true'  ? true
                   : req.query.featured === 'false' ? false
                   : null
    const dateRange = req.query.date_range?.trim() || null

    const role         = req.user?.role
    const isAuthorRole = role === 'author'
    const isEditorPlus = role === 'editor' || role === 'super_admin'
    const isStaff      = isAuthorRole || isEditorPlus
    const wantsMine    = req.query.mine === 'true'
    const authorId     = (isAuthorRole && wantsMine) ? req.user.id : null

    let finalStatus = null
    if (!isStaff) {
      finalStatus = 'published'
    } else if (wantsMine || isEditorPlus) {
      const qs = req.query.status
      finalStatus = (qs && qs !== 'all') ? qs : null
    } else {
      finalStatus = 'published'
    }

    const cacheKey = !isStaff
      ? `video:articles:${page}:${limit}:${category ?? 'null'}:${search ?? 'null'}:${String(featured)}:${dateRange ?? 'null'}:${finalStatus ?? 'published'}`
      : null

    const fetcher = () => sql`
      SELECT ${VIDEO_LIST_COLS}
      FROM video_articles va
      JOIN users      u ON va.author_id   = u.id
      JOIN categories c ON va.category_id = c.id
      WHERE TRUE
        ${finalStatus !== null ? sql`AND va.status = ${finalStatus}`   : sql``}
        ${authorId    !== null ? sql`AND va.author_id = ${authorId}`   : sql``}
        ${category    !== null ? sql`AND c.slug = ${category}`        : sql``}
        ${featured    !== null ? sql`AND va.is_featured = ${featured}` : sql``}
        ${dateRange === 'today' ? sql`AND va.created_at >= date_trunc('day', now())`   : sql``}
        ${dateRange === 'week'  ? sql`AND va.created_at >= date_trunc('week', now())`  : sql``}
        ${dateRange === 'month' ? sql`AND va.created_at >= date_trunc('month', now())` : sql``}
        ${search !== null
          ? sql`AND va.search_vector @@ plainto_tsquery('english', ${search})`
          : sql``
        }
      ORDER BY va.sort_order ASC, va.published_at DESC NULLS LAST, va.created_at DESC
      LIMIT  ${limit}::int
      OFFSET ${offset}::int
    `

    const videoArticles = cacheKey
      ? await memCache.wrap(cacheKey, fetcher, TTL.LIST)
      : await fetcher()

    return res.status(200).json({
      success: true,
      data:    videoArticles,
      pagination: {
        page,
        limit,
        hasNextPage: videoArticles.length === limit,
        hasPrevPage: page > 1,
      },
    })

  } catch (err) { next(err) }
}

// ── getVideoArticleBySlug ──────────────────────────────────────────────────────

export const getVideoArticleBySlug = async (req, res, next) => {
  try {
    const { slug }  = req.params
    const cacheKey  = `video:article:${slug}`

    const fetcher = async () => {
      const result = await sql`
        SELECT
          va.*,
          u.full_name  AS author_name,
          u.avatar_url AS author_avatar,
          u.bio        AS author_bio,
          u.instagram_profile,
          u.twitter_profile,
          u.linkedin_profile,
          c.name  AS category_name,
          c.slug  AS category_slug,
          c.color AS category_color,
          la.id    AS linked_article_id,
          la.title AS linked_article_title,
          la.slug  AS linked_article_slug,
          la.cover_image AS linked_article_cover
        FROM video_articles va
        JOIN users      u ON va.author_id   = u.id
        JOIN categories c ON va.category_id = c.id
        LEFT JOIN articles la ON va.linked_article_id = la.id
        WHERE va.slug = ${slug} AND va.status = 'published'
      `
      if (result.length === 0) return null

      const videoArticle = result[0]

      videoArticle.tags = await sql`
        SELECT t.id, t.name, t.slug
        FROM tags t
        JOIN video_article_tags vat ON t.id = vat.tag_id
        WHERE vat.video_article_id = ${videoArticle.id}
      `
      return videoArticle
    }

    const videoArticle = await memCache.wrap(cacheKey, fetcher, TTL.DETAIL)

    if (!videoArticle) {
      return res.status(404).json({ success: false, message: 'Video article not found' })
    }

    return res.status(200).json({ success: true, data: videoArticle })

  } catch (err) { next(err) }
}

// ── updateVideoArticle ─────────────────────────────────────────────────────────

export const updateVideoArticle = async (req, res, next) => {
  try {
    const { id } = req.params

    const existing = await sql`SELECT * FROM video_articles WHERE id = ${id}`
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Video article not found' })
    }

    const videoArticle = existing[0]
    const isOwner      = videoArticle.author_id === req.user.id
    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role)
    if (!isOwner && !isEditorPlus) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    const {
      title, subtitle, body, excerpt, category_id,
      tag_ids, cover_image,
      video_type, video_url, video_public_id, video_provider, video_duration,
      status, is_featured, is_breaking,
      scheduled_at, meta_title, meta_description,
      sort_order,
      linked_article_id,
    } = req.body

    const isAuthor    = req.user.role === 'author'
    const finalStatus = (isAuthor && status === 'published') ? 'review' : status

    const bodyText    = body ? stripHtml(body) : videoArticle.body_text
    const readingTime = body ? calculateReadingTime(bodyText) : videoArticle.reading_time
    const publishedAt = finalStatus === 'published' && !videoArticle.published_at
      ? new Date()
      : videoArticle.published_at

    const finalLinkedArticleId = linked_article_id !== undefined
      ? (linked_article_id || null)
      : (videoArticle.linked_article_id || null)

    const featuredAt = is_featured !== undefined
      ? (is_featured ? new Date() : null)
      : videoArticle.featured_at
    const breakingAt = is_breaking !== undefined
      ? (is_breaking ? new Date() : null)
      : videoArticle.breaking_at

    const [updated] = await sql`
      UPDATE video_articles SET
        title            = COALESCE(${title            || null}, title),
        subtitle         = COALESCE(${subtitle         || null}, subtitle),
        body             = COALESCE(${body             || null}, body),
        body_text        = COALESCE(${bodyText         || null}, body_text),
        excerpt          = COALESCE(${excerpt          || null}, excerpt),
        cover_image      = COALESCE(${cover_image      || null}, cover_image),
        video_type       = COALESCE(${video_type       || null}, video_type),
        video_url        = COALESCE(${video_url        || null}, video_url),
        video_public_id  = COALESCE(${video_public_id  || null}, video_public_id),
        video_provider   = COALESCE(${video_provider   || null}, video_provider),
        video_duration   = COALESCE(${video_duration   ?? null}, video_duration),
        category_id      = COALESCE(${category_id      || null}, category_id),
        status           = COALESCE(${finalStatus      || null}, status),
        is_featured      = COALESCE(${is_featured      ?? null}, is_featured),
        is_breaking      = COALESCE(${is_breaking      ?? null}, is_breaking),
        featured_at      = ${featuredAt},
        breaking_at      = ${breakingAt},
        scheduled_at     = COALESCE(${scheduled_at     || null}, scheduled_at),
        meta_title       = COALESCE(${meta_title       || null}, meta_title),
        meta_description = COALESCE(${meta_description || null}, meta_description),
        reading_time     = ${readingTime},
        published_at     = ${publishedAt},
        sort_order       = COALESCE(${sort_order ?? null}, sort_order),
        linked_article_id = ${finalLinkedArticleId}
      WHERE id = ${id}
      RETURNING id, slug, title, status
    `

    if (tag_ids !== undefined) {
      await sql`DELETE FROM video_article_tags WHERE video_article_id = ${id}`
      for (const tagId of tag_ids) {
        await sql`
          INSERT INTO video_article_tags (video_article_id, tag_id)
          VALUES (${id}, ${tagId}) ON CONFLICT DO NOTHING
        `
      }
    }

    memCache.invalidate(`video:article:${videoArticle.slug}`)
    memCache.invalidate('video:')
    memCache.invalidate('stats:')
    memCache.invalidate('home:')
    if (finalStatus === 'published') {
      memCache.invalidate('videoTrending:')
      scheduleVideoAiProcessing(id, bodyText, tag_ids, title || videoArticle.title, excerpt || videoArticle.excerpt, cover_image || videoArticle.cover_image, updated.slug || videoArticle.slug, videoArticle.body_text)
      submitToIndexNow(updated.slug, 'video')
    }

    const message = finalStatus === 'review'
      ? 'Video article submitted for review'
      : 'Video article updated'

    return res.status(200).json({ success: true, message, data: updated })

  } catch (err) { next(err) }
}

// ── deleteVideoArticle ─────────────────────────────────────────────────────────

export const deleteVideoArticle = async (req, res, next) => {
  try {
    const { id } = req.params

    const [existing] = await sql`SELECT author_id, slug, video_public_id, video_type FROM video_articles WHERE id = ${id}`
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Video article not found' })
    }

    const isOwner      = existing.author_id === req.user.id
    const isSuperAdmin = req.user.role === 'super_admin'
    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    // Delete uploaded video from Cloudinary
    if (existing.video_type === 'uploaded' && existing.video_public_id) {
      await deleteImage(existing.video_public_id, 'video')
    }

    await sql`DELETE FROM video_articles WHERE id = ${id}`

    memCache.invalidate(`video:article:${existing.slug}`)
    memCache.invalidate('video:')
    memCache.invalidate('stats:')
    memCache.invalidate('videoTrending:')
    memCache.invalidate('home:')

    return res.status(200).json({ success: true, message: 'Video article deleted' })

  } catch (err) { next(err) }
}

// ── getVideoReviewQueue ────────────────────────────────────────────────────────

export const getVideoReviewQueue = async (req, res, next) => {
  try {
    const videoArticles = await sql`
      SELECT
        va.id, va.title, va.slug, va.subtitle, va.excerpt,
        va.cover_image, va.reading_time, va.status,
        va.video_type, va.video_url, va.video_provider,
        va.is_featured, va.is_breaking,
        va.view_count, va.like_count, va.comment_count,
        va.published_at, va.created_at, va.body,
        u.full_name  AS author_name,
        u.avatar_url AS author_avatar,
        u.bio        AS author_bio,
        c.name  AS category_name,
        c.slug  AS category_slug,
        c.color AS category_color,
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'slug', t.slug))
           FROM tags t
           JOIN video_article_tags vat ON t.id = vat.tag_id
           WHERE vat.video_article_id = va.id),
          '[]'
        ) AS tags
      FROM video_articles va
      JOIN users      u ON va.author_id   = u.id
      JOIN categories c ON va.category_id = c.id
      WHERE va.status = 'review'
      ORDER BY va.created_at DESC
    `

    return res.status(200).json({ success: true, data: videoArticles })
  } catch (err) { next(err) }
}

// ── videoReviewAction ──────────────────────────────────────────────────────────

export const videoReviewAction = async (req, res, next) => {
  try {
    const { id }     = req.params
    const { action } = req.body

    if (!['approve', 'request_changes', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' })
    }

    const [existing] = await sql`SELECT * FROM video_articles WHERE id = ${id}`
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Video article not found' })
    }
    if (existing.status !== 'review') {
      return res.status(400).json({ success: false, message: 'Video article is not in review' })
    }

    const newStatus = action === 'approve'
      ? 'published'
      : action === 'request_changes'
        ? 'draft'
        : 'archived'

    const publishedAt = action === 'approve' ? new Date() : existing.published_at

    const [updated] = await sql`
      UPDATE video_articles
      SET status       = ${newStatus},
          published_at = ${publishedAt}
      WHERE id = ${id}
      RETURNING id, slug, title, status
    `

    memCache.invalidate(`video:article:${existing.slug}`)
    memCache.invalidate('video:')
    memCache.invalidate('stats:')
    if (action === 'approve') {
      memCache.invalidate('videoTrending:')
      scheduleVideoAiProcessing(id, existing.body_text, [], existing.title, existing.excerpt, existing.cover_image, updated.slug)
      submitToIndexNow(updated.slug, 'video')
    }

    const messages = {
      approve:         'Video article approved and published',
      request_changes: 'Video article sent back to author for changes',
      reject:          'Video article rejected and archived',
    }

    return res.status(200).json({
      success: true,
      message: messages[action],
      data:    updated,
    })
  } catch (err) { next(err) }
}

// ── getTrendingVideoArticles ───────────────────────────────────────────────────

export const getTrendingVideoArticles = async (req, res, next) => {
  try {
    const days  = Math.min(parseInt(req.query.days  ?? '7'),  3650)
    const limit = Math.min(parseInt(req.query.limit ?? '10'), 50)

    const cacheKey = `videoTrending:${days}:${limit}`

    const videoArticles = await memCache.wrap(
      cacheKey,
      () => sql`
        SELECT
          va.id, va.title, va.slug, va.cover_image, va.excerpt,
          va.video_type, va.video_provider, va.video_duration,
          va.view_count, va.like_count, va.comment_count,
          va.published_at, va.reading_time,
          va.is_breaking, va.is_featured,
          u.full_name  AS author_name,
          c.name       AS category_name,
          c.slug       AS category_slug,
          c.color      AS category_color,
          (
            COUNT(av.id)    * 1.0 +
            va.like_count    * 3.0 +
            va.comment_count * 2.0
          ) AS trend_score
        FROM video_articles va
        LEFT JOIN article_views av
          ON va.id = av.video_article_id
          AND av.content_type = 'video_article'
          AND av.created_at >= NOW() - (${days} || ' days')::INTERVAL
        LEFT JOIN users      u ON va.author_id   = u.id
        LEFT JOIN categories c ON va.category_id = c.id
        WHERE va.status = 'published'
          AND va.published_at >= NOW() - (${days} || ' days')::INTERVAL
        GROUP BY va.id, u.id, c.id
        ORDER BY trend_score DESC
        LIMIT ${limit}
      `,
      TTL.TRENDING,
    )

    res.json({ success: true, data: videoArticles })

  } catch (err) { next(err) }
}

// ── getRelatedVideoArticles ────────────────────────────────────────────────────

export const getRelatedVideoArticles = async (req, res, next) => {
  try {
    const { id }   = req.params
    const cacheKey = `videoRelated:${id}`

    const videoArticles = await memCache.wrap(
      cacheKey,
      async () => {
        // 1) Try tag-based matching
        const tagRows = await sql`
          SELECT tag_id FROM video_article_tags WHERE video_article_id = ${id}
        `
        const tagIds = (tagRows || []).map(r => r.tag_id).filter(Boolean)

        if (tagIds.length > 0) {
          const relatedByTags = await sql`
            SELECT ${VIDEO_LIST_COLS}, COUNT(vat2.tag_id) AS shared
            FROM video_articles va
            JOIN users      u ON va.author_id   = u.id
            JOIN categories c ON va.category_id = c.id
            LEFT JOIN video_article_tags vat2 ON vat2.video_article_id = va.id
            WHERE va.status = 'published'
              AND va.id != ${id}
              AND vat2.tag_id = ANY(${tagIds})
            GROUP BY va.id, u.id, c.id
            ORDER BY shared DESC, va.published_at DESC
            LIMIT 12
          `
          if (relatedByTags && relatedByTags.length > 0) return relatedByTags
        }

        // 2) Fallback to category-based recent video articles
        const [base] = await sql`
          SELECT category_id FROM video_articles WHERE id = ${id}
        `
        if (base) {
          const byCategory = await sql`
            SELECT ${VIDEO_LIST_COLS}
            FROM video_articles va
            JOIN users      u ON va.author_id   = u.id
            JOIN categories c ON va.category_id = c.id
            WHERE va.status      = 'published'
              AND va.id         != ${id}
              AND va.category_id = ${base.category_id}
            ORDER BY va.published_at DESC
            LIMIT 6
          `
          if (byCategory && byCategory.length > 0) return byCategory
        }

        // 3) Final fallback: trending video articles
        const trending = await sql`
          SELECT
            va.id, va.title, va.slug, va.cover_image, va.excerpt,
            va.video_type, va.video_provider, va.video_duration,
            va.view_count, va.like_count, va.comment_count,
            va.published_at, va.reading_time,
            va.is_breaking, va.is_featured,
            u.full_name  AS author_name,
            c.name       AS category_name,
            c.slug       AS category_slug,
            c.color      AS category_color,
            (
              COUNT(av.id)    * 1.0 +
              va.like_count    * 3.0 +
              va.comment_count * 2.0
            ) AS trend_score
          FROM video_articles va
          LEFT JOIN article_views av
            ON va.id = av.video_article_id
            AND av.content_type = 'video_article'
            AND av.created_at >= NOW() - ('7 days')::INTERVAL
          LEFT JOIN users      u ON va.author_id   = u.id
          LEFT JOIN categories c ON va.category_id = c.id
          WHERE va.status = 'published'
          GROUP BY va.id, u.id, c.id
          ORDER BY trend_score DESC
          LIMIT 6
        `
        return trending
      },
      TTL.DETAIL,
    )

    res.json({ success: true, data: videoArticles })

  } catch (err) { next(err) }
}

// ── toggleVideoLike ────────────────────────────────────────────────────────────

export const toggleVideoLike = async (req, res, next) => {
  try {
    const { id: video_article_id } = req.params
    const { fingerprint } = req.body || {}
    const userId = req.user?.id || null

    if (!userId && !fingerprint) {
      return res.status(400).json({
        success: false,
        message: 'A fingerprint is required for anonymous likes',
      })
    }

    let existing

    if (userId) {
      const result = await sql`
        SELECT id FROM article_likes
        WHERE video_article_id = ${video_article_id} AND user_id = ${userId}
          AND content_type = 'video_article'
      `
      existing = result[0]
    } else {
      const result = await sql`
        SELECT id FROM article_likes
        WHERE video_article_id = ${video_article_id} AND fingerprint = ${fingerprint}
          AND content_type = 'video_article'
      `
      existing = result[0]
    }

    if (existing) {
      await sql`DELETE FROM article_likes WHERE id = ${existing.id}`

      const updated = await sql`
        UPDATE video_articles
        SET like_count = GREATEST(0, like_count - 1)
        WHERE id = ${video_article_id}
        RETURNING like_count
      `

      return res.status(200).json({
        success: true,
        data: {
          liked:      false,
          like_count: updated[0]?.like_count ?? 0,
        },
      })
    } else {
      await sql`
        INSERT INTO article_likes (video_article_id, content_type, user_id, fingerprint, ip_address)
        VALUES (
          ${video_article_id},
          'video_article',
          ${userId},
          ${fingerprint || null},
          ${req.ip}
        )
      `

      const updated = await sql`
        UPDATE video_articles
        SET like_count = like_count + 1
        WHERE id = ${video_article_id}
        RETURNING like_count
      `

      return res.status(200).json({
        success: true,
        data: {
          liked:      true,
          like_count: updated[0]?.like_count ?? 0,
        },
      })
    }

  } catch (err) { next(err) }
}

// ── getVideoLikeStatus ─────────────────────────────────────────────────────────

export const getVideoLikeStatus = async (req, res, next) => {
  try {
    const { id: video_article_id } = req.params
    const { fingerprint }    = req.query
    const userId = req.user?.id || null

    let liked = false

    if (userId) {
      const result = await sql`
        SELECT id FROM article_likes
        WHERE video_article_id = ${video_article_id} AND user_id = ${userId}
          AND content_type = 'video_article'
      `
      liked = result.length > 0
    } else if (fingerprint) {
      const result = await sql`
        SELECT id FROM article_likes
        WHERE video_article_id = ${video_article_id} AND fingerprint = ${fingerprint}
          AND content_type = 'video_article'
      `
      liked = result.length > 0
    }

    const videoArticle = await sql`
      SELECT like_count FROM video_articles WHERE id = ${video_article_id}
    `

    return res.status(200).json({
      success: true,
      data: {
        liked,
        like_count: videoArticle[0]?.like_count ?? 0,
      },
    })

  } catch (err) { next(err) }
}

// ── trackVideoView ─────────────────────────────────────────────────────────────

export const trackVideoView = async (req, res, next) => {
  try {
    const { id } = req.params
    const { session_id, referrer } = req.body || {}

    const userId    = req.user?.id || null
    const ipAddress = req.ip       || null

    let existing

    if (userId) {
      existing = await sql`
        SELECT id FROM article_views
        WHERE video_article_id = ${id}
          AND content_type = 'video_article'
          AND user_id    = ${userId}
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `
    } else if (ipAddress) {
      existing = await sql`
        SELECT id FROM article_views
        WHERE video_article_id = ${id}
          AND content_type = 'video_article'
          AND user_id    IS NULL
          AND ip_address = ${ipAddress}::inet
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `
    } else {
      return res.status(200).json({ success: true, message: 'Skipped' })
    }

    if (existing.length > 0) {
      return res.status(200).json({ success: true, message: 'Already counted' })
    }

    await sql`
      INSERT INTO article_views
        (video_article_id, content_type, user_id, session_id, ip_address, referrer)
      VALUES (
        ${id},
        'video_article',
        ${userId},
        ${session_id || null},
        ${ipAddress ? sql`${ipAddress}::inet` : null},
        ${referrer   || null}
      )
    `

    await sql`
      UPDATE video_articles
      SET view_count = view_count + 1
      WHERE id = ${id}
    `

    return res.status(200).json({ success: true })

  } catch (err) {
    console.error('[Video Views] Track error:', err.message)
    return res.status(200).json({ success: true })
  }
}
