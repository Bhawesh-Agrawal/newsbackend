import { body } from 'express-validator';

export const createCommentValidator = [
  body('article_id')
    .optional()
    .isUUID()
    .withMessage('Valid article ID is required'),

  body('video_article_id')
    .optional()
    .isUUID()
    .withMessage('Valid video article ID is required'),

  body('body')
    .trim()
    .notEmpty()
    .withMessage('Comment body is required')
    .isLength({ max: 2000 })
    .withMessage('Comment cannot exceed 2000 characters'),

  body('parent_id')
    .optional()
    .isUUID()
    .withMessage('Valid parent comment ID required'),
];

export const moderateCommentValidator = [
  body('action')
    .isIn(['approve', 'reject', 'spam'])
    .withMessage('Action must be approve, reject, or spam'),
];