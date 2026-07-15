import { Router } from 'express';
import { authenticate, isEditor } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  submitShortStoryValidator,
  reviewShortStoryValidator,
} from '../validators/shortStory.validator.js';
import {
  submitShortStory,
  getShortStories,
  reviewShortStory,
  retryShortStory,
} from '../controllers/shortStory.controller.js';

const router = Router();

// All admin short-story routes require auth + editor role
router.use(authenticate, isEditor);

router.post(
  '/',
  submitShortStoryValidator,
  validate,
  submitShortStory,
);

router.get('/', getShortStories);

router.patch(
  '/:id/review',
  reviewShortStoryValidator,
  validate,
  reviewShortStory,
);

router.post('/:id/retry', retryShortStory);

export default router;
