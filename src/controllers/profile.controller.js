/**
 * profile.controller.js
 *
 * Handles:
 *  PATCH /auth/me          → updateProfile (name, display_name, bio)
 *  POST  /auth/me/avatar   → updateAvatar  (file upload via multer)
 */

import sql from '../config/database.js';

// ══════════════════════════════════════════════════════════════
//  UPDATE PROFILE
//  Accepts: full_name, display_name, bio
//  All fields are optional — only sent fields are updated.
//  Bio can be explicitly cleared by sending bio: ""
// ══════════════════════════════════════════════════════════════
export const updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { full_name, display_name, bio } = req.body;

    // Build a whitelist of fields the caller actually sent
    const updates = {};
    if (full_name    !== undefined) updates.full_name    = full_name.trim();
    if (display_name !== undefined) updates.display_name = display_name.trim();
    // bio can be an empty string (clearing it) — that's valid
    if (bio !== undefined) updates.bio = bio.trim().slice(0, 500);

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
    // We use individual CASE expressions so we can:
    //   • skip fields not in the request  (use existing DB value)
    //   • allow clearing bio to ""
    //
    // COALESCE would swallow empty-string — we use a flag instead.
    const hasName        = updates.full_name    !== undefined;
    const hasDisplayName = updates.display_name !== undefined;
    const hasBio         = updates.bio          !== undefined;

    const [updated] = await sql`
      UPDATE users SET
        full_name    = CASE WHEN ${hasName}::boolean
                            THEN ${updates.full_name    ?? ''}
                            ELSE full_name    END,
        display_name = CASE WHEN ${hasDisplayName}::boolean
                            THEN ${updates.display_name ?? ''}
                            ELSE display_name END,
        bio          = CASE WHEN ${hasBio}::boolean
                            THEN ${updates.bio          ?? ''}
                            ELSE bio          END,
        updated_at   = NOW()
      WHERE id = ${userId}
      RETURNING
        id, email, full_name, display_name, bio,
        avatar_url, role, status, email_verified,
        auth_provider, created_at, last_login_at
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

    return res.status(200).json({
      success: true,
      message: 'Avatar updated',
      data:    { avatar_url: updated.avatar_url },
    });

  } catch (err) {
    next(err);
  }
};