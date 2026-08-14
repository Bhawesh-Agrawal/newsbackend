import { Router } from 'express';
import {
  getDashboardKPIs,
  getDashboardTrend,
  getTopArticles,
  getDecliningArticles,
  getOpportunities,
  getHealth,
  getAnalyticsOverview,
  getAnalyticsArticles,
  getGSCQueries,
  getGSCPages,
  getGSCOpportunities,
  getOperationsRequests,
  getOperationsErrors,
  getOperationsHealth,
} from '../controllers/dashboard-v2.controller.js';
import {
  authenticate,
  isEditor,
} from '../middleware/auth.middleware.js';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(isEditor);

// Dashboard
router.get('/dashboard/kpis', getDashboardKPIs);
router.get('/dashboard/trend', getDashboardTrend);
router.get('/dashboard/top-articles', getTopArticles);
router.get('/dashboard/declining', getDecliningArticles);
router.get('/dashboard/opportunities', getOpportunities);
router.get('/dashboard/health', getHealth);

// Analytics
router.get('/analytics/overview', getAnalyticsOverview);
router.get('/analytics/articles', getAnalyticsArticles);

// Search Console
router.get('/gsc/queries', getGSCQueries);
router.get('/gsc/pages', getGSCPages);
router.get('/gsc/opportunities', getGSCOpportunities);

// Operations
router.get('/operations/requests', getOperationsRequests);
router.get('/operations/errors', getOperationsErrors);
router.get('/operations/health', getOperationsHealth);

export default router;
