import { Router } from 'express';
import {
  createArticle, getArticles, getArticleBySlug,
  updateArticle, deleteArticle, getTrendingArticles, getRelatedArticles
} from '../controllers/articles.controller.js';
import { toggleLike, getLikeStatus } from '../controllers/likes.controller.js';
import { trackView } from '../controllers/views.controller.js';
import { authenticate, optionalAuth, isAuthor } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createArticleValidator,
  updateArticleValidator,
} from '../validators/article.validators.js';

const router = Router();

router.get('/',           getArticles);
router.get('/trending',   getTrendingArticles);
router.get('/:slug',      getArticleBySlug);
router.post('/',          authenticate, isAuthor, createArticleValidator, validate, createArticle);
router.put('/:id',        authenticate, isAuthor, updateArticleValidator, validate, updateArticle);
router.delete('/:id',     authenticate, isAuthor, deleteArticle);
router.post('/:id/like',  optionalAuth, toggleLike);
router.get('/:id/like',   optionalAuth, getLikeStatus);
router.post('/:id/view',  optionalAuth, trackView);
router.get('/:id/related', getRelatedArticles);

export default router;