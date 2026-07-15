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
