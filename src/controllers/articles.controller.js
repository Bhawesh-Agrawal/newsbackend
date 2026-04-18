import sql from "../config/database.js";
import {
  generateSlug, calculateReadingTime,
  stripHtml, generateExcerpt, parsePagination
} from "../utils/helpers.js";
import { generateSummary, generateTags } from '../services/ai.services.js';
import { memCache, TTL } from '../utils/memCache.js';

// ── Shared article SELECT columns ─────────────────────────────────────────────
// Centralised so list vs detail queries stay in sync without duplicating SQL.
// List queries omit body/body_text — those can be 10–100 KB per article.
// Detail queries add body, body_text, author_bio, ai_summary, etc.

const LIST_COLS = sql`
  a.id, a.title, a.slug, a.subtitle, a.excerpt,
  a.cover_image, a.reading_time, a.status,
  a.is_featured, a.is_breaking,
  a.view_count, a.like_count, a.comment_count,
  a.published_at, a.created_at,
  u.full_name  AS author_name,
  u.avatar_url AS author_avatar,
  c.name  AS category_name,
  c.slug  AS category_slug,
  c.color AS category_color
`

// ── Helpers ───────────────────────────────────────────────────────────────────

// Fires AI processing asynchronously after publish — never blocks the response.
// Uses local vars (no stale closure issues from outer scope).
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
      tag_ids = [], cover_image, status = 'draft',
      is_featured = false, is_breaking = false,
      scheduled_at, meta_title, meta_description,
    } = req.body

    const baseSlug = generateSlug(title)
    const existing = await sql`SELECT id FROM articles WHERE slug = ${baseSlug}`
    const slug     = existing.length > 0 ? `${baseSlug}-${Date.now()}` : baseSlug

    const bodyText     = stripHtml(body)
    const finalExcerpt = excerpt || generateExcerpt(bodyText)
    const reading_time = calculateReadingTime(bodyText)
    const publishedAt  = status === 'published' ? new Date() : null

    const [article] = await sql`
      INSERT INTO articles (
        title, slug, subtitle, body, body_text, excerpt,
        cover_image, category_id, author_id,
        status, is_featured, is_breaking,
        reading_time, published_at, scheduled_at,
        meta_title, meta_description
      ) VALUES (
        ${title}, ${slug}, ${subtitle || null}, ${body}, ${bodyText}, ${finalExcerpt},
        ${cover_image || null}, ${category_id}, ${req.user.id},
        ${status}, ${is_featured}, ${is_breaking},
        ${reading_time}, ${publishedAt}, ${scheduled_at || null},
        ${meta_title || title}, ${meta_description || finalExcerpt}
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

    if (status === 'published') {
      // Invalidate list + trending caches so fresh content appears immediately
      memCache.invalidate('articles:')
      memCache.invalidate('stats:')
      memCache.invalidate('trending:')
      scheduleAiProcessing(article.id, bodyText, tag_ids, title)
    }

    return res.status(201).json({ success: true, message: 'Article created', data: article })

  } catch (err) { next(err) }
}

// ── getArticles ───────────────────────────────────────────────────────────────
// One key insight: the COUNT(*) query doubles DB load on every page.
// We skip it entirely for paginated browsing — the frontend uses hasMore
// (incoming.length === limit) rather than a total count.

export const getArticles = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query)
 
    // Sanitise — never pass empty string
    const category = req.query.category?.trim() || null
    const search   = req.query.search?.trim()   || null
    const featured = req.query.featured === 'true' ? true
                   : req.query.featured === 'false' ? false
                   : null
 
    const allowedStatuses = ['super_admin', 'editor', 'author']
    const finalStatus = allowedStatuses.includes(req.user?.role) && req.query.status
      ? req.query.status
      : 'published'
 
    const isStaff  = allowedStatuses.includes(req.user?.role)
    const cacheKey = isStaff
      ? null
      : `articles:${page}:${limit}:${category}:${search}:${featured}`
 
    const fetcher = () => sql`
      SELECT ${LIST_COLS}
      FROM articles a
      JOIN users      u ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.status = ${finalStatus}
        ${category !== null ? sql`AND c.slug = ${category}` : sql``}
        ${featured !== null ? sql`AND a.is_featured = ${featured}` : sql``}
        ${search   !== null
          ? sql`AND a.search_vector @@ plainto_tsquery('english', ${search})`
          : sql``
        }
      ORDER BY a.published_at DESC NULLS LAST
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
    const { slug }    = req.params
    const cacheKey    = `article:${slug}`

    const fetcher = async () => {
      const result = await sql`
        SELECT
          a.*,
          u.full_name  AS author_name,
          u.avatar_url AS author_avatar,
          u.bio        AS author_bio,
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

      // Tags fetched in same round-trip batch — one extra query vs zero is
      // acceptable here; tags are tiny and rarely change
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

    // Increment view count in the background — never blocks or blocks cache
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
      tag_ids, cover_image, status,
      is_featured, is_breaking, scheduled_at,
      meta_title, meta_description,
    } = req.body

    const bodyText    = body ? stripHtml(body) : article.body_text
    const readingTime = body ? calculateReadingTime(bodyText) : article.reading_time
    const publishedAt = status === 'published' && !article.published_at
      ? new Date()
      : article.published_at

    const [updated] = await sql`
      UPDATE articles SET
        title            = COALESCE(${title            || null}, title),
        subtitle         = COALESCE(${subtitle         || null}, subtitle),
        body             = COALESCE(${body             || null}, body),
        body_text        = COALESCE(${bodyText         || null}, body_text),
        excerpt          = COALESCE(${excerpt          || null}, excerpt),
        cover_image      = COALESCE(${cover_image      || null}, cover_image),
        category_id      = COALESCE(${category_id      || null}, category_id),
        status           = COALESCE(${status           || null}, status),
        is_featured      = COALESCE(${is_featured      ?? null}, is_featured),
        is_breaking      = COALESCE(${is_breaking      ?? null}, is_breaking),
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

    // Bust caches for this specific article and all list views
    memCache.invalidate(`article:${article.slug}`)
    memCache.invalidate('articles:')
    memCache.invalidate('stats:')
    if (status === 'published') {
      memCache.invalidate('trending:')
      scheduleAiProcessing(id, bodyText, tag_ids, title || article.title)
    }

    return res.status(200).json({ success: true, message: 'Article updated', data: updated })

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

    return res.status(200).json({ success: true, message: 'Article deleted' })

  } catch (err) { next(err) }
}

// ── getTrendingArticles ───────────────────────────────────────────────────────
// This is the most expensive query — full table scan with GROUP BY + scoring.
// Cached at 5 min on the backend and 2 min on the frontend.
// Two separate consumers (BreakingBar + TrendingPage) share the same cache
// entry — effectively one DB hit per 5 minutes regardless of traffic.

export const getTrendingArticles = async (req, res, next) => {
  try {
    const days  = Math.min(parseInt(req.query.days ?? '7'),  3650)
    const limit = Math.min(parseInt(req.query.limit ?? '10'), 50)

    const cacheKey = `trending:${days}:${limit}`

    const articles = await memCache.wrap(
      cacheKey,
      () => sql`
        SELECT
          a.id, a.title, a.slug, a.cover_image, a.excerpt,
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
// The original used ts_stat() which re-executes the tsvector query at planning
// time — very expensive.  Replaced with a simple same-category recency query
// which is orders of magnitude cheaper and still relevant.

export const getRelatedArticles = async (req, res, next) => {
  try {
    const { id }   = req.params
    const cacheKey = `related:${id}`

    const articles = await memCache.wrap(
      cacheKey,
      async () => {
        const [base] = await sql`
          SELECT category_id FROM articles WHERE id = ${id}
        `
        if (!base) return []

        return sql`
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
      },
      TTL.DETAIL,   // related articles don't change often
    )

    res.json({ success: true, data: articles })

  } catch (err) { next(err) }
}