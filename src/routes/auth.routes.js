import { Router } from 'express';
import { register, login, getMe, refresh, logout } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { registerValidator, loginValidator } from '../validators/auth.validators.js';
import { authLimiter } from '../middleware/ratelimit.middleware.js';

const router = Router();

router.post('/register', authLimiter, registerValidator, validate, register);
router.post('/login',    authLimiter, loginValidator,    validate, login);
router.post('/refresh',  authLimiter, refresh);
router.post('/logout',   authenticate, logout);
router.get('/me',        authenticate, getMe);

export default router;