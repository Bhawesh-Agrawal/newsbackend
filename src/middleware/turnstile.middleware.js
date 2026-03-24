// src/middleware/turnstile.middleware.js
// Validates Cloudflare Turnstile tokens server-side.
// Apply to: POST /auth/register and POST /auth/login.
// Google OAuth skips this — Google is its own bot protection.

export const verifyTurnstile = async (req, res, next) => {
  const secretKey = process.env.TURNSTILE_SECRET_KEY
  if (!secretKey) return next()

  const token = req.body['cf-turnstile-response']

  if (!token) {
    console.log('[Turnstile] No token in request body. Keys present:', Object.keys(req.body))
    return res.status(400).json({
      success: false,
      message: 'Security check required. Please complete the verification.',
    })
  }

  try {
    const body = new URLSearchParams()
    body.append('secret',   secretKey)
    body.append('response', token)
    body.append('remoteip', req.ip)

    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
      }
    )

    const result = await response.json()
    console.log('[Turnstile] Verification result:', result)

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Security verification failed. Please try again.',
        ...(process.env.NODE_ENV !== 'production' && { errors: result['error-codes'] }),
      })
    }

    next()
  } catch (err) {
    console.error('[Turnstile] Fetch failed:', err.message)
    if (process.env.NODE_ENV === 'production') {
      next()
    } else {
      return res.status(503).json({
        success: false,
        message: 'Security check service unavailable.',
      })
    }
  }
}