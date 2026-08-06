import sql from '../config/database.js';
import { parsePagination, generateSlug } from '../utils/helpers.js';
import { extractArticle } from '../services/articleExtract.services.js';
import { generateShortStory } from '../services/storyGenerator.services.js';

// ── Helper: generate unique slug from title ────────────────────────

async function createUniqueSlug(title) {
  const baseSlug = generateSlug(title);
  if (!baseSlug) return `story-${Date.now()}`;

  const existing = await sql`SELECT id FROM article_stories WHERE slug = ${baseSlug}`;
  if (existing.length > 0) {
    return `${baseSlug}-${Date.now()}`;
  }
  return baseSlug;
}

// ── POST /admin/mango-bites — submit URL, run full pipeline ─────

export const submitShortStory = async (req, res, next) => {
  try {
    const { source_url } = req.body;
    const domain = new URL(source_url).hostname.replace(/^www\./, '');

    // Check for duplicate
    const existing = await sql`
      SELECT id, admin_status FROM article_stories
      WHERE source_url = ${source_url}
    `;
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This URL has already been submitted',
        data: { id: existing[0].id, admin_status: existing[0].admin_status },
      });
    }

    // Insert placeholder row
    const [row] = await sql`
      INSERT INTO article_stories (source_url, source_domain, extraction_status, admin_status)
      VALUES (${source_url}, ${domain}, 'pending', 'pending_review')
      RETURNING *
    `;

    // Run extraction pipeline
    const extracted = await extractArticle(source_url);

    if (extracted.extractionStatus !== 'success') {
      await sql`
        UPDATE article_stories SET
          extraction_status     = ${extracted.extractionStatus},
          failure_reason        = ${extracted.failureReason},
          extraction_method_used = ${extracted.extractionMethodUsed}
        WHERE id = ${row.id}
        RETURNING *
      `;
      const updated = await sql`SELECT * FROM article_stories WHERE id = ${row.id}`;
      return res.status(200).json({
        success: true,
        message: `Extraction ${extracted.extractionStatus}: ${extracted.failureReason}`,
        data: updated[0],
      });
    }

    // Generate slug from extracted title
    const slug = await createUniqueSlug(extracted.title);

    // Extraction succeeded — update row with extracted data + slug
    await sql`
      UPDATE article_stories SET
        title                 = ${extracted.title},
        author                = ${extracted.author},
        published_at          = ${extracted.publishedAt},
        raw_extracted_text    = ${extracted.rawExtractedText},
        hero_image_url        = ${extracted.heroImageUrl},
        additional_image_urls = ${extracted.additionalImageUrls ? JSON.stringify(extracted.additionalImageUrls) : null}::jsonb,
        extraction_method_used = ${extracted.extractionMethodUsed},
        extraction_status     = 'success',
        slug                  = ${slug}
      WHERE id = ${row.id}
    `;

    // Generate short story
    const story = await generateShortStory(
      extracted.rawExtractedText,
      extracted.title,
      extracted.author,
    );

    if (story.shortStoryContent) {
      await sql`
        UPDATE article_stories SET
          short_story_content = ${story.shortStoryContent},
          ai_model_used       = ${story.aiModelUsed}
        WHERE id = ${row.id}
      `;
    } else {
      await sql`
        UPDATE article_stories SET
          extraction_status = 'partial',
          failure_reason    = 'story_generation_failed'
        WHERE id = ${row.id}
      `;
    }

    const final = await sql`SELECT * FROM article_stories WHERE id = ${row.id}`;
    res.status(201).json({ success: true, data: final[0] });
  } catch (err) {
    next(err);
  }
};

// ── GET /admin/mango-bites — list pending review ────────────────

export const getShortStories = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = req.query.status?.trim() || 'pending_review';

    const rows = await sql`
      SELECT
        id, slug, source_url, source_domain, title, author, published_at,
        hero_image_url, short_story_content, extraction_method_used,
        extraction_status, failure_reason, ai_model_used,
        admin_status, admin_notes, reviewed_by, reviewed_at,
        created_at, updated_at
      FROM article_stories
      WHERE admin_status = ${status}
      ORDER BY created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM article_stories
      WHERE admin_status = ${status}
    `;

    res.json({
      success: true,
      data: rows,
      total: parseInt(count, 10),
      pagination: {
        page,
        limit,
        hasNextPage: rows.length === limit,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/mango-bites/:id/review — approve/reject ─────────

export const reviewShortStory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { admin_status, admin_notes } = req.body;

    // If approving and story has no slug yet, generate one
    if (admin_status === 'approved') {
      const [story] = await sql`SELECT id, title, slug FROM article_stories WHERE id = ${id}`;
      if (story && !story.slug && story.title) {
        const slug = await createUniqueSlug(story.title);
        await sql`UPDATE article_stories SET slug = ${slug} WHERE id = ${id}`;
      }
    }

    const [row] = await sql`
      UPDATE article_stories SET
        admin_status = ${admin_status},
        admin_notes  = ${admin_notes || null},
        reviewed_by  = ${req.user.id},
        reviewed_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (!row) {
      return res.status(404).json({ success: false, message: 'Mango Bite not found' });
    }

    res.json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
};

// ── GET /mango-bites (public) — approved only ───────────────────

export const getPublicShortStories = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const days = req.query.days ? Math.min(365, Math.max(1, parseInt(req.query.days))) : null;
    const excludeIds = req.query.exclude
      ? req.query.exclude.split(',').filter(Boolean)
      : [];
    const search = req.query.search?.trim() || null;

    const daysCondition = days ? sql`AND created_at >= NOW() - (${days} || ' days')::INTERVAL` : sql``;
    const excludeCondition = excludeIds.length > 0 ? sql`AND id != ALL(${excludeIds})` : sql``;
    const searchCondition = search
      ? sql`AND (title ILIKE ${'%' + search + '%'} OR short_story_content ILIKE ${'%' + search + '%'})`
      : sql``;

    const rows = await sql`
      SELECT
        id, slug, title, author, short_story_content, hero_image_url,
        source_domain, created_at
      FROM article_stories
      WHERE admin_status = 'approved'
        ${daysCondition}
        ${excludeCondition}
        ${searchCondition}
      ORDER BY created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM article_stories
      WHERE admin_status = 'approved'
        ${daysCondition}
        ${excludeCondition}
        ${searchCondition}
    `;

    res.json({
      success: true,
      data: rows,
      total: parseInt(count, 10),
      pagination: {
        page,
        limit,
        hasNextPage: rows.length === limit,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /mango-bites/:slug (public) — single Mango Bite by slug ─

export const getPublicShortStoryBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const [row] = await sql`
      SELECT
        id, slug, title, author, short_story_content, hero_image_url,
        source_domain, source_url, created_at, updated_at
      FROM article_stories
      WHERE slug = ${slug}
        AND admin_status = 'approved'
    `;

    if (!row) {
      return res.status(404).json({ success: false, message: 'Mango Bite not found' });
    }

    res.json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
};

// ── GET /mango-bites-sitemap (public) — sitemap data ─────────────

export const getShortStoriesSitemap = async (req, res, next) => {
  try {
    const rows = await sql`
      SELECT slug, created_at, updated_at
      FROM article_stories
      WHERE admin_status = 'approved'
        AND slug IS NOT NULL
        AND created_at >= NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
    `;

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /admin/mango-bites/:id/retry — re-run pipeline ──────────

export const retryShortStory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [row] = await sql`
      SELECT * FROM article_stories WHERE id = ${id}
    `;
    if (!row) {
      return res.status(404).json({ success: false, message: 'Mango Bite not found' });
    }

    if (row.extraction_status !== 'failed' && row.extraction_status !== 'partial') {
      return res.status(400).json({
        success: false,
        message: 'Can only retry Mango Bites with "failed" or "partial" extraction status',
      });
    }

    // Reset status
    await sql`
      UPDATE article_stories SET
        extraction_status = 'pending',
        failure_reason    = NULL
      WHERE id = ${id}
    `;

    // Re-run extraction
    const extracted = await extractArticle(row.source_url);

    if (extracted.extractionStatus !== 'success') {
      await sql`
        UPDATE article_stories SET
          extraction_status      = ${extracted.extractionStatus},
          failure_reason         = ${extracted.failureReason},
          extraction_method_used = ${extracted.extractionMethodUsed}
        WHERE id = ${id}
      `;
      const updated = await sql`SELECT * FROM article_stories WHERE id = ${id}`;
      return res.status(200).json({
        success: true,
        message: `Extraction ${extracted.extractionStatus}: ${extracted.failureReason}`,
        data: updated[0],
      });
    }

    // Generate slug if missing
    let slug = row.slug;
    if (!slug) {
      slug = await createUniqueSlug(extracted.title);
    }

    // Update with extracted data
    await sql`
      UPDATE article_stories SET
        title                 = ${extracted.title},
        author                = ${extracted.author},
        published_at          = ${extracted.publishedAt},
        raw_extracted_text    = ${extracted.rawExtractedText},
        hero_image_url        = ${extracted.heroImageUrl},
        additional_image_urls = ${extracted.additionalImageUrls ? JSON.stringify(extracted.additionalImageUrls) : null}::jsonb,
        extraction_method_used = ${extracted.extractionMethodUsed},
        extraction_status     = 'success',
        failure_reason        = NULL,
        slug                  = ${slug}
      WHERE id = ${id}
    `;

    // Generate story
    const story = await generateShortStory(
      extracted.rawExtractedText,
      extracted.title,
      extracted.author,
    );

    if (story.shortStoryContent) {
      await sql`
        UPDATE article_stories SET
          short_story_content = ${story.shortStoryContent},
          ai_model_used       = ${story.aiModelUsed}
        WHERE id = ${id}
      `;
    } else {
      await sql`
        UPDATE article_stories SET
          extraction_status = 'partial',
          failure_reason    = 'story_generation_failed'
        WHERE id = ${id}
      `;
    }

    const final = await sql`SELECT * FROM article_stories WHERE id = ${id}`;
    res.json({ success: true, data: final[0] });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /admin/mango-bites/:id — edit content fields ───────────

export const editShortStory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, author, short_story_content, hero_image_url } = req.body;

    // Check at least one field provided
    if (!title && !author && !short_story_content && !hero_image_url) {
      return res.status(400).json({
        success: false,
        message: 'At least one editable field must be provided',
      });
    }

    const [row] = await sql`
      SELECT id, slug FROM article_stories WHERE id = ${id}
    `;
    if (!row) {
      return res.status(404).json({ success: false, message: 'Mango Bite not found' });
    }

    // Regenerate slug if title is being changed
    let slug = row.slug;
    if (title) {
      slug = await createUniqueSlug(title);
    }

    const [updated] = await sql`
      UPDATE article_stories SET
        title              = COALESCE(${title || null}, title),
        author             = COALESCE(${author || null}, author),
        short_story_content = COALESCE(${short_story_content || null}, short_story_content),
        hero_image_url     = COALESCE(${hero_image_url || null}, hero_image_url),
        slug               = ${slug}
      WHERE id = ${id}
      RETURNING *
    `;

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /admin/mango-bites/:id — hard delete ──────────────────

export const deleteShortStory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [row] = await sql`
      DELETE FROM article_stories WHERE id = ${id}
      RETURNING id
    `;

    if (!row) {
      return res.status(404).json({ success: false, message: 'Mango Bite not found' });
    }

    res.json({ success: true, message: 'Mango Bite deleted' });
  } catch (err) {
    next(err);
  }
};
