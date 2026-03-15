import { Router } from 'express';
import {
  register, login, getMe, refresh, logout,
  googleLogin,
  requestMagicLink, verifyMagicLink,
} from '../controllers/auth.controller.js';
import { authenticate }              from '../middleware/auth.middleware.js';
import { validate }                  from '../middleware/validate.middleware.js';
import { authLimiter }               from '../middleware/ratelimit.middleware.js';
import { registerValidator, loginValidator } from '../validators/auth.validators.js';
import { body } from 'express-validator';

const router = Router();

// Email auth
router.post('/register', authLimiter, registerValidator, validate, register);
router.post('/login',    authLimiter, loginValidator,    validate, login);

// Google OAuth
router.post('/google',
  authLimiter,
  body('id_token').notEmpty().withMessage('Google ID token required'),
  validate,
  googleLogin
);

// Magic link
router.post('/magic-link/request',
  authLimiter,
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  validate,
  requestMagicLink
);

router.post('/magic-link/verify',
  authLimiter,
  body('token').notEmpty().withMessage('Token required'),
  validate,
  verifyMagicLink
);

// Token management
router.post('/refresh',  authLimiter, refresh);
router.post('/logout',   authenticate, logout);
router.get('/me',        authenticate, getMe);

export default router;