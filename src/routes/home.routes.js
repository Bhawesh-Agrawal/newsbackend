import { Router } from 'express';
import { getHomeData } from '../controllers/home.controller.js';
import { getPublicProfile, getUserArticles } from '../controllers/profile.controller.js';

const router = Router();

router.get('/', getHomeData);

// Public profile routes
router.get('/profiles/:userId', getPublicProfile);
router.get('/profiles/:userId/articles', getUserArticles);

export default router;
