// ── Webhook Throttle ──────────────────────────────────────────────────────────
// Prevents duplicate n8n webhook calls for minor article edits.
// Uses an in-memory cooldown map (resets on server restart).

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const SIMILARITY_THRESHOLD = 0.9;    // 90% similar = skip

// articleId -> lastNotifiedTimestamp
const webhookCooldown = new Map();

export function isInCooldown(articleId) {
  const lastNotified = webhookCooldown.get(articleId);
  if (!lastNotified) return false;
  return Date.now() - lastNotified < COOLDOWN_MS;
}

export function markNotified(articleId) {
  webhookCooldown.set(articleId, Date.now());
}

// Jaccard similarity on word sets
export function calculateSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  if (text1 === text2) return 1;

  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(Boolean));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(Boolean));

  if (words1.size === 0 && words2.size === 0) return 1;
  if (words1.size === 0 || words2.size === 0) return 0;

  let intersectionSize = 0;
  for (const word of words1) {
    if (words2.has(word)) intersectionSize++;
  }

  const unionSize = words1.size + words2.size - intersectionSize;
  return unionSize === 0 ? 1 : intersectionSize / unionSize;
}

export function shouldThrottle(articleId, oldBodyText, newBodyText) {
  // Always allow first-time notifications (no previous content)
  if (!oldBodyText || !newBodyText) {
    return { throttle: false, reason: 'no_previous_content' };
  }

  // Check cooldown
  if (isInCooldown(articleId)) {
    return { throttle: true, reason: 'cooldown_active' };
  }

  // Check similarity
  const similarity = calculateSimilarity(oldBodyText, newBodyText);
  if (similarity >= SIMILARITY_THRESHOLD) {
    return { throttle: true, reason: `content_too_similar (${(similarity * 100).toFixed(1)}%)` };
  }

  return { throttle: false, reason: 'changes_significant_enough' };
}
