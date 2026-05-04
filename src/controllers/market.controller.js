const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { data: null, fetchedAt: 0 };

const SYMBOLS_MAP = {
  '^BSESN': { symbol: 'SENSEX', name: 'BSE Sensex', currency: 'INR' },
  '^NSEI':  { symbol: 'NIFTY',  name: 'Nifty 50',  currency: 'INR' },
  'GC=F':   { symbol: 'GOLD',   name: 'Gold',      currency: 'USD' },
  'SI=F':   { symbol: 'SILVER', name: 'Silver',    currency: 'USD' },
  'INR=X':  { symbol: 'USD/INR',name: 'USD / INR', currency: 'INR' },
};

export const getMarketData = async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data && (now - cache.fetchedAt) < CACHE_TTL_MS) {
      return res.json({ success: true, data: cache.data, cached: true });
    }

    // Fetch all symbols in parallel
    const requests = Object.keys(SYMBOLS_MAP).map(async (ticker) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const json = await resp.json();
      
      const meta = json.chart.result[0].meta;
      const price = meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose;
      const change = price - prevClose;
      const changePct = (change / prevClose) * 100;

      return {
        symbol:    SYMBOLS_MAP[ticker].symbol,
        name:      SYMBOLS_MAP[ticker].name,
        price:     parseFloat(price.toFixed(2)),
        change:    parseFloat(change.toFixed(2)),
        changePct: parseFloat(changePct.toFixed(2)),
        isUp:      change >= 0,
        currency:  SYMBOLS_MAP[ticker].currency,
      };
    });

    const data = await Promise.all(requests);
    cache = { data, fetchedAt: now };

    return res.json({ success: true, data, cached: false });

  } catch (err) {
    console.error('[Market Error]:', err.message);
    if (cache.data) return res.json({ success: true, data: cache.data, cached: true, stale: true });
    return res.status(503).json({ success: false, error: 'Service Unavailable' });
  }
};