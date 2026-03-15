import { Router } from 'express';
import {
  getDashboardStats,
  getArticleAnalytics,
} from '../controllers/analytics.controller.js';
import {
  getUsers,
  updateUserRole,
  updateUserStatus,
  getAdminArticles,
  getSettings,
  updateSettings,
} from '../controllers/admin.controller.js';
import {
  authenticate,
  isEditor,
  isSuperAdmin,
} from '../middleware/auth.middleware.js';

const router = Router();

// All admin routes require authentication
router.use(authenticate);

// Editor and above
router.get('/stats',              isEditor,     getDashboardStats);
router.get('/analytics/:id',      isEditor,     getArticleAnalytics);
router.get('/articles',           isEditor,     getAdminArticles);

// Super admin only
router.get('/users',              isSuperAdmin, getUsers);
router.patch('/users/:id/role',   isSuperAdmin, updateUserRole);
router.patch('/users/:id/status', isSuperAdmin, updateUserStatus);

router.get('/settings',  isSuperAdmin, getSettings);
router.patch('/settings', isSuperAdmin, updateSettings);

export default router;