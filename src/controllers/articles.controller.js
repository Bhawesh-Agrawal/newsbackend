import sql from "../config/database.js";
import {
    generateSlug,
    calculateReadingTime,
    stripHtml,
    generateExcerpt,
    parsePagination
} from "../utils/helpers.js";

import { generateSummary, generateTags } from '../services/ai.services.js';

export const createArticle = async (req, res, next) => {
    try{
        const {
          title,
          subtitle,
          body,
          excerpt,
          category_id,
          tag_ids = [],
          cover_image,
          status = 'draft',
          is_featured = false,
          is_breaking = false,
          scheduled_at,
          meta_title,
          meta_description,
        } = req.body;

        const baseSlug = generateSlug(title);

        const existing = await sql`
        SELECT id FROM articles WHERE slug = ${baseSlug}
        `;

        const slug = existing.length > 0 ? `${baseSlug}-- ${Date.now()}` : baseSlug;

        const bodyText = stripHtml(body);
        const finalExcerpt = excerpt || generateExcerpt(bodyText);
        const reading_time = calculateReadingTime(bodyText);
        const publishedAt = status === 'published' ? new Date() : null;

        const result = await sql`
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
        )
        RETURNING *
        `;

        if (status === 'published') {
          (async () => {
            try {
              const summary = await generateSummary(body_text);

              if (summary) {
                await sql`
                  UPDATE articles
                  SET ai_summary = ${summary}
                  WHERE id = ${articleId}
                `;
              }

              // Auto-suggest tags if none were provided
              if (!tag_ids || tag_ids.length === 0) {
                const suggestedTags = await generateTags(title, body_text);

                for (const tagName of suggestedTags) {
                  const slug = generateSlug(tagName);

                  // Insert tag if it doesn't exist
                  const tag = await sql`
                    INSERT INTO tags (name, slug)
                    VALUES (${tagName}, ${slug})
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                  `;

                  await sql`
                    INSERT INTO article_tags (article_id, tag_id)
                    VALUES (${articleId}, ${tag[0].id})
                    ON CONFLICT DO NOTHING
                  `;
                }
              }
            } catch (err) {
              console.error('[AI] Post-publish processing failed:', err.message);
            }
          })();
        }

        const article = result[0];

        if (tag_ids.length > 0) {
            for (const tagId of tag_ids) {
                await sql`
                    INSERT INTO article_tags (article_id, tag_id)
                    VALUES (${article.id}, ${tagId})
                    ON CONFLICT DO NOTHING
                `;
            }
        }

        return res.status(201).json({
            success : true,
            message : "Article created successfully",
            data : article,
        });

    }catch(err){
        next(err);
    }
};


export const getArticles = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const {
      category = null,
      search = null,
      featured = null,
      status = 'published'
    } = req.query;

    // Non-staff can only see published articles
    const allowedStatuses = ['super_admin', 'editor', 'author'];
    const finalStatus = allowedStatuses.includes(req.user?.role)
      ? status
      : 'published';

    const articles = await sql`
      SELECT
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
      FROM articles a
      JOIN users u      ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.status = ${finalStatus}
        AND (${category}::text IS NULL OR c.slug = ${category})
        AND (${featured}::text IS NULL OR a.is_featured = ${featured === 'true'})
        AND (${search}::text IS NULL
             OR a.search_vector @@ plainto_tsquery('english', ${search}))
      ORDER BY a.published_at DESC NULLS LAST
      LIMIT  ${limit}::int
      OFFSET ${offset}::int
    `;

    const countResult = await sql`
      SELECT COUNT(*) AS total
      FROM articles a
      JOIN categories c ON a.category_id = c.id
      WHERE a.status = ${finalStatus}
        AND (${category}::text IS NULL OR c.slug = ${category})
        AND (${search}::text IS NULL
             OR a.search_vector @@ plainto_tsquery('english', ${search}))
    `;

    const total = parseInt(countResult[0].total);

    return res.status(200).json({
      success: true,
      data: articles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    });

  } catch (err) {
    next(err);
  }
};


export const getArticleBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

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
      JOIN users u      ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.slug = ${slug}
        AND a.status = 'published'
    `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
      });
    }

    const article = result[0];

    // Get tags separately
    const tags = await sql`
      SELECT t.id, t.name, t.slug
      FROM tags t
      JOIN article_tags at ON t.id = at.tag_id
      WHERE at.article_id = ${article.id}
    `;

    article.tags = tags;

    // Increment view count — fire and forget
    sql`
      UPDATE articles SET view_count = view_count + 1
      WHERE id = ${article.id}
    `.catch(() => {});

    return res.status(200).json({
      success: true,
      data: article,
    });

  } catch (err) {
    next(err);
  }
};

export const updateArticle = async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. Fetch existing article
    const existing = await sql`
      SELECT * FROM articles WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    const article = existing[0];

    // 2. Permission check — author can only edit their own
    const isOwner = article.author_id === req.user.id;
    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role);

    if (!isOwner && !isEditorPlus) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const {
      title, subtitle, body, excerpt, category_id,
      tag_ids, cover_image, status,
      is_featured, is_breaking, scheduled_at,
      meta_title, meta_description,
    } = req.body;

    const bodyText = body ? stripHtml(body) : article.body_text;
    const readingTime = body ? calculateReadingTime(bodyText) : article.reading_time;

    // Only set published_at the first time it goes live
    const publishedAt = status === 'published' && !article.published_at
      ? new Date()
      : article.published_at;

    const updated = await sql`
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
      RETURNING *
    `;

    if (status === 'published') {
        (async () => {
          try {
            const summary = await generateSummary(body_text);

            if (summary) {
              await sql`
                UPDATE articles
                SET ai_summary = ${summary}
                WHERE id = ${articleId}
              `;
            }

            // Auto-suggest tags if none were provided
            if (!tag_ids || tag_ids.length === 0) {
              const suggestedTags = await generateTags(title, body_text);

              for (const tagName of suggestedTags) {
                const slug = generateSlug(tagName);

                // Insert tag if it doesn't exist
                const tag = await sql`
                  INSERT INTO tags (name, slug)
                  VALUES (${tagName}, ${slug})
                  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                  RETURNING id
                `;

                await sql`
                  INSERT INTO article_tags (article_id, tag_id)
                  VALUES (${articleId}, ${tag[0].id})
                  ON CONFLICT DO NOTHING
                `;
              }
            }
          } catch (err) {
            console.error('[AI] Post-publish processing failed:', err.message);
          }
        })();
      }

    // Replace tags if provided
    if (tag_ids !== undefined) {
      await sql`DELETE FROM article_tags WHERE article_id = ${id}`;
      for (const tagId of tag_ids) {
        await sql`
          INSERT INTO article_tags (article_id, tag_id)
          VALUES (${id}, ${tagId})
          ON CONFLICT DO NOTHING
        `;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Article updated',
      data: updated[0],
    });

  } catch (err) {
    next(err);
  }
};

export const deleteArticle = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await sql`
      SELECT author_id FROM articles WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    const isOwner = existing[0].author_id === req.user.id;
    const isSuperAdmin = req.user.role === 'super_admin';

    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    await sql`DELETE FROM articles WHERE id = ${id}`;

    return res.status(200).json({
      success: true,
      message: 'Article deleted',
    });

  } catch (err) {
    next(err);
  }
};

export const getTrendingArticles = async (req, res, next) => {
  try {
    const { limit = 10, days = 7 } = req.query;

    const articles = await sql`
      SELECT
        a.id, a.title, a.slug, a.cover_image,
        a.view_count, a.like_count, a.comment_count,
        a.published_at, a.reading_time,
        u.full_name  AS author_name,
        c.name       AS category_name,
        c.color      AS category_color,
        (
          COUNT(av.id)          * 1.0 +
          a.like_count          * 3.0 +
          a.comment_count       * 2.0
        ) AS trend_score
      FROM articles a
      LEFT JOIN article_views av
        ON a.id = av.article_id
        AND av.created_at >= NOW() - (${parseInt(days)} || ' days')::INTERVAL
      LEFT JOIN users      u ON a.author_id   = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.status = 'published'
      GROUP BY a.id, u.id, c.id
      ORDER BY trend_score DESC
      LIMIT ${Math.min(50, parseInt(limit))}
    `;

    res.json({ success: true, data: articles });
  } catch (err) { next(err);  }
};

export const getRelatedArticles = async (req, res, next) => {
  try {
    const { id } = req.params;

    const base = await sql`
      SELECT search_vector, category_id FROM articles WHERE id = ${id}
    `;
    if (base.length === 0)
      return res.status(404).json({ success: false, message: 'Article not found' });

    const related = await sql`
      SELECT
        a.id, a.title, a.slug, a.cover_image,
        a.reading_time, a.published_at,
        u.full_name AS author_name,
        c.name      AS category_name,
        c.color     AS category_color,
        ts_rank(a.search_vector, to_tsquery('english',
          array_to_string(
            ARRAY(SELECT word FROM ts_stat(
              'SELECT search_vector FROM articles WHERE id = ' || quote_literal(${id})
            ) ORDER BY ndoc DESC LIMIT 5),
            ' | '
          )
        )) AS relevance
      FROM articles a
      JOIN users      u ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE a.status    = 'published'
        AND a.id       != ${id}
        AND a.category_id = ${base[0].category_id}
      ORDER BY relevance DESC, a.published_at DESC
      LIMIT 6
    `;

    res.json({ success: true, data: related });
  } catch (err) { next(err); }
};