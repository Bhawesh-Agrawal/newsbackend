/**
 * profile.controller.js
 *
 * Handles:
 *  PATCH /auth/me          → updateProfile (name, display_name, bio, social links)
 *  POST  /auth/me/avatar   → updateAvatar  (file upload via multer)
 *  GET   /profiles/:userId → getPublicProfile (public user profile)
 *  GET   /profiles/:userId/articles → getUserArticles (articles by user)
 */

import sql from '../config/database.js';
import { memCache } from '../utils/memCache.js';
import { parsePagination } from '../utils/helpers.js';

// ══════════════════════════════════════════════════════════════
//  UPDATE PROFILE
//  Accepts: full_name, display_name, bio, instagram_profile,
//           twitter_profile, linkedin_profile
//  All fields are optional — only sent fields are updated.
//  Bio can be explicitly cleared by sending bio: ""
// ══════════════════════════════════════════════════════════════
export const updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      full_name,
      display_name,
      bio,
      instagram_profile,
      twitter_profile,
      linkedin_profile,
    } = req.body;

    // Build a whitelist of fields the caller actually sent
    const updates = {};
    if (full_name        !== undefined) updates.full_name        = full_name.trim();
    if (display_name     !== undefined) updates.display_name     = display_name.trim();
    if (bio              !== undefined) updates.bio              = bio.trim().slice(0, 500);
    if (instagram_profile !== undefined) updates.instagram_profile = instagram_profile.trim().slice(0, 255);
    if (twitter_profile   !== undefined) updates.twitter_profile   = twitter_profile.trim().slice(0, 255);
    if (linkedin_profile  !== undefined) updates.linkedin_profile  = linkedin_profile.trim().slice(0, 255);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields provided to update',
      });
    }

    if (updates.full_name !== undefined && updates.full_name.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Name must be at least 2 characters',
      });
    }

    // ── Dynamic SET clause ────────────────────────────────────
    const hasName        = updates.full_name !== undefined;
    const hasDisplayName = updates.display_name !== undefined;
    const hasBio         = updates.bio !== undefined;
    const hasInstagram   = updates.instagram_profile !== undefined;
    const hasTwitter     = updates.twitter_profile !== undefined;
    const hasLinkedin    = updates.linkedin_profile !== undefined;

    const [updated] = await sql`
      UPDATE users SET
        full_name        = CASE WHEN ${hasName}::boolean
                                THEN ${updates.full_name ?? ''}
                                ELSE full_name END,
        display_name     = CASE WHEN ${hasDisplayName}::boolean
                                THEN ${updates.display_name ?? ''}
                                ELSE display_name END,
        bio              = CASE WHEN ${hasBio}::boolean
                                THEN ${updates.bio ?? ''}
                                ELSE bio END,
        instagram_profile = CASE WHEN ${hasInstagram}::boolean
                                THEN ${updates.instagram_profile ?? ''}
                                ELSE instagram_profile END,
        twitter_profile   = CASE WHEN ${hasTwitter}::boolean
                                THEN ${updates.twitter_profile ?? ''}
                                ELSE twitter_profile END,
        linkedin_profile  = CASE WHEN ${hasLinkedin}::boolean
                                THEN ${updates.linkedin_profile ?? ''}
                                ELSE linkedin_profile END,
        updated_at       = NOW()
      WHERE id = ${userId}
      RETURNING
        id, email, full_name, display_name, bio,
        avatar_url, role, status, email_verified,
        auth_provider, created_at, last_login_at,
        instagram_profile, twitter_profile, linkedin_profile
    `;

    return res.status(200).json({
      success: true,
      message: 'Profile updated',
      data:    updated,
    });

  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════
//  UPDATE AVATAR
//  Called after multer/Cloudinary middleware has processed
//  the file. req.file.path is the Cloudinary URL.
//
//  Works for both:
//   • Regular file uploads (jpg/png/webp)
//   • DiceBear SVG presets (frontend fetches SVG → sends as blob)
// ══════════════════════════════════════════════════════════════
export const updateAvatar = async (req, res, next) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    // multer-storage-cloudinary sets req.file.path to the CDN URL
    const avatarUrl = req.file.path;

    const [updated] = await sql`
      UPDATE users
      SET    avatar_url = ${avatarUrl},
             updated_at = NOW()
      WHERE  id         = ${userId}
      RETURNING id, avatar_url
    `;

    memCache.invalidate('article:');
    memCache.invalidate('articles:');

    return res.status(200).json({
      success: true,
      message: 'Avatar updated',
      data:    { avatar_url: updated.avatar_url },
    });

  } catch (err) {
    next(err);
  }
};

export const updateAvatarUrl = async (req, res, next) => {
  try {
    const { avatar_url } = req.body

    if (!avatar_url || typeof avatar_url !== 'string') {
      return res.status(400).json({ success: false, message: 'avatar_url is required' })
    }

    // Basic sanity check — only allow known safe origins
    const allowed = ['https://api.dicebear.com', 'https://res.cloudinary.com']
    if (!allowed.some(origin => avatar_url.startsWith(origin))) {
      return res.status(400).json({ success: false, message: 'Invalid avatar URL' })
    }

    const [updated] = await sql`
      UPDATE users SET avatar_url = ${avatar_url}
      WHERE id = ${req.user.id}
      RETURNING avatar_url
    `

    memCache.invalidate('article:');
    memCache.invalidate('articles:');

    return res.status(200).json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

// ══════════════════════════════════════════════════════════════
//  GET PUBLIC PROFILE
//  Returns non-sensitive user data: name, bio, avatar, social links
// ══════════════════════════════════════════════════════════════
export const getPublicProfile = async (req, res, next) => {
  try {
    const { userId } = req.params

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      })
    }

    const [user] = await sql`
      SELECT
        id,
        full_name,
        display_name,
        avatar_url,
        bio,
        email,
        instagram_profile,
        twitter_profile,
        linkedin_profile,
        created_at,
        role
      FROM users
      WHERE id = ${userId}
        AND status = 'active'
    `

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      })
    }

    return res.status(200).json({
      success: true,
      data: user,
    })
  } catch (err) {
    next(err)
  }
}

// ══════════════════════════════════════════════════════════════
//  GET USER ARTICLES
//  Returns published articles by a user, with pagination
// ══════════════════════════════════════════════════════════════
export const getUserArticles = async (req, res, next) => {
  try {
    const { userId } = req.params
    const { page, limit, offset } = parsePagination(req.query)

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      })
    }

    // Get total count
    const [{ count }] = await sql`
      SELECT COUNT(*) FROM articles
      WHERE author_id = ${userId}
        AND status = 'published'
    `

    const total = parseInt(count)
    const totalPages = Math.ceil(total / limit)

    // Get articles
    const articles = await sql`
      SELECT
        a.id,
        a.slug,
        a.title,
        a.subtitle,
        a.excerpt,
        a.cover_image,
        a.author_id,
        u.full_name as author_name,
        a.category_id,
        c.name as category_name,
        c.slug as category_slug,
        c.color as category_color,
        a.reading_time,
        a.is_breaking,
        a.is_featured,
        a.status,
        a.published_at,
        a.created_at,
        a.view_count,
        a.like_count,
        a.comment_count,
        a.cover_crop
      FROM articles a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.author_id = ${userId}
        AND a.status = 'published'
      ORDER BY a.published_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    return res.status(200).json({
      success: true,
      data: articles,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: offset + articles.length < total,
        hasPrevPage: page > 1,
      },
    })
  } catch (err) {
    next(err)
  }
}