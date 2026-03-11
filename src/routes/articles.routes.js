import { Router } from 'express';
import {
  createArticle,
  getArticles,
  getArticleBySlug,
  updateArticle,
  deleteArticle,
} from '../controllers/articles.controller.js';
import {
  authenticate,
  optionalAuth,
  isAuthor,
} from '../middleware/auth.middleware.js';

const router = Router();

router.get('/',         getArticles);
router.get('/:slug',    getArticleBySlug);
router.post('/',        authenticate, isAuthor, createArticle);
router.put('/:id',      authenticate, isAuthor, updateArticle);
router.delete('/:id',   authenticate, isAuthor, deleteArticle);

export default router;