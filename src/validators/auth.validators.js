import { body } from "express-validator";

export const registerValidator = [
    body('email')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),

    body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters')
        .matches(/[A-Z]/)
        .withMessage('Password must contain at least one uppercase letter')
        .matches(/[0-9]/)
        .withMessage('Password must contain at least one number'),

    body('full_name')
        .trim()
        .notEmpty()
        .withMessage('Full name is required')
        .isLength({ max: 150 })
        .withMessage('Full name too long'),
]

export const loginValidator = [
  body('email')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];