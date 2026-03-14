import cron from 'node-cron';
import sql from '../config/database.js';

// ── Publish scheduled articles ────────────────────────────────────
// Runs every minute
const publishScheduledArticles = async () => {
  try {
    const published = await sql`
      UPDATE articles
      SET
        status       = 'published',
        published_at = NOW()
      WHERE status       = 'scheduled'
        AND scheduled_at <= NOW()
      RETURNING id, title, scheduled_at
    `;

    if (published.length > 0) {
      console.log(`[Scheduler] Published ${published.length} scheduled articles:`);
      published.forEach(a =>
        console.log(`  - "${a.title}" (was scheduled for ${a.scheduled_at})`)
      );
    }
  } catch (err) {
    console.error('[Scheduler] Failed to publish scheduled articles:', err.message);
  }
};

// ── Clean expired tokens ──────────────────────────────────────────
// Runs every day at 2am
const cleanExpiredTokens = async () => {
  try {
    const result = await sql`
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW()
        OR revoked     = TRUE
    `;

    console.log(`[Scheduler] Cleaned expired refresh tokens`);
  } catch (err) {
    console.error('[Scheduler] Token cleanup failed:', err.message);
  }
};

// ── Start all jobs ────────────────────────────────────────────────
export const startScheduler = () => {
  // Every minute — '* * * * *'
  cron.schedule('* * * * *', publishScheduledArticles);

  // Every day at 2am — '0 2 * * *'
  cron.schedule('0 2 * * *', cleanExpiredTokens);

  console.log('[Scheduler] Background jobs started');
};