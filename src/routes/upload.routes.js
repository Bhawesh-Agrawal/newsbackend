import { Router }             from 'express';
import { uploadArticleCover } from '../services/cloudinary.services.js';
import { authenticate, isAuthor } from '../middleware/auth.middleware.js';

const router = Router();


function coverUploadMiddleware(req, res, next) {

  uploadArticleCover(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Cover upload failed. Max 5 MB, JPG/PNG/WebP only.',
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided. Send the image as form-data with field name "cover_image".',
      });
    }
    next();
  });
}

router.post(
  '/cover',
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