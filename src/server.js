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

const app  = express();
const PORT = process.env.PORT || 5000;
const API  = '/api/v1';

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