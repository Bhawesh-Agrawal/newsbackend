import sql from '../config/database.js';
import { parsePagination } from '../utils/helpers.js';
import { extractArticle } from '../services/articleExtract.services.js';
import { generateShortStory } from '../services/storyGenerator.services.js';

// ── POST /admin/short-stories — submit URL, run full pipeline ────

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

    // Extraction succeeded — update row with extracted data
    await sql`
      UPDATE article_stories SET
        title                 = ${extracted.title},
        author                = ${extracted.author},
        published_at          = ${extracted.publishedAt},
        raw_extracted_text    = ${extracted.rawExtractedText},
        hero_image_url        = ${extracted.heroImageUrl},
        additional_image_urls = ${extracted.additionalImageUrls ? JSON.stringify(extracted.additionalImageUrls) : null}::jsonb,
        extraction_method_used = ${extracted.extractionMethodUsed},
        extraction_status     = 'success'
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

// ── GET /admin/short-stories — list pending review ───────────────

export const getShortStories = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = req.query.status?.trim() || 'pending_review';

    const rows = await sql`
      SELECT
        id, source_url, source_domain, title, author, published_at,
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

// ── PATCH /admin/short-stories/:id/review — approve/reject ───────

export const reviewShortStory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { admin_status, admin_notes } = req.body;

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
      return res.status(404).json({ success: false, message: 'Short story not found' });
    }

    res.json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
};

// ── GET /short-stories (public) — approved only ──────────────────

export const getPublicShortStories = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const days = req.query.days ? Math.min(365, Math.max(1, parseInt(req.query.days))) : null;
    const excludeIds = req.query.exclude
      ? req.query.exclude.split(',').filter(Boolean)
      : [];

    const daysCondition = days ? sql`AND created_at >= NOW() - (${days} || ' days')::INTERVAL` : sql``;
    const excludeCondition = excludeIds.length > 0 ? sql`AND id != ALL(${excludeIds})` : sql``;

    const rows = await sql`
      SELECT
        id, title, author, short_story_content, hero_image_url,
        source_domain, created_at
      FROM article_stories
      WHERE admin_status = 'approved'
        ${daysCondition}
        ${excludeCondition}
      ORDER BY created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM article_stories
      WHERE admin_status = 'approved'
        ${daysCondition}
        ${excludeCondition}
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

// ── POST /admin/short-stories/:id/retry — re-run pipeline ────────

export const retryShortStory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [row] = await sql`
      SELECT * FROM article_stories WHERE id = ${id}
    `;
    if (!row) {
      return res.status(404).json({ success: false, message: 'Short story not found' });
    }

    if (row.extraction_status !== 'failed' && row.extraction_status !== 'partial') {
      return res.status(400).json({
        success: false,
        message: 'Can only retry stories with "failed" or "partial" extraction status',
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
        failure_reason        = NULL
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

// ── PATCH /admin/short-stories/:id — edit content fields ─────────

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
      SELECT id FROM article_stories WHERE id = ${id}
    `;
    if (!row) {
      return res.status(404).json({ success: false, message: 'Short story not found' });
    }

    const [updated] = await sql`
      UPDATE article_stories SET
        title              = COALESCE(${title || null}, title),
        author             = COALESCE(${author || null}, author),
        short_story_content = COALESCE(${short_story_content || null}, short_story_content),
        hero_image_url     = COALESCE(${hero_image_url || null}, hero_image_url)
      WHERE id = ${id}
      RETURNING *
    `;

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /admin/short-stories/:id — hard delete ────────────────

export const deleteShortStory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [row] = await sql`
      DELETE FROM article_stories WHERE id = ${id}
      RETURNING id
    `;

    if (!row) {
      return res.status(404).json({ success: false, message: 'Short story not found' });
    }

    res.json({ success: true, message: 'Short story deleted' });
  } catch (err) {
    next(err);
  }
};
