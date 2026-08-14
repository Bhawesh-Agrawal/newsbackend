import sql from '../config/database.js';

const OPENSEO_BASE_URL = 'https://app.openseo.so/api';
const API_KEY = process.env.OPENSEO_API_KEY;

// ── Credit tracking ──────────────────────────────────────────────────────────
const CREDIT_COSTS = {
  keyword_search: 0.05,
  domain_overview: 0.08,
  rank_check: 0.01,
  backlink_check: 0.08,
  ai_brand_check: 1.09,
};

const MIN_REMAINING_CREDITS = 1.0; // Stop calling API when credits drop below this

let creditBalance = 10.0; // Default monthly allocation
let creditResetDate = new Date();

async function logCreditUsage(operation, credits, success, errorMessage = null) {
  try {
    await sql`
      INSERT INTO openseo_credit_log (operation, credits_used, success, error_message)
      VALUES (${operation}, ${credits}, ${success}, ${errorMessage})
    `;
  } catch (err) {
    console.error('[OpenSEO] Credit log error:', err.message);
  }
}

async function getCreditUsageThisMonth() {
  try {
    const result = await sql`
      SELECT COALESCE(SUM(credits_used), 0)::FLOAT AS total_used
      FROM openseo_credit_log
      WHERE created_at >= DATE_TRUNC('month', NOW())
        AND success = TRUE
    `;
    return result[0]?.total_used || 0;
  } catch {
    return 0;
  }
}

function hasEnoughCredits(operation) {
  const cost = CREDIT_COSTS[operation] || 0.05;
  const used = creditBalance; // Will be recalculated on next check
  return (10.0 - used) >= cost;
}

// ── Cache layer ──────────────────────────────────────────────────────────────
async function getCached(cacheKey) {
  try {
    const result = await sql`
      SELECT data, credits_used FROM seo_cache
      WHERE cache_key = ${cacheKey}
        AND expires_at > NOW()
      LIMIT 1
    `;
    return result.length > 0 ? result[0] : null;
  } catch {
    return null;
  }
}

async function setCache(cacheKey, source, data, creditsUsed = 0, ttlHours = 24) {
  try {
    await sql`
      INSERT INTO seo_cache (cache_key, source, data, credits_used, expires_at)
      VALUES (${cacheKey}, ${source}, ${JSON.stringify(data)}::jsonb, ${creditsUsed}, NOW() + (${ttlHours} || ' hours')::INTERVAL)
      ON CONFLICT (cache_key) DO UPDATE SET
        data = EXCLUDED.data,
        credits_used = EXCLUDED.credits_used,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW()
    `;
  } catch (err) {
    console.error('[OpenSEO] Cache write error:', err.message);
  }
}

// ── API wrapper with fallback ────────────────────────────────────────────────
async function callOpenSEO(operation, endpoint, params = {}) {
  const cacheKey = `openseo:${operation}:${JSON.stringify(params)}`;

  // 1. Check cache first
  const cached = await getCached(cacheKey);
  if (cached) {
    console.log(`[OpenSEO] Cache hit for ${operation}`);
    return { data: cached.data, source: 'cache', creditsUsed: 0 };
  }

  // 2. Check credit availability
  const usedThisMonth = await getCreditUsageThisMonth();
  const remaining = 10.0 - usedThisMonth;

  if (remaining < MIN_REMAINING_CREDITS) {
    console.warn(`[OpenSEO] Credits low (${remaining.toFixed(2)} remaining). Falling back to GSC.`);
    return { data: null, source: 'credits_depleted', creditsUsed: 0, remaining };
  }

  const cost = CREDIT_COSTS[operation] || 0.05;
  if (remaining < cost) {
    console.warn(`[OpenSEO] Not enough credits for ${operation} (need ${cost}, have ${remaining.toFixed(2)})`);
    return { data: null, source: 'insufficient_credits', creditsUsed: 0, remaining };
  }

  // 3. Call the API
  try {
    const queryParams = new URLSearchParams(params).toString();
    const url = `${OPENSEO_BASE_URL}/${endpoint}${queryParams ? `?${queryParams}` : ''}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');

      // Credit exhaustion (402 or specific error messages)
      if (response.status === 402 || errorText.includes('credit') || errorText.includes('quota')) {
        console.warn(`[OpenSEO] Credits exhausted during ${operation}`);
        await logCreditUsage(operation, cost, false, 'Credits exhausted');
        return { data: null, source: 'credits_exhausted', creditsUsed: 0 };
      }

      throw new Error(`OpenSEO API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    // 4. Cache the result
    await setCache(cacheKey, 'openseo', data, cost);

    // 5. Log credit usage
    await logCreditUsage(operation, cost, true);

    return { data, source: 'api', creditsUsed: cost, remaining: remaining - cost };
  } catch (err) {
    console.error(`[OpenSEO] API error for ${operation}:`, err.message);
    await logCreditUsage(operation, 0, false, err.message);

    // On network error, try stale cache
    const staleCache = await sql`
      SELECT data FROM seo_cache
      WHERE cache_key = ${cacheKey}
      LIMIT 1
    `;
    if (staleCache.length > 0) {
      return { data: staleCache[0].data, source: 'stale_cache', creditsUsed: 0 };
    }

    return { data: null, source: 'error', creditsUsed: 0, error: err.message };
  }
}

// ── Public API methods ───────────────────────────────────────────────────────

/**
 * Keyword research — get volume, difficulty, CPC for keywords
 * Falls back to GSC query data if OpenSEO is unavailable
 */
export async function keywordResearch(keywords, options = {}) {
  const results = {};

  for (const keyword of keywords.slice(0, 10)) { // Max 10 keywords per call
    const result = await callOpenSEO('keyword_search', 'keyword/research', {
      keyword,
      country: options.country || 'IN',
      language: options.language || 'en',
    });

    if (result.data) {
      results[keyword] = result.data;
    } else if (result.source === 'credits_depleted' || result.source === 'insufficient_credits') {
      // Fallback: check if we have GSC data for this keyword
      try {
        const gscFallback = await sql`
          SELECT query, clicks, impressions, ctr, position
          FROM (
            SELECT jsonb_array_elements_text(data->'queries') AS query_data
            FROM seo_cache
            WHERE source = 'gsc'
              AND cache_key LIKE 'gsc:queries:%'
              AND expires_at > NOW()
          ) sub
          WHERE query_data->>'query' ILIKE ${`%${keyword}%`}
          LIMIT 5
        `;
        results[keyword] = {
          keyword,
          source: 'gsc_fallback',
          gscData: gscFallback,
        };
      } catch {
        results[keyword] = { keyword, source: 'unavailable' };
      }
    } else {
      results[keyword] = { keyword, source: 'error', error: result.error };
    }
  }

  return results;
}

/**
 * Domain overview — competitor analysis
 */
export async function domainOverview(domain) {
  const result = await callOpenSEO('domain_overview', 'domain/overview', {
    domain,
    country: 'IN',
  });

  if (!result.data) {
    return {
      domain,
      source: result.source,
      error: result.error,
      message: result.source === 'credits_depleted'
        ? 'OpenSEO credits depleted. Showing cached data if available.'
        : 'Domain data unavailable.',
    };
  }

  return result.data;
}

/**
 * Get keyword suggestions for a topic
 */
export async function keywordSuggestions(seedKeyword, limit = 20) {
  const result = await callOpenSEO('keyword_search', 'keyword/suggestions', {
    keyword: seedKeyword,
    limit: String(Math.min(limit, 50)),
    country: 'IN',
  });

  if (!result.data) {
    return { seed: seedKeyword, suggestions: [], source: result.source };
  }

  return { seed: seedKeyword, suggestions: result.data, source: result.source };
}

/**
 * Get credit status
 */
export async function getCreditStatus() {
  const usedThisMonth = await getCreditUsageThisMonth();
  const remaining = Math.max(0, 10.0 - usedThisMonth);

  return {
    monthly_allocation: 10.0,
    used_this_month: usedThisMonth,
    remaining,
    percentage_used: (usedThisMonth / 10.0) * 100,
    is_low: remaining < 2.0,
    is_depleted: remaining < MIN_REMAINING_CREDITS,
    costs: CREDIT_COSTS,
  };
}

/**
 * Clear expired cache entries
 */
export async function cleanExpiredCache() {
  try {
    const result = await sql`
      DELETE FROM seo_cache WHERE expires_at < NOW()
    `;
    if (result.count > 0) {
      console.log(`[OpenSEO] Cleaned ${result.count} expired cache entries`);
    }
  } catch (err) {
    console.error('[OpenSEO] Cache cleanup error:', err.message);
  }
}

export { getCached, setCache, callOpenSEO };
