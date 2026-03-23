import bcrypt          from 'bcryptjs';
import sql             from '../config/database.js';
import { OAuth2Client } from 'google-auth-library';
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
import {
  sendMagicLinkEmail,
  sendEmailVerification,
} from '../services/email.service.js';
import { generateToken } from '../utils/helpers.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ══════════════════════════════════════════════════════════════
//  REGISTER
//  Creates account with pending_verification status.
//  Sends verification email. If email already pending,
//  resends the verification instead of erroring.
// ══════════════════════════════════════════════════════════════
export const register = async (req, res, next) => {
  try {
    const { email, password, full_name } = req.body;

    const normalizedEmail = email.toLowerCase().trim();

    // ── 1. Check if email already exists ─────────────────────────
    const [existing] = await sql`
      SELECT id, status FROM users WHERE email = ${normalizedEmail}
    `;

    if (existing) {
      // If they registered but never verified, resend the email
      // rather than showing a confusing "already in use" error
      if (existing.status === 'pending_verification') {
        // Invalidate any old unused verification tokens
        await sql`
          DELETE FROM magic_link_tokens
          WHERE user_id  = ${existing.id}
            AND used_at IS NULL
        `;

        const rawToken  = generateToken(32);
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await sql`
          INSERT INTO magic_link_tokens (user_id, token_hash, expires_at, ip_address)
          VALUES (${existing.id}, ${tokenHash}, ${expiresAt}, ${req.ip})
        `;

        sendEmailVerification(normalizedEmail, full_name, rawToken)
          .catch(err =>
            console.error('[Register] Resend verify email failed:', err.message)
          );

        return res.status(200).json({
          success: true,
          message: 'Verification email resent. Please check your inbox.',
        });
      }

      return res.status(409).json({
        success: false,
        message: 'Email already in use',
      });
    }

    // ── 2. Hash the password ──────────────────────────────────────
    const password_hash = await bcrypt.hash(password, 12);

    // ── 3. Insert user with pending_verification status ───────────
    const [newUser] = await sql`
      INSERT INTO users (email, password_hash, full_name, role, status, auth_provider)
      VALUES (
        ${normalizedEmail},
        ${password_hash},
        ${full_name},
        'reader',
        'pending_verification',
        'email'
      )
      RETURNING id, email, full_name, role, status
    `;

    // ── 4. Create verification token (reuses magic_link_tokens) ───
    const rawToken  = generateToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await sql`
      INSERT INTO magic_link_tokens (user_id, token_hash, expires_at, ip_address)
      VALUES (${newUser.id}, ${tokenHash}, ${expiresAt}, ${req.ip})
    `;

    // ── 5. Send verification email (non-blocking) ─────────────────
    sendEmailVerification(normalizedEmail, full_name, rawToken)
      .catch(err =>
        console.error('[Register] Verification email failed:', err.message)
      );

    return res.status(201).json({
      success: true,
      message: 'Account created. Please check your email to verify your account.',
      data: {
        id:    newUser.id,
        email: newUser.email,
      },
    });

  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════
//  VERIFY EMAIL
//  Called when user clicks the link in their verification email.
//  Token lives in magic_link_tokens table.
//  On success: sets email_verified = TRUE, status = 'active'.
// ══════════════════════════════════════════════════════════════
export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required',
      });
    }

    const tokenHash = hashToken(token);

    // ── 1. Look up the token with user data ───────────────────────
    const [tokenRow] = await sql`
      SELECT
        mlt.*,
        u.id        AS user_id,
        u.email,
        u.full_name,
        u.role,
        u.status
      FROM magic_link_tokens mlt
      JOIN users u ON mlt.user_id = u.id
      WHERE mlt.token_hash = ${tokenHash}
    `;

    if (!tokenRow) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification link',
      });
    }

    // ── 2. Already used ───────────────────────────────────────────
    if (tokenRow.used_at) {
      return res.status(400).json({
        success: false,
        message: 'This verification link has already been used. Please sign in.',
      });
    }

    // ── 3. Expired ────────────────────────────────────────────────
    if (new Date(tokenRow.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'This verification link has expired. Please register again.',
      });
    }

    // ── 4. Already active (clicked link twice) ────────────────────
    if (tokenRow.status === 'active') {
      return res.status(200).json({
        success: true,
        message: 'Email already verified. You can sign in.',
      });
    }

    // ── 5. Mark token as used ─────────────────────────────────────
    await sql`
      UPDATE magic_link_tokens
      SET used_at = NOW()
      WHERE token_hash = ${tokenHash}
    `;

    // ── 6. Activate the user account ──────────────────────────────
    await sql`
      UPDATE users SET
        email_verified    = TRUE,
        email_verified_at = NOW(),
        status            = 'active'
      WHERE id = ${tokenRow.user_id}
    `;

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully. You can now sign in.',
    });

  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════
//  LOGIN
//  Email + password. Blocks unverified and suspended accounts.
//  Returns accessToken in body, refreshToken in httpOnly cookie.
// ══════════════════════════════════════════════════════════════
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // ── 1. Find user ──────────────────────────────────────────────
    const [user] = await sql`
      SELECT id, email, full_name, password_hash, role, status, email_verified
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
    `;

    // ── 2. Unknown email — same message as wrong password (security)
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // ── 3. Check password ─────────────────────────────────────────
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // ── 4. Block unverified accounts ──────────────────────────────
    // code field lets frontend show a specific "resend email" UI
    if (!user.email_verified || user.status === 'pending_verification') {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before signing in. Check your inbox.',
        code:    'EMAIL_NOT_VERIFIED',
      });
    }

    // ── 5. Block suspended accounts ───────────────────────────────
    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Contact support.',
      });
    }

    // ── 6. Update last login ──────────────────────────────────────
    await sql`
      UPDATE users
      SET last_login_at = NOW(),
          last_login_ip = ${req.ip},
          login_count   = login_count + 1
      WHERE id = ${user.id}
    `;

    // ── 7. Issue tokens ───────────────────────────────────────────
    const payload      = { id: user.id, role: user.role };
    const accessToken  = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    await saveRefreshToken(user.id, refreshToken, {
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

// ══════════════════════════════════════════════════════════════
//  GOOGLE AUTH
//  Verifies Google ID token, creates or links account,
//  auto-verifies email (Google guarantees this).
// ══════════════════════════════════════════════════════════════
export const googleAuth = async (req, res, next) => {
  try {
    const { id_token } = req.body;

    if (!id_token) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required',
      });
    }

    // ── 1. Verify token with Google ───────────────────────────────
    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken:  id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token',
      });
    }

    const gPayload = ticket.getPayload();
    const {
      sub:            googleId,
      email,
      name:           full_name,
      picture:        avatar_url,
      email_verified,
    } = gPayload;

    // Google only issues tokens for verified emails, but double-check
    if (!email_verified) {
      return res.status(400).json({
        success: false,
        message: 'Google account email is not verified',
      });
    }

    // ── 2. Find existing user by google_id or email ───────────────
    const [existingUser] = await sql`
      SELECT * FROM users
      WHERE google_id = ${googleId}
         OR email     = ${email.toLowerCase()}
      LIMIT 1
    `;

    let user;
    let isNewUser = false;

    if (!existingUser) {
      // ── 3a. Brand new user — create account ──────────────────────
      const [created] = await sql`
        INSERT INTO users
          (email, full_name, avatar_url, role, status,
           auth_provider, google_id, email_verified, email_verified_at)
        VALUES (
          ${email.toLowerCase()},
          ${full_name},
          ${avatar_url || null},
          'reader',
          'active',
          'google',
          ${googleId},
          TRUE,
          NOW()
        )
        RETURNING *
      `;

      user      = created;
      isNewUser = true;

    } else {
      // ── 3b. Existing user ─────────────────────────────────────────
      if (existingUser.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended. Contact support.',
        });
      }

      // Link Google ID if they previously signed up with email/password.
      // Also update avatar if they don't have one yet.
      // Also mark email as verified since Google guarantees it.
      await sql`
        UPDATE users SET
          google_id         = COALESCE(google_id,  ${googleId}),
          avatar_url        = COALESCE(avatar_url, ${avatar_url || null}),
          email_verified    = TRUE,
          email_verified_at = COALESCE(email_verified_at, NOW()),
          status            = CASE
                                WHEN status = 'pending_verification'
                                THEN 'active'
                                ELSE status
                              END,
          last_login_at     = NOW(),
          last_login_ip     = ${req.ip},
          login_count       = login_count + 1
        WHERE id = ${existingUser.id}
      `;

      // Re-fetch so we return fresh data
      const [refreshed] = await sql`
        SELECT * FROM users WHERE id = ${existingUser.id}
      `;
      user = refreshed;
    }

    // ── 4. Issue tokens ───────────────────────────────────────────
    const payload      = { id: user.id, role: user.role };
    const accessToken  = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

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
          id:         user.id,
          email:      user.email,
          full_name:  user.full_name,
          role:       user.role,
          avatar_url: user.avatar_url,
        },
      },
    });

  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════
//  REQUEST MAGIC LINK
//  Creates or finds user, generates single-use token,
//  sends login link via email.
// ══════════════════════════════════════════════════════════════
export const requestMagicLink = async (req, res, next) => {
  try {
    const { email, full_name } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // ── 1. Find or create user ────────────────────────────────────
    const [existingUser] = await sql`
      SELECT * FROM users WHERE email = ${normalizedEmail}
    `;

    let user;

    if (!existingUser) {
      // New user via magic link — auto-verified, active immediately
      const [created] = await sql`
        INSERT INTO users
          (email, full_name, role, status, auth_provider, email_verified, email_verified_at)
        VALUES (
          ${normalizedEmail},
          ${full_name || normalizedEmail.split('@')[0]},
          'reader',
          'active',
          'magic_link',
          TRUE,
          NOW()
        )
        RETURNING *
      `;
      user = created;
    } else {
      user = existingUser;

      // Silent success for suspended users — don't reveal account exists
      if (user.status === 'suspended') {
        return res.status(200).json({
          success: true,
          message: 'If this email is registered, a login link has been sent.',
        });
      }
    }

    // ── 2. Invalidate all existing unused tokens for this user ────
    await sql`
      DELETE FROM magic_link_tokens
      WHERE user_id = ${user.id}
        AND used_at IS NULL
    `;

    // ── 3. Create new token ───────────────────────────────────────
    const rawToken  = generateToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() +
      (parseInt(process.env.MAGIC_LINK_EXPIRES_MINUTES) || 15) * 60 * 1000
    );

    await sql`
      INSERT INTO magic_link_tokens (user_id, token_hash, expires_at, ip_address)
      VALUES (${user.id}, ${tokenHash}, ${expiresAt}, ${req.ip})
    `;

    // ── 4. Send email (non-blocking) ──────────────────────────────
    sendMagicLinkEmail(normalizedEmail, user.full_name, rawToken)
      .catch(err =>
        console.error('[Magic Link] Email send failed:', err.message)
      );

    // Always return the same message — don't reveal if email exists
    return res.status(200).json({
      success: true,
      message: 'If this email is registered, a login link has been sent.',
    });

  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════
//  VERIFY MAGIC LINK
//  Validates the token from the email link, logs the user in.
//  Also marks email as verified since they proved inbox access.
// ══════════════════════════════════════════════════════════════
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

    // ── 1. Look up token with user data in one query ──────────────
    const [tokenRow] = await sql`
      SELECT
        mlt.*,
        u.id         AS user_id,
        u.email,
        u.full_name,
        u.role,
        u.status,
        u.avatar_url
      FROM magic_link_tokens mlt
      JOIN users u ON mlt.user_id = u.id
      WHERE mlt.token_hash = ${tokenHash}
    `;

    if (!tokenRow) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired login link',
      });
    }

    // ── 2. Already used ───────────────────────────────────────────
    if (tokenRow.used_at) {
      return res.status(400).json({
        success: false,
        message: 'This login link has already been used. Request a new one.',
      });
    }

    // ── 3. Expired ────────────────────────────────────────────────
    if (new Date(tokenRow.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'This login link has expired. Request a new one.',
      });
    }

    // ── 4. Suspended ──────────────────────────────────────────────
    if (tokenRow.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Contact support.',
      });
    }

    // ── 5. Mark token as used ─────────────────────────────────────
    await sql`
      UPDATE magic_link_tokens
      SET used_at = NOW()
      WHERE token_hash = ${tokenHash}
    `;

    // ── 6. Mark email verified + update login stats ───────────────
    // Magic link proves inbox access, so auto-verify email
    await sql`
      UPDATE users SET
        email_verified    = TRUE,
        email_verified_at = COALESCE(email_verified_at, NOW()),
        status            = CASE
                              WHEN status = 'pending_verification'
                              THEN 'active'
                              ELSE status
                            END,
        last_login_at     = NOW(),
        last_login_ip     = ${req.ip},
        login_count       = login_count + 1
      WHERE id = ${tokenRow.user_id}
    `;

    // ── 7. Issue tokens ───────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════════
//  REFRESH TOKENS
//  Rotates the refresh token — old one is revoked, new pair issued.
//  Reads refresh token from httpOnly cookie or request body
//  (body fallback is for mobile clients).
// ══════════════════════════════════════════════════════════════
export const refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required',
      });
    }

    // ── 1. Verify signature ───────────────────────────────────────
    const decoded   = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    // ── 2. Check DB — not revoked, not expired ────────────────────
    const [stored] = await sql`
      SELECT * FROM refresh_tokens
      WHERE token_hash = ${tokenHash}
        AND revoked    = FALSE
        AND expires_at > NOW()
    `;

    if (!stored) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token invalid or expired',
      });
    }

    // ── 3. Revoke old token (rotation) ────────────────────────────
    await sql`
      UPDATE refresh_tokens
      SET revoked = TRUE, revoked_at = NOW()
      WHERE token_hash = ${tokenHash}
    `;

    // ── 4. Issue new pair ─────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════════
//  LOGOUT
//  Revokes all refresh tokens for the user and clears the cookie.
// ══════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════
//  GET ME
//  Returns the current authenticated user's profile.
//  Always fetches fresh from DB so suspended users are caught.
// ══════════════════════════════════════════════════════════════
export const getMe = async (req, res, next) => {
  try {
    const [user] = await sql`
      SELECT
        id, email, full_name, display_name,
        avatar_url, bio, role, status,
        email_verified, created_at, last_login_at
      FROM users
      WHERE id = ${req.user.id}
    `;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });

  } catch (err) {
    next(err);
  }
};