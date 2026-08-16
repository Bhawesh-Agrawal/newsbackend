import 'dotenv/config';
import express       from 'express';
import helmet        from 'helmet';
import cookieParser  from 'cookie-parser';

process.env.TZ = 'Asia/Kolkata';

import sql                          from './config/database.js';
import { errorHandler, notFound }   from './middleware/error.middleware.js';
import { globalLimiter }            from './middleware/ratelimit.middleware.js';
import { startScheduler }           from './jobs/scheduler.js';

import authRoutes       from './routes/auth.routes.js';
import articlesRoutes   from './routes/articles.routes.js';
import commentsRoutes   from './routes/comments.routes.js';
import newsletterRoutes from './routes/newsletter.routes.js';
import adminRoutes      from './routes/admin.routes.js';
import uploadRoutes     from './routes/upload.routes.js';
import savedRoutes      from './routes/saved.routes.js';
import profileRoutes    from './routes/profile.routes.js';
import homeRoutes       from './routes/home.routes.js';
import shortStoryRoutes from './routes/shortStory.routes.js';
import videoArticleRoutes from './routes/videoArticle.routes.js';
import analyticsV2Routes from './routes/analytics-v2.routes.js';
import analyticsV3Routes from './routes/analytics-v3.routes.js';

import { authenticate }                        from './middleware/auth.middleware.js';
import { isEditor, isSuperAdmin, isAuthor }    from './middleware/auth.middleware.js';

import { getMarketData } from './controllers/market.controller.js';
import {
  getPublicShortStories,
  getPublicShortStoryBySlug,
  getShortStoriesSitemap,
} from './controllers/shortStory.controller.js';

import cors from 'cors';

import { memCache } from './utils/memCache.js';

// ── Bot renderer — used by /meta/* routes below ───────────────
import {
  renderArticleMeta,
  renderCategoryMeta,
} from './middleware/botrender.middleware.js';

const app  = express();
const PORT = process.env.PORT || 5000;
const API  = '/api/v1';

const allowedOrigins = [
  'https://www.mangopeoplenews.com',
  'https://mangopeoplenews.com',
  'http://localhost:3000',
  'https://beta.mangopeoplenews.com',
];

app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Security headers ──────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      [
        "'self'",
        "'unsafe-inline'",
        'https://accounts.google.com',
        'https://challenges.cloudflare.com',
      ],
      frameSrc:       [
        'https://challenges.cloudflare.com',
        'https://accounts.google.com',
      ],
      connectSrc:     [
        "'self'",
        'https://accounts.google.com',
        'https://challenges.cloudflare.com',
      ],
      imgSrc:         ["'self'", 'data:', 'https:'],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      fontSrc:        ["'self'", 'https:', 'data:'],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// ── Trust proxy ───────────────────────────────────────────────────
app.set('trust proxy', 1);

// ── Request parsing ───────────────────────────────────────────────
const isUploadRoute = (req) =>
  req.path.endsWith('/avatar') || req.path.endsWith('/cover');

// Prevent search engines from indexing raw JSON API responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

app.use((req, res, next) => {
  if (isUploadRoute(req)) return next();
  express.json({ limit: '10mb' })(req, res, next);
});

app.use((req, res, next) => {
  if (isUploadRoute(req)) return next();
  express.urlencoded({ extended: true })(req, res, next);
});

app.use(cookieParser());

// ── Global rate limit ─────────────────────────────────────────────
app.use(API, globalLimiter);

// ── Health check ──────────────────────────────────────────────────

let dbConnected = false;
sql`SELECT 1`.then(() => { dbConnected = true }).catch(() => {});

app.get(`${API}/health`, (req, res) => {
  res.json({
    status:    dbConnected ? 'ok' : 'degraded',
    database:  dbConnected ? 'connected' : 'unknown',
    uptime:    Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

setInterval(() => {
  sql`SELECT 1`.then(() => { dbConnected = true }).catch(() => { dbConnected = false });
}, 5 * 60 * 1000);

app.get(`${API}/market/quotes`, getMarketData);
app.use(`${API}/home`, homeRoutes);

// ── Bot / OG meta renderer ────────────────────────────────────────
//
// Vercel rewrites bots hitting /article/:slug  → /meta/article/:slug
//                               /category/:slug → /meta/category/:slug
//
// These routes must be:
//   • Outside the /api/v1 prefix (no auth, no rate-limit, no JSON body-parser)
//   • Before the notFound handler
//   • Returning text/html so WhatsApp / Facebook / Telegram can parse OG tags
//
// They do NOT need CORS headers because bots never send Origin headers.
// Helmet is still applied (sets safe defaults), which is fine for HTML pages.

app.get('/meta/article/:slug',  renderArticleMeta);
app.get('/meta/category/:slug', renderCategoryMeta);

// ── API Routes ────────────────────────────────────────────────────
app.use(`${API}/auth`,       authRoutes);
app.use(`${API}/articles`,   articlesRoutes);
app.use(`${API}/videos`,     videoArticleRoutes);
app.use(`${API}/comments`,   commentsRoutes);
app.use(`${API}/newsletter`, newsletterRoutes);
app.use(`${API}/admin/v3`,           analyticsV3Routes);
app.use(`${API}/admin/v2`,           analyticsV2Routes);
app.use(`${API}/admin/mango-bites`, shortStoryRoutes);
app.use(`${API}/admin`,              adminRoutes);
app.use(`${API}/uploads`,    uploadRoutes);
app.use(`${API}/users`,      authenticate, savedRoutes);
app.use(`${API}/profile`,    authenticate, profileRoutes);

// ── Public Mango Bites (no auth) ──────────────────────────────────
app.get(`${API}/mango-bites`, getPublicShortStories);
app.get(`${API}/mango-bites-sitemap`, getShortStoriesSitemap);
app.get(`${API}/mango-bites/:slug`, getPublicShortStoryBySlug);

// ── Tags — simple CRUD ────────────────────────────────────────────
app.get(`${API}/tags`, async (req, res, next) => {
  try {
    const data = await memCache.wrap(
      'tags:all',
      () => sql`
        SELECT t.id, t.name, t.slug, COUNT(at.article_id)::int AS article_count
        FROM tags t
        LEFT JOIN article_tags at ON t.id = at.tag_id
        GROUP BY t.id
        ORDER BY t.name ASC
      `,
      10 * 60 * 1000
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
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

// ── Categories ────────────────────────────────────────────────────
app.get(`${API}/categories`, async (req, res, next) => {
  try {
    const data = await memCache.wrap(
      'categories:all',
      () => sql`
        SELECT
          id, name, slug, description, color, sort_order,
          (
            SELECT COUNT(*)::int FROM articles
            WHERE category_id = categories.id AND status = 'published'
          ) AS article_count
        FROM categories
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, name ASC
      `,
      15 * 60 * 1000
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

app.get(`${API}/categories/admin`, authenticate, isSuperAdmin, async (req, res, next) => {
  try {
    const data = await memCache.wrap(
      'categories:admin',
      () => sql`
        SELECT
          id, name, slug, description, color, sort_order, is_active,
          (
            SELECT COUNT(*)::int FROM articles
            WHERE category_id = categories.id AND status = 'published'
          ) AS article_count
        FROM categories
        ORDER BY sort_order ASC, name ASC
      `,
      15 * 60 * 1000
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

app.post(`${API}/categories`, authenticate, isSuperAdmin, async (req, res, next) => {
  try {
    const { name, color = '#6366f1', sort_order = 0 } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

    const slug = name.toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');

    const result = await sql`
      INSERT INTO categories (name, slug, color, sort_order, is_active)
      VALUES (${name}, ${slug}, ${color}, ${sort_order}, TRUE)
      RETURNING *
    `;
    memCache.invalidate('categories:all');
    memCache.invalidate('categories:admin');
    res.status(201).json({ success: true, data: result[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'A category with this name already exists' });
    }
    next(err);
  }
});

app.put(`${API}/categories/:id`, authenticate, isSuperAdmin, async (req, res, next) => {
  try {
    const { name, color, sort_order, is_active } = req.body;
    const result = await sql`
      UPDATE categories SET
        name       = COALESCE(${name       || null}, name),
        color      = COALESCE(${color      || null}, color),
        sort_order = COALESCE(${sort_order ?? null}, sort_order),
        is_active  = COALESCE(${is_active  ?? null}, is_active)
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    if (!result.length) return res.status(404).json({ success: false, message: 'Category not found' });

    if (is_active === true) {
      await sql`
        UPDATE articles SET status = archived_from_status, archived_from_status = NULL
        WHERE category_id = ${req.params.id} AND archived_from_status IS NOT NULL
      `;
    }

    memCache.invalidate('categories:all');
    memCache.invalidate('categories:admin');
    res.json({ success: true, data: result[0] });
  } catch (err) { next(err); }
});

app.delete(`${API}/categories/:id`, authenticate, isSuperAdmin, async (req, res, next) => {
  try {
    const result = await sql`
      UPDATE categories SET is_active = FALSE
      WHERE id = ${req.params.id} AND is_active = TRUE
      RETURNING id, name
    `;
    if (!result.length) return res.status(404).json({ success: false, message: 'Category not found' });

    const archived = await sql`
      UPDATE articles SET status = 'archived', archived_from_status = status
      WHERE category_id = ${req.params.id} AND status != 'archived'
    `;

    memCache.invalidate('categories:all');
    memCache.invalidate('categories:admin');
    res.json({ success: true, message: `Category "${result[0].name}" archived`, data: { archivedCount: archived.count } });
  } catch (err) { next(err); }
});

// ── 404 + error handling — always last ───────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  startScheduler();
});

// ── Graceful shutdown ─────────────────────────────────────────────
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
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
