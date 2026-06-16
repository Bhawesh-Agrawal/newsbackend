import cron from 'node-cron';
import sql from '../config/database.js';
import { submitToIndexNow } from '../utils/indexnow.js';
import { memCache } from '../utils/memCache.js';

// ── Publish scheduled articles ────────────────────────────────────
// Runs every minute
const publishScheduledArticles = async () => {
  try {
    const published = await sql`
      UPDATE articles
      SET
        status       = 'published',
        published_at = NOW(),
        featured_at  = CASE WHEN is_featured = TRUE THEN NOW() ELSE featured_at END,
        breaking_at  = CASE WHEN is_breaking = TRUE THEN NOW() ELSE breaking_at END
      WHERE status       = 'scheduled'
        AND scheduled_at <= NOW()
      RETURNING id, slug, title, scheduled_at
    `;

    if (published.length > 0) {
      console.log(`[Scheduler] Published ${published.length} scheduled articles:`);
      published.forEach(a => {
        console.log(`  - "${a.title}" (was scheduled for ${a.scheduled_at})`)
        submitToIndexNow(a.slug)
      });
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

// ── Expire featured / breaking after 48 hours ─────────────────────
// Runs every hour
const expireFeaturedBreaking = async () => {
  try {
    let total = 0;

    const featured = await sql`
      UPDATE articles
      SET is_featured = FALSE
      WHERE is_featured = TRUE
        AND featured_at IS NOT NULL
        AND featured_at <= NOW() - INTERVAL '48 hours'
    `;
    total += featured.count;

    const breaking = await sql`
      UPDATE articles
      SET is_breaking = FALSE
      WHERE is_breaking = TRUE
        AND breaking_at IS NOT NULL
        AND breaking_at <= NOW() - INTERVAL '48 hours'
    `;
    total += breaking.count;

    if (total > 0) {
      console.log(`[Scheduler] Expired featured/breaking flags for ${total} articles`);
      memCache.invalidate('articles:');
      memCache.invalidate('stats:');
      memCache.invalidate('trending:');
    }
  } catch (err) {
    console.error('[Scheduler] Failed to expire featured/breaking:', err.message);
  }
};

// ── Start all jobs ────────────────────────────────────────────────
export const startScheduler = () => {
  // Every minute — '* * * * *'
  cron.schedule('* * * * *', publishScheduledArticles);

  // Every day at 2am — '0 2 * * *'
  cron.schedule('0 2 * * *', cleanExpiredTokens);

  // Every hour — '0 * * * *'
  cron.schedule('0 * * * *', expireFeaturedBreaking);

  console.log('[Scheduler] Background jobs started');
};

cron.schedule('0 3 * * *', async () => {
  try {
    await sql`
      DELETE FROM magic_link_tokens
      WHERE expires_at < NOW()
         OR used_at IS NOT NULL
    `;
    console.log('[Scheduler] Cleaned magic link tokens');
  } catch (err) {
    console.error('[Scheduler] Magic link cleanup failed:', err.message);
  }
});