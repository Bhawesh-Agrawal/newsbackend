import 'dotenv/config';
import express       from 'express';
import helmet        from 'helmet';
import cookieParser  from 'cookie-parser';

import sql                          from './config/database.js';
import { errorHandler, notFound }   from './middleware/error.middleware.js';
import { globalLimiter }            from './middleware/ratelimit.middleware.js';
import { startScheduler }           from './jobs/scheduler.js';

import authRoutes       from './routes/auth.routes.js';
import articlesRoutes   from './routes/articles.routes.js';
import commentsRoutes   from './routes/comments.routes.js';
import newsletterRoutes from './routes/newsletter.routes.js';
import adminRoutes      from './routes/admin.routes.js';
import uploadRoutes from './routes/upload.routes.js';

import { authenticate } from './middleware/auth.middleware.js';
import { isEditor, isSuperAdmin, isAuthor } from './middleware/auth.middleware.js';

import cors from 'cors';

const app  = express();
const PORT = process.env.PORT || 5000;
const API  = '/api/v1';

app.use(cors({
  origin:      process.env.FRONTEND_URL,  // only your frontend domain
  credentials: true,                       // required for cookies to work
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));

// ── Security headers ──────────────────────────────────────────────
app.use(helmet());

// ── Trust proxy ───────────────────────────────────────────────────
// Required when deployed behind Nginx, Railway, Render etc.
// Makes req.ip return the real client IP instead of proxy IP
app.set('trust proxy', 1);

// ── Request parsing ───────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Global rate limit ─────────────────────────────────────────────
app.use(API, globalLimiter);

// ── Health check ──────────────────────────────────────────────────
app.get(`${API}/health`, async (req, res) => {
  try {
    await sql`SELECT 1`;
    res.json({
      status:    'ok',
      database:  'connected',
      uptime:    Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', database: err.message });
  }
});

// ── Routes ────────────────────────────────────────────────────────
app.use(`${API}/auth`,       authRoutes);
app.use(`${API}/articles`,   articlesRoutes);
app.use(`${API}/comments`,   commentsRoutes);
app.use(`${API}/newsletter`, newsletterRoutes);
app.use(`${API}/admin`,      adminRoutes);
app.use(`${API}/upload`, uploadRoutes);

// ── 404 + error handling — always last ───────────────────────────
app.use(notFound);
app.use(errorHandler);


//temp fix

// Tags — simple CRUD
app.get(`${API}/tags`, async (req, res) => {
  const tags = await sql`
    SELECT t.*, COUNT(at.article_id)::int AS article_count
    FROM tags t
    LEFT JOIN article_tags at ON t.id = at.article_id
    GROUP BY t.id
    ORDER BY t.name ASC
  `;
  res.json({ success: true, data: tags });
});

app.post(`${API}/tags`, authenticate, isEditor, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name required' });
    const slug = generateSlug(name);
    const result = await sql`
      INSERT INTO tags (name, slug) VALUES (${name}, ${slug})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING *
    `;
    res.status(201).json({ success: true, data: result[0] });
  } catch (err) { next(err); }
});

app.delete(`${API}/tags/:id`, authenticate, isSuperAdmin, async (req, res, next) => {
  try {
    await sql`DELETE FROM tags WHERE id = ${req.params.id}`;
    res.json({ success: true, message: 'Tag deleted' });
  } catch (err) { next(err); }
});

app.put(`${API}/categories/:id`, authenticate, isSuperAdmin, async (req, res, next) => {
  try {
    const { name, color, sort_order, is_active } = req.body;
    const result = await sql`
      UPDATE categories SET
        name       = COALESCE(${name || null}, name),
        color      = COALESCE(${color || null}, color),
        sort_order = COALESCE(${sort_order ?? null}, sort_order),
        is_active  = COALESCE(${is_active ?? null}, is_active)
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    if (result.length === 0)
      return res.status(404).json({ success: false, message: 'Category not found' });
    res.json({ success: true, data: result[0] });
  } catch (err) { next(err); }
});

// ── Start server ──────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  startScheduler();
});

// ── Graceful shutdown ─────────────────────────────────────────────
// When server gets SIGTERM (from Railway, Docker, etc.)
// finish handling current requests before closing
const shutdown = async (signal) => {
  console.log(`\n${signal} received — shutting down gracefully`);

  server.close(async () => {
    console.log('HTTP server closed');

    try {
      await sql.end();
      console.log('Database connections closed');
    } catch (err) {
      console.error('Error closing database:', err.message);
    }

    process.exit(0);
  });

  // Force quit after 10 seconds if still waiting
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));