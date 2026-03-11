import { verifyAccessToken } from '../services/jwt.service.js';
import sql from '../config/database.js';

export const authenticate = async (req, res, next) => {
  try {
    // 1. Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided',
      });
    }

    // 2. Extract just the token part
    const token = authHeader.split(' ')[1];

    // 3. Verify the signature and expiry
    const decoded = verifyAccessToken(token);

    // 4. Check user still exists and is active
    const users = await sql`
      SELECT id, email, full_name, role, status
      FROM users
      WHERE id = ${decoded.id}
    `;

    const user = users[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Account suspended',
      });
    }

    // 5. Attach user to request object
    req.user = user;

    // 6. Pass control to the route handler
    next();

  } catch (err) {
    // jwt.verify throws specific errors we can handle cleanly
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
      });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    next(err);
  }
};
export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success:false,
                message: 'Not Authenticated',
            });
        }

        if (!roles.includes(req.user.role)){
            return res.status(403).json({
                success:false,
                message: 'You do not have permission to do this',
            });
        }

        next();
    }
}

export const isSuperAdmin = authorize('super_admin');
export const isEditor = authorize('super_admin', 'editor');
export const isAuthor = authorize('super_admin', 'editor', 'author');

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const users = await sql`
      SELECT id, email, full_name, role, status
      FROM users WHERE id = ${decoded.id} AND status = 'active'
    `;

    req.user = users[0] || null;
  } catch {
    req.user = null;
  }

  next();
};