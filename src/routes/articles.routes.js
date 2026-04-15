import { Router } from 'express';
import {
  createArticle, getArticles, getArticleBySlug,
  updateArticle, deleteArticle, getTrendingArticles, getRelatedArticles
} from '../controllers/articles.controller.js';
import { toggleLike, getLikeStatus }   from '../controllers/likes.controller.js';
import { trackView }                   from '../controllers/views.controller.js';
import { authenticate, optionalAuth, isAuthor } from '../middleware/auth.middleware.js';
import { validate }                    from '../middleware/validate.middleware.js';
import {
  createArticleValidator,
  updateArticleValidator,
} from '../validators/article.validator.js';
import { renderArticleMeta }           from '../middleware/botrender.middleware.js';

const router = Router();

function detectBot(req, res, next) {
  const ua    = req.headers['user-agent'] || '';
  const isBot = /bot|crawler|spider|facebookexternalhit|twitterbot|whatsapp|telegram|linkedinbot|slackbot|discordbot|googlebot|bingbot|applebot|rogerbot|embedly|quora|outbrain|pinterest|vkshare|showyoubot|flipboard|nuzzel|viber|skype|MSNBot|DuckDuckBot|Baiduspider|YandexBot|Sogou|Exabot/i.test(ua);
  if (isBot) return renderArticleMeta(req, res);
  next();
}

// Cache-Control headers for CDN / browser caching.
// These complement the in-memory cache — a CDN layer (Vercel edge) can serve
// list responses for up to 60 s without hitting the origin at all.
function setCacheHeader(maxAge = 60, staleWhileRevalidate = 120) {
  return (_req, res, next) => {
    res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`)
    next()
  }
}

router.get('/',            setCacheHeader(60, 120),  getArticles);
router.get('/trending',    setCacheHeader(120, 300), getTrendingArticles);
router.get('/:slug',       detectBot, setCacheHeader(300, 600), getArticleBySlug);
router.get('/:id/related', setCacheHeader(300, 600), getRelatedArticles);

// Mutations — no cache headers
router.post('/',       authenticate, isAuthor, createArticleValidator, validate, createArticle);
router.put('/:id',     authenticate, isAuthor, updateArticleValidator, validate, updateArticle);
router.delete('/:id',  authenticate, isAuthor, deleteArticle);

// Engagement — personalised, never cached at CDN
router.post('/:id/like', optionalAuth, toggleLike);
router.get('/:id/like',  optionalAuth, getLikeStatus);
router.post('/:id/view', optionalAuth, trackView);

export default router;