import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    message: 'Too many requests, please try again later',
  },
});

export const newsletterLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    message: 'Too many subscription attempts, please try again later',
  },
});


// ── Login limiter — strict, only counts failures ──────────────
// 15 failed attempts per 15 minutes per IP
// skipSuccessfulRequests means a real user logging in never hits this
export const loginLimiter = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    15,
  skipSuccessfulRequests: true,   // ← KEY: successful logins don't count
  standardHeaders:        true,
  legacyHeaders:          false,
  message: {
    success: false,
    message: 'Too many failed login attempts. Please wait 15 minutes.',
  },
});

// ── Register limiter — very loose, just blocks mass creation ──
// 10 registrations per hour per IP is already very generous
// A real user will only ever register once
export const registerLimiter = rateLimit({
  windowMs:               60 * 60 * 1000,   // 1 hour window
  max:                    10,
  skipSuccessfulRequests: false,             // registration attempts always count
  standardHeaders:        true,
  legacyHeaders:          false,
  message: {
    success: false,
    message: 'Too many registration attempts. Please try again in an hour.',
  },
});

// ── Magic link limiter — prevents email spam ──────────────────
// 5 per hour — enough for a user who keeps requesting
export const magicLinkLimiter = rateLimit({
  windowMs:               60 * 60 * 1000,
  max:                    5,
  skipSuccessfulRequests: false,
  standardHeaders:        true,
  legacyHeaders:          false,
  message: {
    success: false,
    message: 'Too many magic link requests. Please wait an hour.',
  },
});

// ── Keep authLimiter as alias for backward compatibility ──────
// Some routes may still import this — maps to loginLimiter
export const authLimiter = loginLimiter;