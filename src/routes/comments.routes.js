import { Router } from 'express';
import {
  createComment, getComments, getCommentQueue,
  moderateComment, deleteComment,
} from '../controllers/comment.controller.js';
import { authenticate, isEditor } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createCommentValidator,
  moderateCommentValidator,
} from '../validators/comment.validator.js';

const router = Router();

router.get('/article/:article_id',   getComments);
router.post('/',                      authenticate, createCommentValidator, validate, createComment);
router.delete('/:id',                 authenticate, deleteComment);
router.get('/queue',                  authenticate, isEditor, getCommentQueue);
router.patch('/:id/moderate',         authenticate, isEditor, moderateCommentValidator, validate, moderateComment);

export default router;