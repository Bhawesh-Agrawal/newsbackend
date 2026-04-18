import sql        from '../config/database.js';
import { parsePagination } from '../utils/helpers.js';
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

    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role);

    // Authors can only see their own articles.
    // Editors can optionally filter by a specific author.
    const filterAuthor = isEditorPlus ? author_id : req.user.id;

    const scopeKey = isEditorPlus ? `ed:${author_id}` : `au:${req.user.id}`;
    const cacheKey = `admin_articles:${page}:${limit}:${status}:${scopeKey}`;

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