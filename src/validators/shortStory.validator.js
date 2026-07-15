import { body } from 'express-validator';

export const submitShortStoryValidator = [
  body('source_url')
    .trim()
    .notEmpty()
    .withMessage('source_url is required')
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('source_url must be a valid HTTP/HTTPS URL'),
];

export const reviewShortStoryValidator = [
  body('admin_status')
    .notEmpty()
    .withMessage('admin_status is required')
    .isIn(['approved', 'rejected'])
    .withMessage('admin_status must be "approved" or "rejected"'),

  body('admin_notes')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('admin_notes cannot exceed 2000 characters'),
];

export const editShortStoryValidator = [
  body('title')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('title cannot exceed 500 characters'),

  body('author')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('author cannot exceed 200 characters'),

  body('short_story_content')
    .optional()
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('short_story_content must be 10-5000 characters'),

  body('hero_image_url')
    .optional()
    .trim()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('hero_image_url must be a valid URL'),
];
