import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

// ─────────────────────────────────────────────────────────────
// 🔐 SECURE KEY GENERATORS
// ─────────────────────────────────────────────────────────────

// ✅ Fully IPv6-safe + proxy-safe IP key
const ipKey = (req) => {
  // Extract IP from trusted headers (if present)
  const forwardedIp =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0].trim()

  // Normalize ALL IPs (critical for IPv6 safety)
  if (forwardedIp) {
    return ipKeyGenerator({ ip: forwardedIp })
  }

  // Fallback (Express handles proxy if trust proxy is enabled)
  return ipKeyGenerator(req)
}

// ✅ User-based limiter (prevents one user affecting others)
const userKey = (req) => {
  if (req.user?.id) {
    return `user:${req.user.id}`
  }

  return ipKey(req)
}

// ─────────────────────────────────────────────────────────────
// ⚠️ SHARED 429 HANDLER
// ─────────────────────────────────────────────────────────────

const handler429 = (req, res) => {
  const retryAfterHeader = res.getHeader('Retry-After')

  const retryAfterSeconds = retryAfterHeader
    ? Number(retryAfterHeader)
    : Math.ceil((req.rateLimit?.resetTime - Date.now()) / 1000) || 60

  const minutes = Math.ceil(retryAfterSeconds / 60)

  return res.status(429).json({
    success: false,
    message:
      minutes > 1
        ? `Too many requests. Please wait ${minutes} minutes before trying again.`
        : `Too many requests. Please wait a moment before trying again.`,
    retry_after_seconds: retryAfterSeconds,
  })
}

// ─────────────────────────────────────────────────────────────
// 🌍 GLOBAL LIMITER (ANTI-SCRAPING / DDoS)
// ─────────────────────────────────────────────────────────────

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler429,

  skip: (req) => {
    return req.method === 'OPTIONS' || req.path === '/health'
  },
})

// ─────────────────────────────────────────────────────────────
// 🔐 LOGIN LIMITER (BRUTE FORCE PROTECTION)
// ─────────────────────────────────────────────────────────────

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // failed attempts only
  keyGenerator: ipKey,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler429,
})

// ─────────────────────────────────────────────────────────────
// 🔐 GOOGLE AUTH LIMITER
// ─────────────────────────────────────────────────────────────

export const googleAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler429,
})

// ─────────────────────────────────────────────────────────────
// 📝 REGISTER LIMITER (ANTI-SPAM)
// ─────────────────────────────────────────────────────────────

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler429,
})

// ─────────────────────────────────────────────────────────────
// ✉️ MAGIC LINK LIMITER (EMAIL SPAM PROTECTION)
// ─────────────────────────────────────────────────────────────

export const magicLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler429,
})

// ─────────────────────────────────────────────────────────────
// 💬 ENGAGEMENT LIMITER (USER-BASED)
// ─────────────────────────────────────────────────────────────

export const engagementLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler429,
})

// ─────────────────────────────────────────────────────────────
// 📩 NEWSLETTER LIMITER
// ─────────────────────────────────────────────────────────────

export const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler429,
})