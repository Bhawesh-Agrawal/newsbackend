import sql        from '../config/database.js';
import { parsePagination, generateSlug } from '../utils/helpers.js';
import { memCache, TTL  } from '../utils/memCache.js';

const ADMIN_TTL = 60 * 1_000;

const ilike = (col, val) =>
  val ? sql`AND ${sql(col)} ILIKE ${'%' + val + '%'}` : sql``

// Returns a sql fragment for an optional exact-match filter on an enum col
const eqEnum = (col, val) =>
  val ? sql`AND ${sql(col)} = ${val}` : sql``

// Returns a sql fragment for an optional UUID exact-match
const eqUuid = (col, val) =>
  val ? sql`AND ${sql(col)} = ${val}::uuid` : sql``

// ── getUsers ──────────────────────────────────────────────────────────────────
export const getUsers = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    // Sanitise — never pass empty string to the query
    const role   = req.query.role?.trim()   || null;
    const status = req.query.status?.trim() || null;
    const search = req.query.search?.trim() || null;

    const cacheKey = `users:${page}:${limit}:${role}:${status}:${search}`;

    const users = await memCache.wrap(
      cacheKey,
      () => sql`
        SELECT
          id, email, full_name, role, status,
          created_at, last_login_at, login_count,
          email_verified, auth_provider, avatar_url
        FROM users
        WHERE TRUE
          ${role   ? sql`AND role   = ${role}`   : sql``}
          ${status ? sql`AND status = ${status}` : sql``}
          ${search ? sql`AND (
            full_name ILIKE ${'%' + search + '%'} OR
            email     ILIKE ${'%' + search + '%'}
          )` : sql``}
        ORDER BY created_at DESC
        LIMIT  ${limit}
        OFFSET ${offset}
      `,
      ADMIN_TTL,
    );

    // COUNT query uses the same conditional fragments
    const [{ count }] = await sql`
      SELECT COUNT(*) AS count FROM users
      WHERE TRUE
        ${role   ? sql`AND role   = ${role}`   : sql``}
        ${status ? sql`AND status = ${status}` : sql``}
        ${search ? sql`AND (
          full_name ILIKE ${'%' + search + '%'} OR
          email     ILIKE ${'%' + search + '%'}
        )` : sql``}
    `;

    return res.status(200).json({
      success: true,
      data: users,
      total: parseInt(count, 10),
      pagination: {
        page,
        limit,
        hasNextPage: users.length === limit,
        hasPrevPage: page > 1,
      },
    });

  } catch (err) {
    next(err);
  }
};

// ── updateUserRole ────────────────────────────────────────────────────────────
export const updateUserRole = async (req, res, next) => {
  try {
    const { id }   = req.params;
    const { role } = req.body;

    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role',
      });
    }

    const validRoles = ['reader', 'author', 'editor', 'super_admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    const result = await sql`
      UPDATE users SET role = ${role}
      WHERE id = ${id}::uuid
      RETURNING id, email, full_name, role
    `;

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    memCache.invalidate('users:');

    return res.status(200).json({
      success: true,
      message: `Role updated to ${role}`,
      data:    result[0],
    });

  } catch (err) {
    next(err);
  }
};

// ── updateUserStatus ──────────────────────────────────────────────────────────
export const updateUserStatus = async (req, res, next) => {
  try {
    const { id }     = req.params;
    const { status } = req.body;

    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own status',
      });
    }

    const validStatuses = ['active', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Use active or suspended',
      });
    }

    const result = await sql`
      UPDATE users SET status = ${status}
      WHERE id = ${id}::uuid
      RETURNING id, email, full_name, status
    `;

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    memCache.invalidate('users:');

    return res.status(200).json({
      success: true,
      message: status === 'suspended' ? 'User suspended' : 'User activated',
      data:    result[0],
    });

  } catch (err) {
    next(err);
  }
};

// ── getAdminArticles ──────────────────────────────────────────────────────────
export const getAdminArticles = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    // Sanitise — never pass empty string to enum or uuid columns
    const status    = req.query.status?.trim()    || null;
    const author_id = req.query.author_id?.trim() || null;
    const dateRange = req.query.date_range?.trim() || null;

    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role);

    // Authors can only see their own articles.
    // Editors can optionally filter by a specific author.
    const filterAuthor = isEditorPlus ? author_id : req.user.id;

    const scopeKey = isEditorPlus ? `ed:${author_id}` : `au:${req.user.id}`;
    const cacheKey = `admin_articles:${page}:${limit}:${status}:${dateRange}:${scopeKey}`;

    const articles = await memCache.wrap(
      cacheKey,
      () => sql`
        SELECT
          a.id, a.title, a.slug, a.status,
          a.is_featured, a.is_breaking,
          a.view_count, a.like_count, a.comment_count,
          a.published_at, a.created_at, a.updated_at,
          u.full_name  AS author_name,
          c.name       AS category_name,
          c.color      AS category_color
        FROM articles a
        JOIN users      u ON a.author_id   = u.id
        JOIN categories c ON a.category_id = c.id
        WHERE TRUE
          ${status       ? sql`AND a.status    = ${status}`             : sql``}
          ${filterAuthor ? sql`AND a.author_id = ${filterAuthor}::uuid` : sql``}
          ${dateRange === 'today'     ? sql`AND a.created_at >= now() - interval '1 day'`   : sql``}
          ${dateRange === 'this_week' ? sql`AND a.created_at >= now() - interval '7 days'`  : sql``}
          ${dateRange === 'this_month' ? sql`AND a.created_at >= now() - interval '30 days'` : sql``}
        ORDER BY a.updated_at DESC
        LIMIT  ${limit}
        OFFSET ${offset}
      `,
      ADMIN_TTL,
    );

    // Count with same filters
    const [{ count }] = await sql`
      SELECT COUNT(*) AS count
      FROM articles a
      WHERE TRUE
        ${status       ? sql`AND a.status    = ${status}`             : sql``}
        ${filterAuthor ? sql`AND a.author_id = ${filterAuthor}::uuid` : sql``}
        ${dateRange === 'today'     ? sql`AND a.created_at >= now() - interval '1 day'`   : sql``}
        ${dateRange === 'this_week' ? sql`AND a.created_at >= now() - interval '7 days'`  : sql``}
        ${dateRange === 'this_month' ? sql`AND a.created_at >= now() - interval '30 days'` : sql``}
    `;

    return res.status(200).json({
      success: true,
      data: articles,
      total: parseInt(count, 10),
      pagination: {
        page,
        limit,
        hasNextPage: articles.length === limit,
        hasPrevPage: page > 1,
      },
    });

  } catch (err) {
    next(err);
  }
};

// ── getSettings ───────────────────────────────────────────────────────────────
export const getSettings = async (req, res, next) => {
  try {
    const settings = await memCache.wrap(
      'settings:all',
      () => sql`SELECT key, value FROM site_settings ORDER BY key`,
      TTL.CATEGORIES,
    );

    const obj = Object.fromEntries(settings.map(s => [s.key, s.value]));
    return res.json({ success: true, data: obj });

  } catch (err) {
    next(err);
  }
};

// ── updateSettings ────────────────────────────────────────────────────────────
export const updateSettings = async (req, res, next) => {
  try {
    const updates = Object.entries(req.body);

    for (const [key, value] of updates) {
      await sql`
        INSERT INTO site_settings (key, value, updated_by)
        VALUES (${key}, ${String(value)}, ${req.user.id}::uuid)
        ON CONFLICT (key) DO UPDATE
        SET value      = EXCLUDED.value,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
      `;
    }

    memCache.invalidate('settings:');

    return res.json({ success: true, message: 'Settings updated' });

  } catch (err) {
    next(err);
  }
};

// ── Search articles (for pinning modal) ────────────────────────────

export const searchArticles = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const articles = await sql`
      SELECT
        a.id, a.title, a.slug, a.cover_image, a.excerpt,
        a.published_at,
        c.name  AS category_name,
        c.slug  AS category_slug,
        c.color AS category_color
      FROM articles a
      JOIN categories c ON a.category_id = c.id
      WHERE a.status = 'published'
        AND a.search_vector @@ plainto_tsquery('english', ${q})
      ORDER BY a.published_at DESC NULLS LAST
      LIMIT 20
    `;

    return res.json({ success: true, data: articles });
  } catch (err) {
    next(err);
  }
};

// ── Hero pin helpers ───────────────────────────────────────────────

function bustHomeCache() {
  memCache.invalidate('home:');
}

// ── getHeroPins ────────────────────────────────────────────────────

export const getHeroPins = async (req, res, next) => {
  try {
    const pins = await sql`
      SELECT
        hp.id, hp.position, hp.pinned_at,
        a.id AS article_id, a.title, a.slug, a.cover_image, a.excerpt,
        a.published_at,
        c.name  AS category_name,
        c.slug  AS category_slug,
        c.color AS category_color
      FROM hero_pins hp
      JOIN articles   a ON hp.article_id = a.id
      JOIN categories c ON a.category_id  = c.id
      WHERE a.status = 'published'
      ORDER BY hp.position ASC, hp.pinned_at DESC
    `;

    return res.json({ success: true, data: pins });
  } catch (err) {
    next(err);
  }
};

// ── addHeroPin ─────────────────────────────────────────────────────

export const addHeroPin = async (req, res, next) => {
  try {
    const { article_id, position } = req.body;

    if (!article_id) {
      return res.status(400).json({ success: false, message: 'article_id is required' });
    }

    // Verify article exists and is published
    const [article] = await sql`
      SELECT id, status FROM articles WHERE id = ${article_id}::uuid
    `;
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }
    if (article.status !== 'published') {
      return res.status(400).json({ success: false, message: 'Only published articles can be pinned' });
    }

    const pos = position !== undefined ? Math.max(0, parseInt(position, 10)) : 0;

    const [pin] = await sql`
      INSERT INTO hero_pins (article_id, position)
      VALUES (${article_id}::uuid, ${pos})
      ON CONFLICT (article_id) DO UPDATE SET position = ${pos}, pinned_at = NOW()
      RETURNING id, article_id, position, pinned_at
    `;

    bustHomeCache();

    return res.status(201).json({ success: true, data: pin });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }
    next(err);
  }
};

// ── reorderHeroPins ────────────────────────────────────────────────

export const reorderHeroPins = async (req, res, next) => {
  try {
    const { pins } = req.body; // [{ id, position }, ...]

    if (!Array.isArray(pins)) {
      return res.status(400).json({ success: false, message: 'pins array is required' });
    }

    for (const pin of pins) {
      if (!pin.id || pin.position === undefined) continue;
      await sql`
        UPDATE hero_pins
        SET position = ${Math.max(0, parseInt(pin.position, 10))}
        WHERE id = ${pin.id}::uuid
      `;
    }

    bustHomeCache();

    return res.json({ success: true, message: 'Hero pins reordered' });
  } catch (err) {
    next(err);
  }
};

// ── removeHeroPin ──────────────────────────────────────────────────

export const removeHeroPin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [deleted] = await sql`
      DELETE FROM hero_pins WHERE id = ${id}::uuid RETURNING id
    `;

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Pin not found' });
    }

    bustHomeCache();

    return res.json({ success: true, message: 'Hero pin removed' });
  } catch (err) {
    next(err);
  }
};

// ── getCategoryPins ────────────────────────────────────────────────

export const getCategoryPins = async (req, res, next) => {
  try {
    const pins = await sql`
      SELECT
        cp.id, cp.position, cp.pinned_at,
        cp.category_id,
        cat.name  AS category_name,
        cat.slug  AS category_slug,
        cat.color AS category_color,
        a.id AS article_id, a.title, a.slug, a.cover_image, a.excerpt,
        a.published_at
      FROM category_pins cp
      JOIN categories cat ON cp.category_id = cat.id
      JOIN articles   a   ON cp.article_id  = a.id
      WHERE a.status = 'published'
      ORDER BY cat.name ASC, cp.position ASC, cp.pinned_at DESC
    `;

    return res.json({ success: true, data: pins });
  } catch (err) {
    next(err);
  }
};

// ── addCategoryPin ─────────────────────────────────────────────────

export const addCategoryPin = async (req, res, next) => {
  try {
    const { article_id, category_id } = req.body;

    if (!article_id || !category_id) {
      return res.status(400).json({
        success: false,
        message: 'article_id and category_id are required',
      });
    }

    const [article] = await sql`
      SELECT id, status, category_id FROM articles WHERE id = ${article_id}::uuid
    `;
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }
    if (article.status !== 'published') {
      return res.status(400).json({ success: false, message: 'Only published articles can be pinned' });
    }

    const [pin] = await sql`
      INSERT INTO category_pins (article_id, category_id, position)
      VALUES (${article_id}::uuid, ${category_id}::uuid, 0)
      ON CONFLICT (article_id, category_id) DO NOTHING
      RETURNING id, article_id, category_id, position, pinned_at
    `;

    if (!pin) {
      return res.status(409).json({
        success: false,
        message: 'This article is already pinned to this category',
      });
    }

    bustHomeCache();

    return res.status(201).json({ success: true, data: pin });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ success: false, message: 'Article or category not found' });
    }
    next(err);
  }
};

// ── removeCategoryPin ──────────────────────────────────────────────

export const removeCategoryPin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [deleted] = await sql`
      DELETE FROM category_pins WHERE id = ${id}::uuid RETURNING id
    `;

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Pin not found' });
    }

    bustHomeCache();

    return res.json({ success: true, message: 'Category pin removed' });
  } catch (err) {
    next(err);
  }
};