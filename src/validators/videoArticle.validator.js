import { body } from 'express-validator';

export const createVideoArticleValidator = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ max: 300 })
    .withMessage('Title cannot exceed 300 characters'),

  body('body')
    .notEmpty()
    .withMessage('Article body is required'),

  body('category_id')
    .isUUID()
    .withMessage('Valid category ID is required'),

  body('video_type')
    .notEmpty()
    .withMessage('video_type is required')
    .isIn(['uploaded', 'embedded'])
    .withMessage('video_type must be "uploaded" or "embedded"'),

  body('video_url')
    .if(body('video_type').equals('embedded'))
    .notEmpty()
    .withMessage('video_url is required for embedded videos')
    .isURL()
    .withMessage('video_url must be a valid URL'),

  body('video_provider')
    .if(body('video_type').equals('embedded'))
    .optional()
    .isIn(['youtube', 'instagram', 'vimeo', 'dailymotion', 'facebook', 'tiktok', 'other'])
    .withMessage('Invalid video provider'),

  body('video_public_id')
    .if(body('video_type').equals('uploaded'))
    .notEmpty()
    .withMessage('video_public_id is required for uploaded videos'),

  body('video_duration')
    .optional({ values: 'falsy' })
    .toInt()
    .isInt({ min: 1 })
    .withMessage('video_duration must be a positive integer (seconds)'),

  body('status')
    .optional()
    .isIn(['draft', 'review', 'published', 'scheduled'])
    .withMessage('Invalid status'),

  body('tag_ids')
    .optional()
    .isArray()
    .withMessage('tag_ids must be an array'),

  body('tag_ids.*')
    .optional()
    .isUUID()
    .withMessage('Each tag ID must be a valid UUID'),

  body('scheduled_at')
    .optional()
    .isISO8601()
    .withMessage('scheduled_at must be a valid date'),

  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sort_order must be a non-negative integer'),

  body('linked_article_id')
    .optional({ values: 'falsy' })
    .isUUID()
    .withMessage('linked_article_id must be a valid UUID'),
];

export const updateVideoArticleValidator = [
  body('title')
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage('Title cannot exceed 300 characters'),

  body('category_id')
    .optional()
    .isUUID()
    .withMessage('Valid category ID is required'),

  body('video_type')
    .optional()
    .isIn(['uploaded', 'embedded'])
    .withMessage('video_type must be "uploaded" or "embedded"'),

  body('video_url')
    .optional()
    .isURL()
    .withMessage('video_url must be a valid URL'),

  body('video_provider')
    .optional()
    .isIn(['youtube', 'instagram', 'vimeo', 'dailymotion', 'facebook', 'tiktok', 'other'])
    .withMessage('Invalid video provider'),

  body('video_duration')
    .optional({ values: 'falsy' })
    .toInt()
    .isInt({ min: 1 })
    .withMessage('video_duration must be a positive integer (seconds)'),

  body('status')
    .optional()
    .isIn(['draft', 'review', 'published', 'scheduled', 'archived'])
    .withMessage('Invalid status'),

  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sort_order must be a non-negative integer'),

  body('linked_article_id')
    .optional({ values: 'falsy' })
    .isUUID()
    .withMessage('linked_article_id must be a valid UUID'),
];
