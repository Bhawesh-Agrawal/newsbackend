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

import { authenticate }                      from '../middleware/auth.middleware.js';
import { validate }                          from '../middleware/validate.middleware.js';
import { verifyTurnstile }                   from '../middleware/turnstile.middleware.js';
import { registerValidator, loginValidator } from '../validators/auth.validators.js';
import {
  loginLimiter,
  registerLimiter,
  magicLinkLimiter,
} from '../middleware/ratelimit.middleware.js';

const router = Router();

// ── Register — 1 hour window, not shared with login ──────────
router.post('/register',
  registerLimiter,        // ← own separate limiter
  verifyTurnstile,
  registerValidator,
  validate,
  register
);

// ── Verify email — NO rate limit ─────────────────────────────
// Token is single-use and expires in 24h — no abuse possible
router.post('/verify-email',
  body('token').notEmpty().withMessage('Verification token required'),
  validate,
  verifyEmail
);

// ── Login — own limiter, only failed attempts count ───────────
router.post('/login',
  loginLimiter,           // ← own separate limiter
  verifyTurnstile,
  loginValidator,
  validate,
  login
);

// ── Google OAuth — no Turnstile, Google handles bot detection ─
router.post('/google',
  loginLimiter,           // reuse login limiter — same risk profile
  body('id_token').notEmpty().withMessage('Google ID token required'),
  validate,
  googleAuth
);

// ── Magic link — own hourly limiter ──────────────────────────
router.post('/magic-link/request',
  magicLinkLimiter,
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  validate,
  requestMagicLink
);

// ── Magic link verify — NO rate limit ────────────────────────
// Token is single-use, no benefit to rate limiting
router.post('/magic-link/verify',
  body('token').notEmpty().withMessage('Token required'),
  validate,
  verifyMagicLink
);

// ── Token management — no rate limit needed ───────────────────
router.post('/refresh', refresh);
router.post('/logout',  authenticate, logout);
router.get('/me',       authenticate, getMe);

export default router;