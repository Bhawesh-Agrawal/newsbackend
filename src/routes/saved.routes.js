// src/routes/saved.routes.js
// Mount in server.js as: app.use('/api/v1/users', savedRouter)

import { Router } from 'express'
import { authenticate } from '../middleware/auth.middleware.js'
import {
  getSaved,
  saveArticle,
  unsaveArticle,
  getSaveStatus,
} from '../controllers/saved.controller.js'

const router = Router()

// All saved routes require a logged-in user
router.use(authenticate)

router.get   ('/me/saved',                   getSaved)
router.post  ('/me/saved',                   saveArticle)
router.delete('/me/saved/:articleId',        unsaveArticle)
router.get   ('/me/saved/:articleId/status', getSaveStatus)

export default router