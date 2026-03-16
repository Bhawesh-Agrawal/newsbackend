import bcrypt from 'bcryptjs';
import sql from '../config/database.js';
import {
  signAccessToken,
  signRefreshToken,
  saveRefreshToken,
  verifyRefreshToken,
  hashToken,
  revokeAllUserTokens,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} from '../services/jwt.service.js';
import { OAuth2Client }   from 'google-auth-library';
import { sendMagicLinkEmail } from '../services/email.service.js';
import { generateToken } from '../utils/helpers.js';

export const register = async (req, res, next) => {
  try {
    const { email, password, full_name } = req.body;

    // 1. Check if email already exists
    const existingUser = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;

    if (existingUser.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email already in use',
      });
    }

    // 2. Hash the password
    const password_hash = await bcrypt.hash(password, 12);

    // 3. Insert the user
    const newUser = await sql`
      INSERT INTO users (email, password_hash, full_name, role, status, auth_provider)
      VALUES (
        ${email.toLowerCase()},
        ${password_hash},
        ${full_name},
        'reader',
        'active',
        'email'
      )
      RETURNING id, email, full_name, role, status
    `;

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: newUser[0],
    });

  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. Find user by email
    const users = await sql`
      SELECT id, email, full_name, password_hash, role, status
      FROM users
      WHERE email = ${email.toLowerCase()}
    `;

    const user = users[0];

    // 2. User not found OR wrong password — same error message (security)
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 3. Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 4. Check account status
    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Account suspended',
      });
    }

    // 5. Issue tokens
    const payload = { id: user.id, role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    // 6. Save refresh token to DB
    await saveRefreshToken(user.id, refreshToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    // 7. Update last login
    await sql`
      UPDATE users
      SET last_login_at = NOW(), last_login_ip = ${req.ip}
      WHERE id = ${user.id}
    `;

    setRefreshTokenCookie(res, refreshToken);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        user: {
          id:        user.id,
          email:     user.email,
          full_name: user.full_name,
          role:      user.role,
        },
      },
    });

  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res, next) => {
  try {
    const users = await sql`
      SELECT id, email, full_name, display_name,
             avatar_url, bio, role, status,
             email_verified, created_at, last_login_at
      FROM users
      WHERE id = ${req.user.id}
    `;

    return res.status(200).json({
      success: true,
      data: users[0],
    });

  } catch (err) {
    next(err);
  }
};

export const refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required',
      });
    }

    const decoded   = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const tokens = await sql`
      SELECT * FROM refresh_tokens
      WHERE token_hash = ${tokenHash}
        AND revoked    = FALSE
        AND expires_at > NOW()
    `;

    if (tokens.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token invalid or expired',
      });
    }

    await sql`
      UPDATE refresh_tokens
      SET revoked = TRUE, revoked_at = NOW()
      WHERE token_hash = ${tokenHash}
    `;

    const payload         = { id: decoded.id, role: decoded.role };
    const newAccessToken  = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);

    await saveRefreshToken(decoded.id, newRefreshToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    setRefreshTokenCookie(res, newRefreshToken);

    return res.status(200).json({
      success: true,
      data: { accessToken: newAccessToken },
    });

  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }
    next(err);
  }
};

export const logout = async (req, res, next) => {
  try {
    await revokeAllUserTokens(req.user.id);

    clearRefreshTokenCookie(res);

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });

  } catch (err) {
    next(err);
  }
};

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const googleLogin = async (req, res, next) => {
  try {
    const { id_token } = req.body;

    if (!id_token) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required',
      });
    }

    // ── 1. Verify token with Google ───────────────────────────────
    // This call hits Google's servers to confirm the token is real
    // and was issued for YOUR app (audience check)
    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken:  id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token',
      });
    }

    const payload = ticket.getPayload();

    // payload contains: sub (Google user ID), email, name, picture, email_verified
    const {
      sub:            googleId,
      email,
      name:           full_name,
      picture:        avatar_url,
      email_verified,
    } = payload;

    // Google only issues tokens for verified emails
    // But double-check anyway
    if (!email_verified) {
      return res.status(400).json({
        success: false,
        message: 'Google account email is not verified',
      });
    }

    // ── 2. Find existing user ─────────────────────────────────────
    // Check by google_id first (returning Google users)
    // Then by email (user registered with email, now logging in with Google)
    let users = await sql`
      SELECT * FROM users
      WHERE google_id = ${googleId}
         OR email     = ${email.toLowerCase()}
      LIMIT 1
    `;

    let user;
    let isNewUser = false;

    if (users.length === 0) {
      // ── 3a. Brand new user — create account ────────────────────
      const newUsers = await sql`
        INSERT INTO users
          (email, full_name, avatar_url, role, status,
           auth_provider, google_id, email_verified)
        VALUES (
          ${email.toLowerCase()},
          ${full_name},
          ${avatar_url || null},
          'reader',
          'active',
          'google',
          ${googleId},
          TRUE
        )
        RETURNING *
      `;

      user      = newUsers[0];
      isNewUser = true;

    } else {
      user = users[0];

      // ── 3b. Existing user — handle edge cases ──────────────────
      if (user.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended',
        });
      }

      // If they registered with email before, link their Google ID now
      // Also update avatar from Google if they don't have one
      await sql`
        UPDATE users SET
          google_id     = COALESCE(google_id, ${googleId}),
          avatar_url    = COALESCE(avatar_url, ${avatar_url || null}),
          email_verified = TRUE,
          last_login_at = NOW(),
          login_count   = login_count + 1
        WHERE id = ${user.id}
      `;

      // Re-fetch with updated data
      const refreshed = await sql`SELECT * FROM users WHERE id = ${user.id}`;
      user = refreshed[0];
    }

    // ── 4. Issue tokens ───────────────────────────────────────────
    const tokenPayload = { id: user.id, role: user.role };
    const accessToken  = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    await saveRefreshToken(user.id, refreshToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    setRefreshTokenCookie(res, refreshToken);

    return res.status(isNewUser ? 201 : 200).json({
      success: true,
      message: isNewUser ? 'Account created via Google' : 'Google login successful',
      data: {
        accessToken,
        user: {
          id:        user.id,
          email:     user.email,
          full_name: user.full_name,
          role:      user.role,
          avatar_url: user.avatar_url,
        },
      },
    });

  } catch (err) {
    next(err);
  }
};

export const requestMagicLink = async (req, res, next) => {
  try {
    const { email, full_name } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    if (!full_name) {
      return res.status(400).json({
        success: false,
        message: 'Full Name is required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // ── 1. Find or create user ────────────────────────────────────
    let users = await sql`
      SELECT * FROM users WHERE email = ${normalizedEmail}
    `;

    let user;

    if (users.length === 0) {
      const newUsers = await sql`
        INSERT INTO users
          (email, full_name, role, status, auth_provider, email_verified)
        VALUES
          (${normalizedEmail}, ${full_name}, 'reader', 'active', 'magic_link', FALSE)
        RETURNING *
      `;
      user = newUsers[0];
    } else {
      user = users[0];

      if (user.status === 'suspended') {
        return res.status(200).json({
          success: true,
          message: 'If this email is registered, a login link has been sent',
        });
      }
    }

    await sql`
      DELETE FROM magic_link_tokens
      WHERE user_id = ${user.id}
        AND used_at IS NULL
    `;

    const rawToken    = generateToken(32);         // 64 char hex string
    const tokenHash   = hashToken(rawToken);        // SHA-256 hash for DB
    const expiresAt   = new Date(
      Date.now() + (parseInt(process.env.MAGIC_LINK_EXPIRES_MINUTES) || 15) * 60 * 1000
    );

    await sql`
      INSERT INTO magic_link_tokens
        (user_id, token_hash, expires_at, ip_address)
      VALUES
        (${user.id}, ${tokenHash}, ${expiresAt}, ${req.ip})
    `;

    sendMagicLinkEmail(normalizedEmail, user.full_name, rawToken)
      .catch(err => console.error('[Magic Link] Email send failed:', err.message));

    return res.status(200).json({
      success: true,
      message: 'If this email is registered, a login link has been sent',
    });

  } catch (err) {
    next(err);
  }
};

export const verifyMagicLink = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      });
    }

    const tokenHash = hashToken(token);

    // ── 1. Look up token ──────────────────────────────────────────
    const tokens = await sql`
      SELECT
        mlt.*,
        u.id        AS user_id,
        u.email,
        u.full_name,
        u.role,
        u.status,
        u.avatar_url
      FROM magic_link_tokens mlt
      JOIN users u ON mlt.user_id = u.id
      WHERE mlt.token_hash = ${tokenHash}
    `;

    if (tokens.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired login link',
      });
    }

    const tokenRow = tokens[0];

    // ── 2. Validate token state ───────────────────────────────────
    if (tokenRow.used_at) {
      return res.status(400).json({
        success: false,
        message: 'This login link has already been used. Request a new one.',
      });
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'This login link has expired. Request a new one.',
      });
    }

    if (tokenRow.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended',
      });
    }

    // ── 3. Mark token as used ─────────────────────────────────────
    await sql`
      UPDATE magic_link_tokens
      SET used_at = NOW()
      WHERE token_hash = ${tokenHash}
    `;

    // ── 4. Mark email as verified + update login stats ────────────
    await sql`
      UPDATE users SET
        email_verified = TRUE,
        last_login_at  = NOW(),
        login_count    = login_count + 1,
        auth_provider  = CASE
          WHEN auth_provider = 'email'::auth_provider THEN 'email'::auth_provider
          ELSE 'magic_link'::auth_provider
        END
      WHERE id = ${tokenRow.user_id}
    `;

    // ── 5. Issue tokens ───────────────────────────────────────────
    const payload      = { id: tokenRow.user_id, role: tokenRow.role };
    const accessToken  = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    await saveRefreshToken(tokenRow.user_id, refreshToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    setRefreshTokenCookie(res, refreshToken);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        user: {
          id:         tokenRow.user_id,
          email:      tokenRow.email,
          full_name:  tokenRow.full_name,
          role:       tokenRow.role,
          avatar_url: tokenRow.avatar_url,
        },
      },
    });

  } catch (err) {
    next(err);
  }
};