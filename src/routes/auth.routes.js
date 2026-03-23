import { Router } from 'express';
import { body }   from 'express-validator';

// ── Controllers ───────────────────────────────────────────────
import {
  register,
  verifyEmail,        // ← was missing entirely
  login,
  googleAuth,         // ← your file had 'googleLogin' — wrong name
  requestMagicLink,
  verifyMagicLink,
  refresh,      // ← your file had 'refresh' — wrong name
  logout,
  getMe,
} from '../controllers/auth.controller.js';

// ── Middleware ────────────────────────────────────────────────
import { authenticate }                      from '../middleware/auth.middleware.js';
import { validate }                          from '../middleware/validate.middleware.js';
import { authLimiter }                       from '../middleware/ratelimit.middleware.js';
import { verifyTurnstile }                   from '../middleware/turnstile.middleware.js';
import { registerValidator, loginValidator } from '../validators/auth.validators.js';

const router = Router();

// ── Register ─────────────────────────────────────────────────
// Turnstile runs BEFORE validators so bots are rejected cheaply
router.post('/register',
  authLimiter,
  verifyTurnstile,
  registerValidator,
  validate,
  register
);

// ── Verify email (link from registration email) ───────────────
// No rate limit needed — token is single-use and 24hr expiry
router.post('/verify-email',
  body('token').notEmpty().withMessage('Verification token required'),
  validate,
  verifyEmail
);

// ── Login ─────────────────────────────────────────────────────
router.post('/login',
  authLimiter,
  verifyTurnstile,
  loginValidator,
  validate,
  login
);

// ── Google OAuth ──────────────────────────────────────────────
// No Turnstile — Google already verifies the user isn't a bot
router.post('/google',
  authLimiter,
  body('id_token').notEmpty().withMessage('Google ID token required'),
  validate,
  googleAuth          // ← correct name from controller
);

// ── Magic link ────────────────────────────────────────────────
router.post('/magic-link/request',
  authLimiter,
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  validate,
  requestMagicLink
);

router.post('/magic-link/verify',
  body('token').notEmpty().withMessage('Token required'),
  validate,
  verifyMagicLink
);

// ── Token management ──────────────────────────────────────────
router.post('/refresh', refresh);   // ← correct name from controller
router.post('/logout',  authenticate, logout);
router.get('/me',       authenticate, getMe);

export default router;