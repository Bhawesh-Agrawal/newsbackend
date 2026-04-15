// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache for the Express API layer.
//
// Uses a plain Map — no external dependencies, no Redis, no extra cost.
// Entries are evicted lazily on read (TTL check) and proactively by a
// 5-minute sweep interval to prevent unbounded memory growth.
//
// TTLs:
//   Article list    →  2 min   busy but acceptable staleness for archives
//   Article detail  →  10 min  rarely changes; very high read:write ratio
//   Trending        →  5 min   expensive GROUP BY query — cache aggressively
//   Categories      →  15 min  near-static
//
// Stale fallback:  if the DB throws, return the last known good value rather
// than a 500.  This is critical for Neon free-tier which can exhaust connections.
// ─────────────────────────────────────────────────────────────────────────────

export const TTL = {
  LIST:       2  * 60 * 1000,   // 2 min
  DETAIL:     10 * 60 * 1000,   // 10 min
  TRENDING:   5  * 60 * 1000,   // 5 min
  CATEGORIES: 15 * 60 * 1000,   // 15 min
}

const store = new Map()  // key → { data, expiresAt }

function get(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.data
}

function set(key, data, ttl) {
  store.set(key, { data, expiresAt: Date.now() + ttl })
}

// Like get() but returns stale data instead of null — used as DB-error fallback.
function getStale(key) {
  return store.get(key)?.data ?? null
}

function invalidate(keyPrefix) {
  for (const key of store.keys()) {
    if (key.startsWith(keyPrefix)) store.delete(key)
  }
}

// Wrap an async DB call with cache-first + stale fallback.
// Returns cached data without hitting the DB if available.
// On DB error, returns the last known value (even if expired) rather than
// crashing.
async function wrap(key, fetcher , ttl ) {
  const hit = get(key)
  if (hit !== null) return hit

  try {
    const data = await fetcher()
    set(key, data, ttl)
    return data
  } catch (err) {
    const stale = getStale(key)
    if (stale !== null) {
      console.warn(`[cache] DB error for "${key}", serving stale data. ${err.message}`)
      return stale
    }
    throw err  // No stale data — must propagate
  }
}

// Proactive sweep every 5 min — evicts expired keys to keep memory lean
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key)
  }
}, 5 * 60 * 1000)

export const memCache = { get, set, getStale, invalidate, wrap }