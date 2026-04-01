//import { uploadAvatar } from '../services/cloudinary.services.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { updateProfile } from '../controllers/profile.controller.js'
import { Router } from 'express';

const router = Router();

router.patch('/me',        authenticate, updateProfile)
//router.post ('/me/avatar', authenticate, uploadAvatar, updateAvatar)

export default router;