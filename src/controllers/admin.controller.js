import sql from '../config/database.js';
import { parsePagination } from '../utils/helpers.js';

export const getUsers = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { role, status, search } = req.query;

    const users = await sql`
      SELECT
        id, email, full_name, role, status,
        created_at, last_login_at, login_count,
        email_verified
      FROM users
      WHERE
        (${role   || null} IS NULL OR role   = ${role   || ''})
        AND (${status || null} IS NULL OR status = ${status || ''})
        AND (${search || null} IS NULL
             OR full_name ILIKE ${'%' + (search || '') + '%'}
             OR email     ILIKE ${'%' + (search || '') + '%'})
      ORDER BY created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT COUNT(*) AS total FROM users
      WHERE
        (${role   || null} IS NULL OR role   = ${role   || ''})
        AND (${status || null} IS NULL OR status = ${status || ''})
        AND (${search || null} IS NULL
             OR full_name ILIKE ${'%' + (search || '') + '%'}
             OR email     ILIKE ${'%' + (search || '') + '%'})
    `;

    return res.status(200).json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total:      parseInt(countResult[0].total),
        totalPages: Math.ceil(parseInt(countResult[0].total) / limit),
      },
    });

  } catch (err) {
    next(err);
  }
};

export const updateUserRole = async (req, res, next) => {
  try {
    const { id }   = req.params;
    const { role } = req.body;

    // Can't change your own role — prevents accidentally locking yourself out
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role',
      });
    }

    const validRoles = ['reader', 'author', 'editor', 'super_admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role',
      });
    }

    const result = await sql`
      UPDATE users SET role = ${role}
      WHERE id = ${id}
      RETURNING id, email, full_name, role
    `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Role updated to ${role}`,
      data: result[0],
    });

  } catch (err) {
    next(err);
  }
};

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
      WHERE id = ${id}
      RETURNING id, email, full_name, status
    `;

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: `User ${status === 'suspended' ? 'suspended' : 'activated'}`,
      data: result[0],
    });

  } catch (err) {
    next(err);
  }
};

export const getAdminArticles = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, author_id }   = req.query;

    // Authors only see their own articles
    // Editors and admins see everything
    const isEditorPlus = ['editor', 'super_admin'].includes(req.user.role);
    const filterAuthor = isEditorPlus
      ? (author_id || null)
      : req.user.id;

    const articles = await sql`
      SELECT
        a.id, a.title, a.slug, a.status,
        a.is_featured, a.is_breaking,
        a.view_count, a.like_count, a.comment_count,
        a.published_at, a.created_at, a.updated_at,
        u.full_name  AS author_name,
        c.name       AS category_name
      FROM articles a
      JOIN users      u ON a.author_id   = u.id
      JOIN categories c ON a.category_id = c.id
      WHERE
        (${status       || null} IS NULL OR a.status    = ${status    || ''})
        AND (${filterAuthor || null} IS NULL OR a.author_id = ${filterAuthor || ''})
      ORDER BY a.updated_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT COUNT(*) AS total FROM articles a
      WHERE
        (${status       || null} IS NULL OR a.status    = ${status    || ''})
        AND (${filterAuthor || null} IS NULL OR a.author_id = ${filterAuthor || ''})
    `;

    return res.status(200).json({
      success: true,
      data: articles,
      pagination: {
        page,
        limit,
        total:      parseInt(countResult[0].total),
        totalPages: Math.ceil(parseInt(countResult[0].total) / limit),
      },
    });

  } catch (err) {
    next(err);
  }
};