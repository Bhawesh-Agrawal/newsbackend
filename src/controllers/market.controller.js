// Proxies Twelve Data API with 5-minute cache
// Protects API key and stays within free tier limits

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cache = { data: null, fetchedAt: 0 };

// Indian + Global indices we want
// Free tier supports trial symbols — upgrade for BSE/NSE indices
// Using what's available on free: major global indices + forex
const SYMBOLS = [
  // Indian proxies (available on free tier via NSE)
  'INFY',        // Infosys — proxy for Indian tech/markets
  'WIT',         // Wipro ADR
  // Global indices
  '^GSPC',       // S&P 500
  '^DJI',        // Dow Jones
  // Forex
  'USD/INR',     // Dollar/Rupee
  'XAU/USD',     // Gold
  'BTC/USD',     // Bitcoin
  'CRUDE_OIL',   // Crude Oil
].join(',');

export const getMarketData = async (req, res, next) => {
  try {
    const now = Date.now();

    // Serve from cache if fresh
    if (cache.data && (now - cache.fetchedAt) < CACHE_TTL_MS) {
      return res.json({ success: true, data: cache.data, cached: true });
    }

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      // Return static fallback if no key configured
      return res.json({
        success: true,
        data:    FALLBACK_DATA,
        cached:  false,
        static:  true,
      });
    }

    // Fetch quotes in one batched request
    const url = `https://api.twelvedata.com/quote?symbol=${SYMBOLS}&apikey=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const raw = await response.json();

    // Normalize to our format
    const data = normalizeQuotes(raw);

    cache = { data, fetchedAt: now };

    return res.json({ success: true, data, cached: false });

  } catch (err) {
    console.error('[Market] Fetch error:', err.message);

    // Return cached data if available, even if stale
    if (cache.data) {
      return res.json({ success: true, data: cache.data, cached: true, stale: true });
    }

    return res.json({ success: true, data: FALLBACK_DATA, static: true });
  }
};

function normalizeQuotes(raw) {
  // Twelve Data returns either an object of symbols or a single quote
  const results = [];

  const process = (symbol, quote) => {
    if (!quote || quote.status === 'error') return;
    const change    = parseFloat(quote.change ?? 0);
    const changePct = parseFloat(quote.percent_change ?? 0);
    results.push({
      symbol,
      name:      quote.name ?? symbol,
      price:     parseFloat(quote.close ?? quote.price ?? 0),
      change:    change,
      changePct: changePct,
      isUp:      change >= 0,
      currency:  quote.currency ?? 'USD',
    });
  };

  if (raw.symbol) {
    // Single quote response
    process(raw.symbol, raw);
  } else {
    // Batch response — keyed by symbol
    Object.entries(raw).forEach(([symbol, quote]) => process(symbol, quote));
  }

  return results;
}

// Static fallback when no API key or request fails
const FALLBACK_DATA = [
  { symbol: 'SENSEX',  name: 'BSE Sensex',  price: 82450.30, change: 312.45, changePct: 0.38,  isUp: true,  currency: 'INR' },
  { symbol: 'NIFTY',   name: 'Nifty 50',    price: 24820.15, change: 124.80, changePct: 0.51,  isUp: true,  currency: 'INR' },
  { symbol: 'USD/INR', name: 'USD/INR',      price: 83.42,   change: -0.08,  changePct: -0.10, isUp: false, currency: 'INR' },
  { symbol: 'GOLD',    name: 'Gold',         price: 72450,   change: 220,    changePct: 0.31,  isUp: true,  currency: 'INR' },
  { symbol: '^GSPC',   name: 'S&P 500',      price: 5218.40, change: 18.25,  changePct: 0.35,  isUp: true,  currency: 'USD' },
  { symbol: 'BTC/USD', name: 'Bitcoin',      price: 68420,   change: 1420,   changePct: 2.12,  isUp: true,  currency: 'USD' },
];