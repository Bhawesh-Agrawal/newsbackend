/**
 * auth.routes.js
 *
 * All auth endpoints live under /auth (mounted in app.js).
 * Profile editing (PATCH /auth/me, POST /auth/me/avatar) is
 * co-located here so the frontend always uses /auth/* consistently.
 *
 * Upload routes (/uploads/*) stay separate — they're used by
 * article cover uploads too (different auth requirement: isAuthor).
 */

import { Router } from 'express';
import { body }   from 'express-validator';

import {
  register,
  verifyEmail,
  login,
  googleAuth,
  requestMagicLink,
  verifyMagicLink,
  refresh,
  logout,
  getMe,
} from '../controllers/auth.controller.js';

import { updateProfile, updateAvatar, updateAvatarUrl }        from '../controllers/profile.controller.js';
import { uploadAvatarToCloudinary }           from '../services/cloudinary.services.js';

import { authenticate }                      from '../middleware/auth.middleware.js';
import { validate }                          from '../middleware/validate.middleware.js';
import { verifyTurnstile }                   from '../middleware/turnstile.middleware.js';
import { registerValidator, loginValidator } from '../validators/auth.validators.js';
import {
  loginLimiter,
  registerLimiter,
  magicLinkLimiter,
  googleAuthLimiter
} from '../middleware/ratelimit.middleware.js';

const router = Router();

// ── Register ──────────────────────────────────────────────────
router.post('/register',
  registerLimiter,
  verifyTurnstile,
  registerValidator,
  validate,
  register,
);

// ── Verify email ──────────────────────────────────────────────
router.post('/verify-email',
  body('token').notEmpty().withMessage('Verification token required'),
  validate,
  verifyEmail,
);

// ── Login ─────────────────────────────────────────────────────
router.post('/login',
  loginLimiter,
  verifyTurnstile,
  loginValidator,
  validate,
  login,
);

// ── Google OAuth ──────────────────────────────────────────────
router.post('/google',
  googleAuthLimiter,
  body('id_token').notEmpty().withMessage('Google ID token required'),
  validate,
  googleAuth,
);

// ── Magic link ────────────────────────────────────────────────
router.post('/magic-link/request',
  magicLinkLimiter,
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  validate,
  requestMagicLink,
);

router.post('/magic-link/verify',
  body('token').notEmpty().withMessage('Token required'),
  validate,
  verifyMagicLink,
);

router.post('/refresh', refresh);
router.post('/logout',  authenticate, logout);

router.get  ('/me',        authenticate, getMe);
router.patch('/me',        authenticate, updateProfile);
router.patch('/me/avatar-url', authenticate, updateAvatarUrl)
router.post ('/me/avatar', authenticate, uploadAvatarToCloudinary, updateAvatar);

export default router;