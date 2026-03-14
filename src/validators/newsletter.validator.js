import { body } from 'express-validator';

export const subscribeValidator = [
  body('email')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),

  body('full_name')
    .optional()
    .trim()
    .isLength({ max: 150 })
    .withMessage('Name too long'),
];

export const campaignValidator = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Campaign title is required'),

  body('subject')
    .trim()
    .notEmpty()
    .withMessage('Email subject is required'),

  body('body_html')
    .notEmpty()
    .withMessage('HTML body is required'),
];