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
} from '../validators/article.validator.js';
import { renderArticleMeta } from '../middleware/botrender.middleware.js';

const router = Router();

function detectBot(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  const isBot = /bot|crawler|spider|facebookexternalhit|twitterbot|whatsapp|telegram|linkedinbot|slackbot|discordbot|googlebot|bingbot|applebot|rogerbot|embedly|quora|outbrain|pinterest|vkshare|showyoubot|flipboard|nuzzel|viber|skype|MSNBot|DuckDuckBot|Baiduspider|YandexBot|Sogou|Exabot/i.test(ua);
  if (isBot) return renderArticleMeta(req, res);
  next();
}

router.get('/',             getArticles);
router.get('/trending',     getTrendingArticles);
router.get('/:slug',        detectBot, getArticleBySlug);   // ← bot check here only
router.post('/',            authenticate, isAuthor, createArticleValidator, validate, createArticle);
router.put('/:id',          authenticate, isAuthor, updateArticleValidator, validate, updateArticle);
router.delete('/:id',       authenticate, isAuthor, deleteArticle);
router.post('/:id/like',    optionalAuth, toggleLike);
router.get('/:id/like',     optionalAuth, getLikeStatus);
router.post('/:id/view',    optionalAuth, trackView);
router.get('/:id/related',  getRelatedArticles);

export default router;