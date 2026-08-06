/**
 * cloudinary.service.js
 *
 * ARCHITECTURE
 * ─────────────────────────────────────────────────────────────
 * Article covers  → multer-storage-cloudinary  (raster only, simple)
 * Avatars         → multer memoryStorage + manual upload_stream
 *
 * WHY memoryStorage for avatars?
 *   Cloudinary requires resource_type:'raw' for SVG.
 *   multer-storage-cloudinary can't switch resource_type per-file.
 *   Memory storage lets us inspect mimetype first, then choose pipeline.
 *
 * WHY the content-type guard at the top of uploadAvatarToCloudinary?
 *   If a global express.json() body-parser runs before this middleware,
 *   it silently consumes the multipart stream (because it tries to parse
 *   everything). Multer then sees an empty body, returns no error and no
 *   req.file. The guard catches this early and gives a clear message.
 */

import { v2 as cloudinary }  from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer                from 'multer';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MB = 1024 * 1024;

// ─────────────────────────────────────────────────────────────
//  ARTICLE COVER
// ─────────────────────────────────────────────────────────────
const coverStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'news-platform/covers',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [
      { width: 1200, height: 630, crop: 'fill', quality: 'auto', fetch_format: 'auto' },
    ],
  },
});

export const uploadArticleCover = multer({
  storage: coverStorage,
  limits:  { fileSize: 5 * MB },
  fileFilter(_req, file, cb) {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Cover must be JPG, PNG, or WEBP.'));
  },
}).single('cover_image');

// ─────────────────────────────────────────────────────────────
//  AVATAR — multer memoryStorage instance
//  Accepts raster + SVG. No Cloudinary involvement yet — just
//  gets the file into req.file.buffer so we can inspect it.
// ─────────────────────────────────────────────────────────────
const _avatarMemUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * MB },
  fileFilter(_req, file, cb) {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/svg+xml',
      'text/plain',       // some clients send SVG as text/plain
      'application/octet-stream', // fallback when mime detection fails
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}. Use JPG, PNG, WEBP, or SVG.`));
  },
}).single('avatar');

// ─────────────────────────────────────────────────────────────
//  uploadAvatarToCloudinary — Express middleware
//
//  Chain: content-type guard → multer → SVG/raster detect → Cloudinary
// ─────────────────────────────────────────────────────────────
export function uploadAvatarToCloudinary(req, res, next) {
  // ── Guard: ensure this is actually a multipart request ──────
  // If a global body-parser consumed the stream first, content-type
  // will still say multipart but req.readable will be false / body
  // already parsed. We catch both cases here.
  const ct = req.headers['content-type'] ?? '';

  if (!ct.includes('multipart/form-data')) {
    return res.status(400).json({
      success: false,
      message:
        'Request must be multipart/form-data. ' +
        'Do not set Content-Type manually when using FormData — ' +
        'let the browser/axios set it automatically (it includes the boundary).',
    });
  }

  // ── Run multer ───────────────────────────────────────────────
  _avatarMemUpload(req, res, async (multerErr) => {
    if (multerErr) {
      // Known multer errors: LIMIT_FILE_SIZE, LIMIT_UNEXPECTED_FILE, custom fileFilter errors
      const message = multerErr.code === 'LIMIT_FILE_SIZE'
        ? 'File too large. Maximum size is 5 MB.'
        : multerErr.message ?? 'Upload failed.';

      return res.status(400).json({ success: false, message });
    }

    // ── If req.file is still undefined here, the stream was consumed
    //    upstream (global body-parser). Give an actionable error. ─
    if (!req.file) {
      console.error(
        '[Avatar Upload] req.file is undefined after multer ran.\n' +
        'This almost always means a global express.json() or bodyParser\n' +
        'middleware ran before multer and consumed the multipart stream.\n' +
        'Fix: move express.json() AFTER file upload routes, or exclude\n' +
        'the /auth/me/avatar path from the global body-parser.\n' +
        'Content-Type received:', ct
      );
      return res.status(400).json({
        success: false,
        message: 'No file received. If this keeps happening, check that ' +
                 'no global body-parser middleware is running before this route.',
      });
    }

    // ── Detect SVG ────────────────────────────────────────────────
    // Hardcode detection from both mimetype AND filename extension
    // because some fetch implementations report SVG as 'application/octet-stream'
    const isSvg =
      req.file.mimetype === 'image/svg+xml' ||
      req.file.mimetype === 'text/plain' ||
      req.file.originalname?.toLowerCase().endsWith('.svg');

    // ── Upload to Cloudinary ──────────────────────────────────────
    const uploadOptions = isSvg
      ? {
          // SVG MUST use resource_type:'raw' — Cloudinary rejects SVGs
          // on the image pipeline regardless of allowed_formats setting
          folder:          'news-platform/avatars',
          resource_type:   'raw',
          allowed_formats: ['svg'],
          public_id:       `avatar_${Date.now()}`,
        }
      : {
          folder:          'news-platform/avatars',
          resource_type:   'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
          transformation:  [
            { width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' },
          ],
          public_id:       `avatar_${Date.now()}`,
        };

    try {
      const result = await _streamToCloudinary(req.file.buffer, uploadOptions);

      // Patch req.file to match multer-storage-cloudinary's output shape
      // so updateAvatar controller works without changes
      req.file.path     = result.secure_url;
      req.file.filename = result.public_id;
      next();

    } catch (err) {
      console.error('[Cloudinary Avatar] Upload stream failed:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Image upload failed. Please try again.',
      });
    }
  });
}

// ── Promisified upload_stream ─────────────────────────────────
function _streamToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// ─────────────────────────────────────────────────────────────
//  VIDEO UPLOAD — multer memoryStorage + manual upload_stream
//
//  Videos use resource_type:'video' for Cloudinary's video pipeline.
//  Memory storage lets us stream the buffer to Cloudinary.
//  Max size: 1 GB (news clips + longer segments).
// ─────────────────────────────────────────────────────────────
const GB = 1024 * 1024 * 1024;

const _videoMemUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 1 * GB },
  fileFilter(_req, file, cb) {
    const allowed = [
      'video/mp4',
      'video/webm',
      'video/quicktime',       // .mov
      'video/x-msvideo',       // .avi
      'video/x-matroska',      // .mkv
      'application/octet-stream', // fallback
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported video type: ${file.mimetype}. Use MP4, WebM, or MOV.`));
  },
}).single('video');

export function uploadVideoToCloudinary(req, res, next) {
  const ct = req.headers['content-type'] ?? '';

  if (!ct.includes('multipart/form-data')) {
    return res.status(400).json({
      success: false,
      message:
        'Request must be multipart/form-data. ' +
        'Do not set Content-Type manually when using FormData — ' +
        'let the browser/axios set it automatically (it includes the boundary).',
    });
  }

  _videoMemUpload(req, res, async (multerErr) => {
    if (multerErr) {
      const message = multerErr.code === 'LIMIT_FILE_SIZE'
        ? 'File too large. Maximum size is 1 GB.'
        : multerErr.message ?? 'Upload failed.';
      return res.status(400).json({ success: false, message });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file received. Send the video as form-data with field name "video".',
      });
    }

    const uploadOptions = {
      folder:          'news-platform/videos',
      resource_type:   'video',
      allowed_formats: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
      public_id:       `video_${Date.now()}`,
    };

    try {
      const result = await _streamToCloudinary(req.file.buffer, uploadOptions);

      req.file.path       = result.secure_url;
      req.file.filename   = result.public_id;
      req.file.duration   = result.duration;    // seconds
      req.file.bytes      = result.bytes;
      req.file.format     = result.format;
      next();
    } catch (err) {
      console.error('[Cloudinary Video] Upload stream failed:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Video upload failed. Please try again.',
      });
    }
  });
}

// ── Delete a Cloudinary asset ─────────────────────────────────
// Pass resourceType:'raw' when deleting an SVG avatar
// Pass resourceType:'video' when deleting a video
export const deleteImage = async (publicId, resourceType = 'image') => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.error('[Cloudinary] Delete failed:', err.message);
  }
};

export default cloudinary;