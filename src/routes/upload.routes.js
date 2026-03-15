import { Router }             from 'express';
import { uploadArticleCover, uploadAvatar } from '../services/cloudinary.service.js';
import { authenticate }       from '../middleware/auth.middleware.js';
import { isAuthor }           from '../middleware/auth.middleware.js';

const router = Router();

// Upload article cover image
router.post('/cover',
  authenticate,
  isAuthor,
  (req, res, next) => {
    uploadArticleCover(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || 'Upload failed',
        });
      }
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file provided',
        });
      }
      res.status(200).json({
        success: true,
        data: {
          url:       req.file.path,       // Cloudinary URL
          public_id: req.file.filename,   // For deletion later
        },
      });
    });
  }
);

// Upload user avatar
router.post('/avatar',
  authenticate,
  (req, res, next) => {
    uploadAvatar(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || 'Upload failed',
        });
      }
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file provided',
        });
      }

      // Save URL to user record immediately
      const { sql } = await import('../config/database.js');
      await sql`
        UPDATE users SET avatar_url = ${req.file.path}
        WHERE id = ${req.user.id}
      `;

      res.status(200).json({
        success: true,
        data: { url: req.file.path },
      });
    });
  }
);

export default router;