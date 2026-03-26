/**
 * automod.js — Comment auto-moderation for Mango People News
 *
 * Philosophy:
 *   - Auto-approve clean, normal comments immediately (no queue friction)
 *   - Send borderline content to the pending queue for human review
 *   - Hard-block obvious spam silently (never stored in DB)
 *
 * Returns: { status: 'approved' | 'pending' | 'spam', reason?: string }
 *
 * Rules are ordered by severity — first match wins.
 */

// ── Hard spam signals — instant block, never stored ───────────────────────────

/** Matches 2+ bare URLs in a comment (classic spam/link-farm pattern) */
const URL_PATTERN = /https?:\/\/[^\s]+/gi;

/** Phone numbers in common Indian + international formats */
const PHONE_PATTERN =
  /(\+91[\s-]?)?[6-9]\d{9}|(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

/** WhatsApp/Telegram solicitation */
const MESSAGING_SOLICIT =
  /\b(whatsapp|telegram|wa\.me|t\.me)\b.*\b(me|contact|join|group|chat)\b/i;

/** Guaranteed returns / investment fraud language */
const INVESTMENT_FRAUD =
  /\b(guaranteed\s+(profit|return|income)|(\d+)%\s+(daily|weekly|monthly)\s+(profit|return)|make\s+money\s+fast|earn\s+from\s+home|binary\s+options?|crypto\s+signal)\b/i;

/** Repeated characters (aaaaaa / !!!!!!!) — keyboard spam */
const REPEATED_CHARS = /(.)\1{9,}/;

/** All-caps messages over 20 chars (shouting / rage-bait) */
const ALL_CAPS_LONG = /^[A-Z\s\d!?.,'"-]{20,}$/;


// ── Pending signals — human review needed ─────────────────────────────────────

/** Single URL — could be a legitimate source citation */
const SINGLE_URL = /https?:\/\/[^\s]+/i;

/** Contains an email address */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** Profanity / slurs — rough list, extend as needed */
const PROFANITY_PATTERN =
  /\b(fuck|shit|bastard|bitch|asshole|motherfucker|bhenchod|madarchod|chutiya|gaandu|randi|saala)\b/i;

/** Very short comment — may be meaningless noise */
const MIN_LENGTH = 3;

/** Very long comment — unusual, worth a human check */
const MAX_AUTO_APPROVE_LENGTH = 1500;


// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {string} body - The raw comment text from the user
 * @returns {{ status: 'approved' | 'pending' | 'spam', reason?: string }}
 */
export function automod(body) {
  if (typeof body !== 'string') {
    return { status: 'spam', reason: 'invalid_body' };
  }

  const text    = body.trim();
  const length  = text.length;

  // ── Structural checks ──────────────────────────────────────────
  if (length < MIN_LENGTH) {
    return { status: 'pending', reason: 'too_short' };
  }

  // ── Hard spam checks ──────────────────────────────────────────
  const urlMatches = text.match(URL_PATTERN) || [];
  if (urlMatches.length >= 2) {
    return { status: 'spam', reason: 'multiple_urls' };
  }

  const phoneMatches = text.match(PHONE_PATTERN) || [];
  if (phoneMatches.length > 0) {
    return { status: 'spam', reason: 'phone_number' };
  }

  if (MESSAGING_SOLICIT.test(text)) {
    return { status: 'spam', reason: 'messaging_solicitation' };
  }

  if (INVESTMENT_FRAUD.test(text)) {
    return { status: 'spam', reason: 'investment_fraud' };
  }

  if (REPEATED_CHARS.test(text)) {
    return { status: 'spam', reason: 'repeated_chars' };
  }

  // ── Pending review checks ──────────────────────────────────────
  if (urlMatches.length === 1) {
    return { status: 'pending', reason: 'contains_url' };
  }

  if (EMAIL_PATTERN.test(text)) {
    return { status: 'pending', reason: 'contains_email' };
  }

  if (PROFANITY_PATTERN.test(text)) {
    return { status: 'pending', reason: 'profanity' };
  }

  if (ALL_CAPS_LONG.test(text)) {
    return { status: 'pending', reason: 'all_caps' };
  }

  if (length > MAX_AUTO_APPROVE_LENGTH) {
    return { status: 'pending', reason: 'too_long' };
  }

  // ── Clean — auto-approve ──────────────────────────────────────
  return { status: 'approved' };
}