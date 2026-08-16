import { Router } from 'express';
import {
  trackEngagement,
  getArticleReadingStats,
  getSiteEngagement,
  getSessionJourney,
  getPostReadJourney,
} from '../controllers/engagement.controller.js';
import {
  getActionCenter,
  getGrowthTrends,
  getTitleAnalysis,
  getPostingTimes,
  getTopicClusters,
  getKeywordResearch,
  getSeoCredits,
  getDecayDetection,
} from '../controllers/insights.controller.js';
import {
  submitFeedback,
  getFeedbackStatus,
  getFeedbackQuestion,
} from '../controllers/feedback.controller.js';
import {
  authenticate,
  isEditor,
  optionalAuth,
} from '../middleware/auth.middleware.js';
import { engagementLimiter } from '../middleware/ratelimit.middleware.js';

const router = Router();

// ── Public: Engagement tracking (fire-and-forget from client) ────────────────
router.post('/engagement/track', engagementLimiter, optionalAuth, trackEngagement);

// ── Protected: Reading stats ─────────────────────────────────────────────────
router.get('/engagement/article/:id', authenticate, isEditor, getArticleReadingStats);
router.get('/engagement/site', authenticate, isEditor, getSiteEngagement);
router.get('/engagement/journey', authenticate, isEditor, getSessionJourney);
router.get('/engagement/post-read/:id', authenticate, isEditor, getPostReadJourney);

// ── Public: User feedback (micro-surveys) ───────────────────────────────────
router.post('/feedback', engagementLimiter, optionalAuth, submitFeedback);
router.get('/feedback/status', optionalAuth, getFeedbackStatus);
router.get('/feedback/question', optionalAuth, getFeedbackQuestion);

// ── Protected: Insights ──────────────────────────────────────────────────────
router.use(authenticate);
router.use(isEditor);

router.get('/insights/action-center', getActionCenter);
router.get('/insights/growth-trends', getGrowthTrends);
router.get('/insights/title-analysis', getTitleAnalysis);
router.get('/insights/posting-times', getPostingTimes);
router.get('/insights/topic-clusters', getTopicClusters);
router.get('/insights/keywords', getKeywordResearch);
router.get('/insights/credits', getSeoCredits);
router.get('/insights/decay', getDecayDetection);

export default router;
