import { google } from 'googleapis';
import { memCache } from '../utils/memCache.js';

const GSC_TTL = 5 * 60 * 1_000; // 5 min cache (GSC data changes slowly)

let searchconsole = null;

function getClient() {
  if (searchconsole) return searchconsole;

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const apiKey = process.env.GSC_API_KEY;

  if (keyFile) {
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    searchconsole = google.searchconsole({ version: 'v1', auth });
  } else if (apiKey) {
    searchconsole = google.searchconsole({ version: 'v1', auth: apiKey });
  } else {
    throw new Error('No Search Console credentials configured. Set GOOGLE_APPLICATION_CREDENTIALS or GSC_API_KEY.');
  }

  return searchconsole;
}

function getSiteUrl() {
  return process.env.GSC_SITE_URL || 'sc-domain:mangopeoplenews.com';
}

function parseDateRange(period) {
  const now = new Date();
  const end = now.toISOString().split('T')[0];

  let startDate;
  switch (period) {
    case 'today': startDate = 'today'; break;
    case 'yesterday': startDate = 'yesterday'; break;
    case '3d': {
      const d = new Date(now); d.setDate(d.getDate() - 3);
      startDate = d.toISOString().split('T')[0]; break;
    }
    case '7d': {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      startDate = d.toISOString().split('T')[0]; break;
    }
    case '28d': {
      const d = new Date(now); d.setDate(d.getDate() - 28);
      startDate = d.toISOString().split('T')[0]; break;
    }
    case '90d': {
      const d = new Date(now); d.setDate(d.getDate() - 90);
      startDate = d.toISOString().split('T')[0]; break;
    }
    default: {
      const d = new Date(now); d.setDate(d.getDate() - 28);
      startDate = d.toISOString().split('T')[0];
    }
  }

  return { startDate, endDate: end };
}

export async function getPerformance(period = '28d', dimensions = ['date']) {
  const cacheKey = `gsc:performance:${period}:${dimensions.join(',')}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const siteUrl = getSiteUrl();
    const dateRange = parseDateRange(period);

    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        dimensions,
        rowLimit: 1000,
      },
    });

    return {
      rows: (response.data.rows || []).map(row => ({
        keys: row.keys,
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0,
        position: row.position || 0,
      })),
      totalClicks: (response.data.rows || []).reduce((s, r) => s + (r.clicks || 0), 0),
      totalImpressions: (response.data.rows || []).reduce((s, r) => s + (r.impressions || 0), 0),
      avgCtr: (response.data.rows || []).reduce((s, r) => s + (r.ctr || 0), 0) / (response.data.rows?.length || 1),
      avgPosition: (response.data.rows || []).reduce((s, r) => s + (r.position || 0), 0) / (response.data.rows?.length || 1),
    };
  }, GSC_TTL);
}

export async function getQueries(period = '28d', limit = 100) {
  const cacheKey = `gsc:queries:${period}:${limit}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const siteUrl = getSiteUrl();
    const dateRange = parseDateRange(period);

    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        dimensions: ['query'],
        rowLimit: limit,
        orderBy: 'clicks',
      },
    });

    return (response.data.rows || []).map(row => ({
      query: row.keys[0],
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    }));
  }, GSC_TTL);
}

export async function getPages(period = '28d', limit = 100) {
  const cacheKey = `gsc:pages:${period}:${limit}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const siteUrl = getSiteUrl();
    const dateRange = parseDateRange(period);

    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        dimensions: ['page'],
        rowLimit: limit,
        orderBy: 'clicks',
      },
    });

    return (response.data.rows || []).map(row => ({
      page: row.keys[0],
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    }));
  }, GSC_TTL);
}

export async function getQueryTrend(query, period = '28d') {
  const cacheKey = `gsc:queryTrend:${query}:${period}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const siteUrl = getSiteUrl();
    const dateRange = parseDateRange(period);

    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        dimensions: ['date'],
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'query',
            expression: query,
          }],
        }],
        rowLimit: 28,
      },
    });

    return (response.data.rows || []).map(row => ({
      date: row.keys[0],
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    }));
  }, GSC_TTL);
}

export async function getPageQueryTrend(pageUrl, period = '28d') {
  const cacheKey = `gsc:pageQueryTrend:${pageUrl}:${period}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const siteUrl = getSiteUrl();
    const dateRange = parseDateRange(period);

    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        dimensions: ['query'],
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'page',
            expression: pageUrl,
          }],
        }],
        rowLimit: 100,
        orderBy: 'clicks',
      },
    });

    return (response.data.rows || []).map(row => ({
      query: row.keys[0],
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    }));
  }, GSC_TTL);
}

export async function getOpportunities(period = '28d') {
  const cacheKey = `gsc:opportunities:${period}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const siteUrl = getSiteUrl();
    const dateRange = parseDateRange(period);

    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        dimensions: ['query'],
        rowLimit: 500,
      },
    });

    const rows = response.data.rows || [];

    return {
      highImpressionLowCtr: rows
        .filter(r => r.impressions > 100 && r.ctr < 0.02)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 20)
        .map(r => ({
          query: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        })),
      positions4to10: rows
        .filter(r => r.position >= 4 && r.position <= 10)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 20)
        .map(r => ({
          query: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        })),
      positions11to20: rows
        .filter(r => r.position >= 11 && r.position <= 20)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 20)
        .map(r => ({
          query: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        })),
      noClicks: rows
        .filter(r => r.clicks === 0 && r.impressions > 50)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 20)
        .map(r => ({
          query: r.keys[0],
          impressions: r.impressions,
          position: r.position,
        })),
    };
  }, GSC_TTL);
}
