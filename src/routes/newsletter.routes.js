import { Router } from 'express';
import {
  subscribe, confirmSubscription, unsubscribe,
  getSubscribers, sendCampaign, getCampaigns,
} from '../controllers/newsletter.controller.js';
import { optionalAuth, authenticate, isSuperAdmin } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { subscribeValidator, campaignValidator } from '../validators/newsletter.validator.js';
import { newsletterLimiter } from '../middleware/ratelimit.middleware.js';

const router = Router();

router.post('/subscribe',   optionalAuth, newsletterLimiter, subscribeValidator, validate, subscribe);
router.post('/confirm',     confirmSubscription);
router.post('/unsubscribe', unsubscribe);
router.get('/subscribers',  authenticate, isSuperAdmin, getSubscribers);
router.post('/send',        authenticate, isSuperAdmin, campaignValidator, validate, sendCampaign);
router.get('/campaigns',    authenticate, isSuperAdmin, getCampaigns);

export default router;