import { Router } from 'express';
import {
  createArticle, getArticles, getArticleBySlug,
  getArticleById,
  updateArticle, deleteArticle, getTrendingArticles, getRelatedArticles
} from '../controllers/articles.controller.js';
import { toggleLike, getLikeStatus }   from '../controllers/likes.controller.js';
import { trackView }                   from '../controllers/views.controller.js';
import { authenticate, optionalAuth, isAuthor, isSuperAdmin } from '../middleware/auth.middleware.js';
import { validate }                    from '../middleware/validate.middleware.js';
import {
  createArticleValidator,
  updateArticleValidator,
} from '../validators/article.validator.js';
import { getReviewQueue, reviewAction } from '../controllers/review.controller.js'

const router = Router();

function setCacheHeader(maxAge = 60, staleWhileRevalidate = 120) {
  return (_req, res, next) => {
    res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`)
    next()
  }
}

function setCacheHeaderPublicOnly(maxAge = 60, staleWhileRevalidate = 120) {
  return (req, res, next) => {
    const token = req.headers.authorization
    if (token) {
      res.set('Cache-Control', 'private, no-store')
    } else {
      res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`)
    }
    next()
  }
}



// ── Public routes ─────────────────────────────────────────────────────────────
router.get('/', setCacheHeaderPublicOnly(60, 120), optionalAuth, getArticles)
router.get('/trending', setCacheHeader(120, 300), getTrendingArticles);

router.get('/review', authenticate, isSuperAdmin, getReviewQueue)

// ── IMPORTANT: specific paths before /:slug wildcard ─────────────────────────

// Admin-only: fetch any article by UUID regardless of status.
// Must come BEFORE /:slug so the path "/admin/:id" is matched first.
// Protected: only authenticated authors/editors can call this.
// FIX: this is what AdminEditor uses — the frontend sends a UUID, not a slug.
router.get('/admin/:id', authenticate, isAuthor, getArticleById);
router.patch('/:id/review-action', authenticate, isSuperAdmin, reviewAction)

// Public slug lookup — published articles only
router.get('/:slug', setCacheHeader(300, 600), getArticleBySlug);
router.get('/:id/related', setCacheHeader(300, 600), getRelatedArticles);

// ── Mutations ─────────────────────────────────────────────────────────────────
router.post('/',      authenticate, isAuthor, createArticleValidator, validate, createArticle);
router.put('/:id',    authenticate, isAuthor, updateArticleValidator, validate, updateArticle);
router.delete('/:id', authenticate, isAuthor, deleteArticle);

// ── Engagement (personalised, never cached at CDN) ────────────────────────────
router.post('/:id/like', optionalAuth, toggleLike);
router.get('/:id/like',  optionalAuth, getLikeStatus);
router.post('/:id/view', optionalAuth, trackView);

export default router;