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
  getHeroPins,
  addHeroPin,
  reorderHeroPins,
  removeHeroPin,
  getCategoryPins,
  addCategoryPin,
  removeCategoryPin,
  searchArticles,
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
router.get('/articles/search',    isEditor,     searchArticles);

// Hero pin management
router.get('/home/hero-pins',     isEditor,     getHeroPins);
router.post('/home/hero-pins',    isEditor,     addHeroPin);
router.put('/home/hero-pins',     isEditor,     reorderHeroPins);
router.delete('/home/hero-pins/:id', isEditor,  removeHeroPin);

// Category pin management
router.get('/home/category-pins',   isEditor,   getCategoryPins);
router.post('/home/category-pins',  isEditor,   addCategoryPin);
router.delete('/home/category-pins/:id', isEditor, removeCategoryPin);

// Super admin only
router.get('/users',              isSuperAdmin, getUsers);
router.patch('/users/:id/role',   isSuperAdmin, updateUserRole);
router.patch('/users/:id/status', isSuperAdmin, updateUserStatus);

router.get('/settings',  isSuperAdmin, getSettings);
router.patch('/settings', isSuperAdmin, updateSettings);

export default router;