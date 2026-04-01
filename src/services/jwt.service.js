import jwt    from 'jsonwebtoken';
import crypto from 'crypto';
import sql    from '../config/database.js';

export const signAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

export const signRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  });
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

export const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const saveRefreshToken = async (userId, token, meta = {}) => {
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await sql`
    INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
    VALUES (
      ${userId},
      ${tokenHash},
      ${meta.userAgent || null},
      ${meta.ipAddress || null},
      ${expiresAt}
    )
    ON CONFLICT (token_hash) DO NOTHING
  `;
};

export const revokeAllUserTokens = async (userId) => {
  await sql`
    UPDATE refresh_tokens
    SET revoked = TRUE, revoked_at = NOW()
    WHERE user_id = ${userId} AND revoked = FALSE
  `;
};

export const setRefreshTokenCookie = (res, refreshToken) => {
  const isProd = process.env.NODE_ENV === 'production';

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure:   isProd,                        // must be true when sameSite=none
    sameSite: isProd ? 'none' : 'lax',       // 'none' for cross-site, 'lax' for local dev
    // domain: intentionally omitted — browser infers it correctly
    maxAge:   7 * 24 * 60 * 60 * 1000,      // 7 days in ms
  });
};

export const clearRefreshTokenCookie = (res) => {
  const isProd = process.env.NODE_ENV === 'production';

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure:   isProd,
    sameSite: isProd ? 'none' : 'lax',   // must match set options exactly
  });
};