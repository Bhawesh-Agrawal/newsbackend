import { Router } from 'express';
import {
  createVideoArticle,
  getVideoArticles,
  getVideoArticleBySlug,
  getVideoArticleById,
  updateVideoArticle,
  deleteVideoArticle,
  getVideoReviewQueue,
  videoReviewAction,
  getTrendingVideoArticles,
  getRelatedVideoArticles,
  toggleVideoLike,
  getVideoLikeStatus,
  trackVideoView,
} from '../controllers/videoArticle.controller.js';
import { authenticate, optionalAuth, isAuthor, isSuperAdmin } from '../middleware/auth.middleware.js';
import { engagementLimiter } from '../middleware/ratelimit.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createVideoArticleValidator,
  updateVideoArticleValidator,
} from '../validators/videoArticle.validator.js';

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
router.get('/', setCacheHeaderPublicOnly(60, 120), optionalAuth, getVideoArticles)
router.get('/trending', setCacheHeader(120, 300), getTrendingVideoArticles)

// ── IMPORTANT: specific paths before /:slug wildcard ─────────────────────────
router.get('/review', authenticate, isSuperAdmin, getVideoReviewQueue)
router.get('/admin/:id', authenticate, isAuthor, getVideoArticleById)
router.patch('/:id/review-action', authenticate, isSuperAdmin, videoReviewAction)

// Public slug lookup — published video articles only
router.get('/:slug', setCacheHeader(300, 600), getVideoArticleBySlug)
router.get('/:id/related', setCacheHeader(300, 600), getRelatedVideoArticles)

// ── Mutations ─────────────────────────────────────────────────────────────────
router.post('/',      authenticate, isAuthor, createVideoArticleValidator, validate, createVideoArticle)
router.put('/:id',    authenticate, isAuthor, updateVideoArticleValidator, validate, updateVideoArticle)
router.delete('/:id', authenticate, isAuthor, deleteVideoArticle)

// ── Engagement (personalised, never cached at CDN) ────────────────────────────
router.post('/:id/like', optionalAuth, toggleVideoLike)
router.get('/:id/like',  optionalAuth, getVideoLikeStatus)
router.post('/:id/view', engagementLimiter, optionalAuth, trackVideoView)

export default router;
