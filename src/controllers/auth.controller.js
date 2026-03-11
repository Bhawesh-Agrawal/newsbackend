import bcrypt from 'bcryptjs';
import sql from '../config/database.js';
import {
  signAccessToken,
  signRefreshToken,
  saveRefreshToken,
  verifyRefreshToken,
  hashToken,
  revokeAllUserTokens,
  verifyAccessToken,
} from '../services/jwt.service.js';

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

    // 8. Send response
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
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
    const { refreshToken } = req.body;

    if (!refreshToken){
      return res.status(401).json({
        success : false,
        message : 'Refresh token required!!',
      })
    }

    const decoded = verifyRefreshToken(refreshToken);

    const tokenHash = hashToken(refreshToken);

    const tokens = await sql`
      SELECT * FROM refresh_tokens
      WHERE token_hash = ${tokenHash}
      AND revoked = FALSE
      AND expires_at > NOW()
    `;

    if (tokens.length === 0){
      return res.status(401).json({
        success:false,
        message: 'Refresh token Invalid or expired',
      })
    }

    await sql`
      UPDATE refresh_tokens
      SET revoked = TRUE, revoked_at = NOW()
      WHERE token_hash = ${tokenHash}
    `;


    const payload = { id: decoded.id, role: decoded.role};
    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);

    await saveRefreshToken(decoded.id, newRefreshToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      data : {
        accessToken : newAccessToken,
        refreshToken : newRefreshToken,
      },
    });


  }catch(err){
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError'){
      return res.status(401).json({
        success: false,
        message : 'Invalid refresh token',
      });
    }

    next(err);
  }
}

export const logout = async (req, res, next) => {
  try{
    await revokeAllUserTokens(req.user.id);

    return res.status(200).json({
      success:true,
      message : 'Logged out successfully',
    })
  }catch(err){
    next(err);
  }
};