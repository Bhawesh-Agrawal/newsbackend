import sql from "../config/database.js";
import {
  generateSlug, calculateReadingTime,
  stripHtml, generateExcerpt, parsePagination
} from "../utils/helpers.js";
import { generateSummary, generateTags } from '../services/ai.services.js';
import { memCache, TTL } from '../utils/memCache.js';
import { submitToIndexNow } from '../utils/indexnow.js';

// ── Shared article SELECT columns ─────────────────────────────────────────────
const LIST_COLS = sql`
  a.id, a.author_id, a.title, a.slug, a.subtitle, a.excerpt,
  a.cover_image, a.cover_crop, a.reading_time, a.status,
  a.is_featured, a.is_breaking,
  a.view_count, a.like_count, a.comment_count,
  a.published_at, a.created_at,
  a.ai_summary,
  u.full_name  AS author_name,
  u.avatar_url AS author_avatar,
  c.name  AS category_name,
  c.slug  AS category_slug,
  c.color AS category_color
`

// ── Sanitise cover_crop input ─────────────────────────────────────────────────
// Ensures the JSONB value stored is always valid regardless of what the
// client sends.  Falls back to center/no-zoom if anything looks wrong.
function sanitizeCrop(raw) {
  const fallback = { x: 50, y: 50, zoom: 1 }
  if (!raw || typeof raw !== 'object') return fallback
  const x    = Number(raw.x)
  const y    = Number(raw.y)
  const zoom = Number(raw.zoom)
  if (!isFinite(x) || !isFinite(y) || !isFinite(zoom)) return fallback
  return {
    x:    Math.round(Math.max(0, Math.min(100, x))),
    y:    Math.round(Math.max(0, Math.min(100, y))),
    zoom: Math.max(1, Math.min(4, parseFloat(zoom.toFixed(2)))),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scheduleAiProcessing(articleId, bodyText, tagIds, titleText) {
  (async () => {
    try {
      const summary = await generateSummary(bodyText)
      if (summary) {
        await sql`UPDATE articles SET ai_summary = ${summary} WHERE id = ${articleId}`
      }

      if (!tagIds || tagIds.length === 0) {
        const suggestedTags = await generateTags(titleText, bodyText)
        for (const tagName of suggestedTags) {
          const slug = generateSlug(tagName)
          const tag  = await sql`
            INSERT INTO tags (name, slug) VALUES (${tagName}, ${slug})
            ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
          `
          await sql`
            INSERT INTO article_tags (article_id, tag_id)
            VALUES (${articleId}, ${tag[0].id})
            ON CONFLICT DO NOTHING
          `
        }
      }
    } catch (err) {
      console.error('[AI] Post-publish processing failed:', err.message)
    }
  })()
}

// ── createArticle ─────────────────────────────────────────────────────────────

export const createArticle = async (req, res, next) => {
  try {
    const {
      title, subtitle, body, excerpt, category_id,
      tag_ids = [], cover_image, cover_crop,
      status = 'draft',
      is_featured = false, is_breaking = false,
      scheduled_at, meta_title, meta_description,
    } = req.body

    const isAuthor  = req.user.role === 'author'
    const finalStatus = (isAuthor && status === 'published') ? 'review' : status

    const baseSlug = generateSlug(title)
    const existing = await sql`SELECT id FROM articles WHERE slug = ${baseSlug}`
    const slug     = existing.length > 0 ? `${baseSlug}-${Date.now()}` : baseSlug

    const bodyText     = stripHtml(body)
    const finalExcerpt = excerpt || generateExcerpt(bodyText)
    const reading_time = calculateReadingTime(bodyText)
    const publishedAt  = finalStatus === 'published' ? new Date() : null
    const cropValue    = JSON.stringify(sanitizeCrop(cover_crop))
    const featuredAt   = is_featured ? new Date() : null
    const breakingAt   = is_breaking ? new Date() : null

    const [article] = await sql`
      INSERT INTO articles (
        title, slug, subtitle, body, body_text, excerpt,
        cover_image, cover_crop, category_id, author_id,
        status, is_featured, is_breaking,
        reading_time, published_at, scheduled_at,
        meta_title, meta_description,
        featured_at, breaking_at
      ) VALUES (
        ${title}, ${slug}, ${subtitle || null}, ${body}, ${bodyText}, ${finalExcerpt},
        ${cover_image || null}, ${cropValue}::jsonb, ${category_id}, ${req.user.id},
        ${finalStatus}, ${is_featured}, ${is_breaking},
        ${reading_time}, ${publishedAt}, ${scheduled_at || null},
        ${meta_title || title}, ${meta_description || finalExcerpt},
        ${featuredAt}, ${breakingAt}
      ) RETURNING id, slug, title, status
    `

    if (tag_ids.length > 0) {
      for (const tagId of tag_ids) {
        await sql`
          INSERT INTO article_tags (article_id, tag_id)
          VALUES (${article.id}, ${tagId}) ON CONFLICT DO NOTHING
        `
      }
    }

    if (finalStatus === 'published') {
      memCache.invalidate('articles:')
      memCache.invalidate('stats:')
      memCache.invalidate('trending:')
      memCache.invalidate('home:')
      scheduleAiProcessing(article.id, bodyText, tag_ids, title)
      submitToIndexNow(article.slug)
    }

    const message = finalStatus === 'review'
      ? 'Article submitted for review'
      : 'Article created'

    return res.status(201).json({ success: true, message, data: article })

  } catch (err) { next(err) }
}

// ── getArticleById ────────────────────────────────────────────────────────────

export const getArticleById = async (req, res, next) => {
  try {
    const { id } = req.params

    const result = await sql`
      SELECT
        a.*,
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
        ) AS tags,
        COALESCE(
          (SELECT json_agg(t.id)
           FROM tags t
           JOIN article_tags at ON t.id = at.tag_id
           WHERE at.article_id = a.id),
          '[]'
        ) AS tag_ids
      FROM articles a
      JOIN users      u ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.id = ${id}
    `

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' })
    }

    const article = result[0]

    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role)
    if (!isEditorPlus && article.author_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    return res.status(200).json({ success: true, data: article })

  } catch (err) { next(err) }
}

// ── getArticles ───────────────────────────────────────────────────────────────

export const getArticles = async (req, res, next) => {
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
      ? `articles:${page}:${limit}:${category ?? 'null'}:${search ?? 'null'}:${String(featured)}:${dateRange ?? 'null'}:${finalStatus ?? 'published'}`
      : null

    const fetcher = () => sql`
      SELECT ${LIST_COLS}
      FROM articles a
      JOIN users      u ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      ${category !== null ? sql`LEFT JOIN category_pins cp ON cp.article_id = a.id AND cp.category_id = c.id` : sql``}
      WHERE TRUE
        ${finalStatus !== null ? sql`AND a.status = ${finalStatus}`   : sql``}
        ${authorId    !== null ? sql`AND a.author_id = ${authorId}`   : sql``}
        ${category    !== null ? sql`AND c.slug = ${category}`        : sql``}
        ${featured    !== null ? sql`AND a.is_featured = ${featured}` : sql``}
        ${dateRange === 'today' ? sql`AND a.created_at >= date_trunc('day', now())`   : sql``}
        ${dateRange === 'week'  ? sql`AND a.created_at >= date_trunc('week', now())`  : sql``}
        ${dateRange === 'month' ? sql`AND a.created_at >= date_trunc('month', now())` : sql``}
        ${search !== null
          ? sql`AND a.search_vector @@ plainto_tsquery('english', ${search})`
          : sql``
        }
      ORDER BY ${category !== null ? sql`cp.position ASC NULLS LAST, ` : sql``} a.published_at DESC NULLS LAST, a.created_at DESC
      LIMIT  ${limit}::int
      OFFSET ${offset}::int
    `

    const articles = cacheKey
      ? await memCache.wrap(cacheKey, fetcher, TTL.LIST)
      : await fetcher()

    return res.status(200).json({
      success: true,
      data:    articles,
      pagination: {
        page,
        limit,
        hasNextPage: articles.length === limit,
        hasPrevPage: page > 1,
      },
    })

  } catch (err) { next(err) }
}

// ── getArticleBySlug ──────────────────────────────────────────────────────────

export const getArticleBySlug = async (req, res, next) => {
  try {
    const { slug }  = req.params
    const cacheKey  = `article:${slug}`

    const fetcher = async () => {
      const result = await sql`
        SELECT
          a.*,
          u.full_name  AS author_name,
          u.avatar_url AS author_avatar,
          u.bio        AS author_bio,
          u.instagram_profile,
          u.twitter_profile,
          u.linkedin_profile,
          c.name  AS category_name,
          c.slug  AS category_slug,
          c.color AS category_color
        FROM articles a
        JOIN users      u ON a.author_id   = u.id
        JOIN categories c ON a.category_id = c.id
        WHERE a.slug = ${slug} AND a.status = 'published'
      `
      if (result.length === 0) return null

      const article = result[0]

      article.tags = await sql`
        SELECT t.id, t.name, t.slug
        FROM tags t
        JOIN article_tags at ON t.id = at.tag_id
        WHERE at.article_id = ${article.id}
      `
      return article
    }

    const article = await memCache.wrap(cacheKey, fetcher, TTL.DETAIL)

    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' })
    }

    sql`UPDATE articles SET view_count = view_count + 1 WHERE id = ${article.id}`
      .catch(() => {})

    return res.status(200).json({ success: true, data: article })

  } catch (err) { next(err) }
}

// ── updateArticle ─────────────────────────────────────────────────────────────

export const updateArticle = async (req, res, next) => {
  try {
    const { id } = req.params

    const existing = await sql`SELECT * FROM articles WHERE id = ${id}`
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' })
    }

    const article      = existing[0]
    const isOwner      = article.author_id === req.user.id
    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role)
    if (!isOwner && !isEditorPlus) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    const {
      title, subtitle, body, excerpt, category_id,
      tag_ids, cover_image, cover_crop,
      status, is_featured, is_breaking,
      scheduled_at, meta_title, meta_description,
    } = req.body

    const isAuthor    = req.user.role === 'author'
    const finalStatus = (isAuthor && status === 'published') ? 'review' : status

    const bodyText    = body ? stripHtml(body) : article.body_text
    const readingTime = body ? calculateReadingTime(bodyText) : article.reading_time
    const publishedAt = finalStatus === 'published' && !article.published_at
      ? new Date()
      : article.published_at

    // Only update cover_crop if the client explicitly sent one.
    // If omitted (undefined), keep whatever is already in the DB.
    const cropValue = cover_crop !== undefined
      ? JSON.stringify(sanitizeCrop(cover_crop))
      : null

    const [updated] = await sql`
      UPDATE articles SET
        title            = COALESCE(${title            || null}, title),
        subtitle         = COALESCE(${subtitle         || null}, subtitle),
        body             = COALESCE(${body             || null}, body),
        body_text        = COALESCE(${bodyText         || null}, body_text),
        excerpt          = COALESCE(${excerpt          || null}, excerpt),
        cover_image      = COALESCE(${cover_image      || null}, cover_image),
        cover_crop       = COALESCE(${cropValue ? sql`${cropValue}::jsonb` : sql`NULL`}, cover_crop),
        category_id      = COALESCE(${category_id      || null}, category_id),
        status           = COALESCE(${finalStatus      || null}, status),
        is_featured      = COALESCE(${is_featured      ?? null}, is_featured),
        is_breaking      = COALESCE(${is_breaking      ?? null}, is_breaking),
        featured_at      = CASE
                            WHEN ${is_featured ?? null} IS NULL THEN featured_at
                            WHEN ${is_featured ?? null} = TRUE THEN NOW()
                            ELSE NULL
                           END,
        breaking_at      = CASE
                            WHEN ${is_breaking ?? null} IS NULL THEN breaking_at
                            WHEN ${is_breaking ?? null} = TRUE THEN NOW()
                            ELSE NULL
                           END,
        scheduled_at     = COALESCE(${scheduled_at     || null}, scheduled_at),
        meta_title       = COALESCE(${meta_title       || null}, meta_title),
        meta_description = COALESCE(${meta_description || null}, meta_description),
        reading_time     = ${readingTime},
        published_at     = ${publishedAt}
      WHERE id = ${id}
      RETURNING id, slug, title, status
    `

    if (tag_ids !== undefined) {
      await sql`DELETE FROM article_tags WHERE article_id = ${id}`
      for (const tagId of tag_ids) {
        await sql`
          INSERT INTO article_tags (article_id, tag_id)
          VALUES (${id}, ${tagId}) ON CONFLICT DO NOTHING
        `
      }
    }

    memCache.invalidate(`article:${article.slug}`)
    memCache.invalidate('articles:')
    memCache.invalidate('stats:')
    memCache.invalidate('related:')
    memCache.invalidate('home:')
    if (finalStatus === 'published') {
      memCache.invalidate('trending:')
      scheduleAiProcessing(id, bodyText, tag_ids, title || article.title)
      submitToIndexNow(updated.slug)
    }

    const message = finalStatus === 'review'
      ? 'Article submitted for review'
      : 'Article updated'

    return res.status(200).json({ success: true, message, data: updated })

  } catch (err) { next(err) }
}

// ── deleteArticle ─────────────────────────────────────────────────────────────

export const deleteArticle = async (req, res, next) => {
  try {
    const { id } = req.params

    const [existing] = await sql`SELECT author_id, slug FROM articles WHERE id = ${id}`
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Article not found' })
    }

    const isOwner      = existing.author_id === req.user.id
    const isSuperAdmin = req.user.role === 'super_admin'
    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    await sql`DELETE FROM articles WHERE id = ${id}`

    memCache.invalidate(`article:${existing.slug}`)
    memCache.invalidate('articles:')
    memCache.invalidate('stats:')
    memCache.invalidate('trending:')
    memCache.invalidate('related:')
    memCache.invalidate('home:')

    return res.status(200).json({ success: true, message: 'Article deleted' })

  } catch (err) { next(err) }
}

// ── getTrendingArticles ───────────────────────────────────────────────────────

export const getTrendingArticles = async (req, res, next) => {
  try {
    const days  = Math.min(parseInt(req.query.days  ?? '7'),  3650)
    const limit = Math.min(parseInt(req.query.limit ?? '10'), 50)

    const cacheKey = `trending:${days}:${limit}`

    const articles = await memCache.wrap(
      cacheKey,
      () => sql`
        SELECT
          a.id, a.title, a.slug, a.cover_image, a.cover_crop, a.excerpt,
          a.view_count, a.like_count, a.comment_count,
          a.published_at, a.reading_time,
          a.is_breaking, a.is_featured,
          u.full_name  AS author_name,
          c.name       AS category_name,
          c.slug       AS category_slug,
          c.color      AS category_color,
          (
            COUNT(av.id)    * 1.0 +
            a.like_count    * 3.0 +
            a.comment_count * 2.0
          ) AS trend_score
        FROM articles a
        LEFT JOIN article_views av
          ON a.id = av.article_id
          AND av.created_at >= NOW() - (${days} || ' days')::INTERVAL
        LEFT JOIN users      u ON a.author_id   = u.id
        LEFT JOIN categories c ON a.category_id = c.id
        WHERE a.status = 'published'
        GROUP BY a.id, u.id, c.id
        ORDER BY trend_score DESC
        LIMIT ${limit}
      `,
      TTL.TRENDING,
    )

    res.json({ success: true, data: articles })

  } catch (err) { next(err) }
}

// ── getRelatedArticles ────────────────────────────────────────────────────────

export const getRelatedArticles = async (req, res, next) => {
  try {
    const { id }   = req.params
    const cacheKey = `related:${id}`

    const articles = await memCache.wrap(
      cacheKey,
      async () => {
        // 1) Try tag-based matching and scoring by shared tag count
        const tagRows = await sql`
          SELECT tag_id FROM article_tags WHERE article_id = ${id}
        `
        const tagIds = (tagRows || []).map(r => r.tag_id).filter(Boolean)

        if (tagIds.length > 0) {
          const relatedByTags = await sql`
            SELECT ${LIST_COLS}, COUNT(at2.tag_id) AS shared
            FROM articles a
            JOIN users      u ON a.author_id   = u.id
            JOIN categories c ON a.category_id = c.id
            LEFT JOIN article_tags at2 ON at2.article_id = a.id
            WHERE a.status = 'published'
              AND a.id != ${id}
              AND at2.tag_id = ANY(${tagIds})
            GROUP BY a.id, u.id, c.id
            ORDER BY shared DESC, a.published_at DESC
            LIMIT 12
          `

          if (relatedByTags && relatedByTags.length > 0) return relatedByTags
        }

        // 2) Fallback to category-based recent articles (previous behaviour)
        const [base] = await sql`
          SELECT category_id FROM articles WHERE id = ${id}
        `
        if (base) {
          const byCategory = await sql`
            SELECT ${LIST_COLS}
            FROM articles a
            JOIN users      u ON a.author_id   = u.id
            JOIN categories c ON a.category_id = c.id
            WHERE a.status      = 'published'
              AND a.id         != ${id}
              AND a.category_id = ${base.category_id}
            ORDER BY a.published_at DESC
            LIMIT 6
          `
          if (byCategory && byCategory.length > 0) return byCategory
        }

        // 3) Final fallback: trending
        const trending = await sql`
          SELECT
            a.id, a.title, a.slug, a.cover_image, a.cover_crop, a.excerpt,
            a.view_count, a.like_count, a.comment_count,
            a.published_at, a.reading_time,
            a.is_breaking, a.is_featured,
            u.full_name  AS author_name,
            c.name       AS category_name,
            c.slug       AS category_slug,
            c.color      AS category_color,
            (
              COUNT(av.id)    * 1.0 +
              a.like_count    * 3.0 +
              a.comment_count * 2.0
            ) AS trend_score
          FROM articles a
          LEFT JOIN article_views av
            ON a.id = av.article_id
            AND av.created_at >= NOW() - ('7 days')::INTERVAL
          LEFT JOIN users      u ON a.author_id   = u.id
          LEFT JOIN categories c ON a.category_id = c.id
          WHERE a.status = 'published'
          GROUP BY a.id, u.id, c.id
          ORDER BY trend_score DESC
          LIMIT 6
        `
        return trending
      },
      TTL.DETAIL,
    )

    res.json({ success: true, data: articles })

  } catch (err) { next(err) }
}