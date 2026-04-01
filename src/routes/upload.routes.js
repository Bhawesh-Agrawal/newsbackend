/**
 * upload.routes.js
 *
 * Handles binary file uploads that are NOT tied to a user profile.
 * Currently: article cover images.
 *
 * Avatar uploads are handled in auth.routes.js (POST /auth/me/avatar)
 * because they need to update the users table immediately and are
 * always scoped to the authenticated user — no reason to separate them.
 */

import { Router }            from 'express';
import { uploadArticleCover } from '../services/cloudinary.services.js';
import { authenticate, isAuthor } from '../middleware/auth.middleware.js';

const router = Router();

// ── POST /uploads/cover ───────────────────────────────────────
// Upload an article cover image to Cloudinary.
// Returns the CDN URL + public_id (store public_id to delete later).
// Requires: authenticated + author/editor/super_admin role.
router.post('/cover',
  authenticate,
  isAuthor,
  coverUploadMiddleware,
  (req, res) => {
    res.status(200).json({
      success: true,
      data: {
        url:       req.file.path,      // Cloudinary CDN URL
        public_id: req.file.filename,  // for cloudinary.uploader.destroy()
      },
    });
  },
);

export default router;

// ── Cover upload middleware (wraps multer error handling) ─────
function coverUploadMiddleware(req, res, next) {
  uploadArticleCover(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Cover upload failed. Max 5 MB.',
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided',
      });
    }
    next();
  });
}