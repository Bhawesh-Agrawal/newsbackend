import { body } from 'express-validator';

export const createArticleValidator = [
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
];

export const updateArticleValidator = [
  body('title')
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage('Title cannot exceed 300 characters'),

  body('category_id')
    .optional()
    .isUUID()
    .withMessage('Valid category ID is required'),

  body('status')
    .optional()
    .isIn(['draft', 'review', 'published', 'scheduled', 'archived'])
    .withMessage('Invalid status'),
];