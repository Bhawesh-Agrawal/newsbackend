import { google } from 'googleapis';
import { memCache } from '../utils/memCache.js';

const GA4_TTL = 60 * 1_000; // 1 min cache

let analyticsDataClient = null;

function getClient() {
  if (analyticsDataClient) return analyticsDataClient;

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const apiKey = process.env.GA4_API_KEY;

  if (keyFile) {
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
    analyticsDataClient = google.analyticsdata({ version: 'v1beta', auth });
  } else if (apiKey) {
    analyticsDataClient = google.analyticsdata({ version: 'v1beta', auth: apiKey });
  } else {
    throw new Error('No Google Analytics credentials configured. Set GOOGLE_APPLICATION_CREDENTIALS or GA4_API_KEY.');
  }

  return analyticsDataClient;
}

function getPropertyId() {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error('GA4_PROPERTY_ID not set');
  return id.startsWith('properties/') ? id : `properties/${id}`;
}

function parseDateRange(period) {
  const now = new Date();
  const end = now.toISOString().split('T')[0];

  let startDate;
  switch (period) {
    case 'today': startDate = 'today'; break;
    case 'yesterday': startDate = 'yesterday'; break;
    case '7d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      startDate = d.toISOString().split('T')[0];
      break;
    }
    case '30d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      startDate = d.toISOString().split('T')[0];
      break;
    }
    case '90d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 90);
      startDate = d.toISOString().split('T')[0];
      break;
    }
    default: {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      startDate = d.toISOString().split('T')[0];
    }
  }

  return { startDate, endDate: end };
}

function parsePreviousDateRange(period) {
  const now = new Date();
  let endDate, startDate;

  switch (period) {
    case 'today': {
      endDate = new Date(now);
      endDate.setDate(endDate.getDate() - 1);
      startDate = new Date(endDate);
      break;
    }
    case '7d': {
      endDate = new Date(now);
      endDate.setDate(endDate.getDate() - 7);
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 7);
      break;
    }
    case '30d': {
      endDate = new Date(now);
      endDate.setDate(endDate.getDate() - 30);
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 30);
      break;
    }
    case '90d': {
      endDate = new Date(now);
      endDate.setDate(endDate.getDate() - 90);
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 90);
      break;
    }
    default: {
      endDate = new Date(now);
      endDate.setDate(endDate.getDate() - 30);
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 30);
    }
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

function buildDimensionFilters(filters) {
  if (!filters || Object.keys(filters).length === 0) return undefined;

  const filterExpressions = [];

  if (filters.pagePath) {
    filterExpressions.push({
      filter: {
        fieldName: 'pagePath',
        stringFilter: { matchType: 'CONTAINS', value: filters.pagePath },
      },
    });
  }

  if (filters.source) {
    filterExpressions.push({
      filter: {
        fieldName: 'sessionSource',
        stringFilter: { matchType: 'EXACT', value: filters.source },
      },
    });
  }

  if (filters.medium) {
    filterExpressions.push({
      filter: {
        fieldName: 'sessionMedium',
        stringFilter: { matchType: 'EXACT', value: filters.medium },
      },
    });
  }

  if (filters.country) {
    filterExpressions.push({
      filter: {
        fieldName: 'country',
        stringFilter: { matchType: 'EXACT', value: filters.country },
      },
    });
  }

  if (filters.device) {
    filterExpressions.push({
      filter: {
        fieldName: 'deviceCategory',
        stringFilter: { matchType: 'EXACT', value: filters.device },
      },
    });
  }

  if (filterExpressions.length === 0) return undefined;
  if (filterExpressions.length === 1) return filterExpressions[0];
  return { andGroup: { expressions: filterExpressions } };
}

export async function getPageViews(period = '30d', filters = {}) {
  const cacheKey = `ga4:pageViews:${period}:${JSON.stringify(filters)}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const property = getPropertyId();
    const dateRange = parseDateRange(period);
    const dimensionFilters = buildDimensionFilters(filters);

    const request = {
      property,
      dateRanges: [dateRange],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessions' },
      ],
    };

    if (dimensionFilters) request.dimensionFilter = dimensionFilters;

    const response = await client.properties.runReport({ property, requestBody: request });

    return (response.data.rows || []).map(row => ({
      date: row.dimensionValues[0].value,
      pageViews: parseInt(row.metricValues[0].value) || 0,
      sessions: parseInt(row.metricValues[1].value) || 0,
    }));
  }, GA4_TTL);
}

export async function getUniqueVisitors(period = '30d', filters = {}) {
  const cacheKey = `ga4:visitors:${period}:${JSON.stringify(filters)}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const property = getPropertyId();
    const dateRange = parseDateRange(period);
    const dimensionFilters = buildDimensionFilters(filters);

    const request = {
      property,
      dateRanges: [dateRange],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'newUsers' },
      ],
    };

    if (dimensionFilters) request.dimensionFilter = dimensionFilters;

    const response = await client.properties.runReport({ property, requestBody: request });

    return (response.data.rows || []).map(row => ({
      date: row.dimensionValues[0].value,
      activeUsers: parseInt(row.metricValues[0].value) || 0,
      newUsers: parseInt(row.metricValues[1].value) || 0,
    }));
  }, GA4_TTL);
}

export async function getEngagementMetrics(period = '30d', filters = {}) {
  const cacheKey = `ga4:engagement:${period}:${JSON.stringify(filters)}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const property = getPropertyId();
    const dateRange = parseDateRange(period);
    const dimensionFilters = buildDimensionFilters(filters);

    const request = {
      property,
      dateRanges: [dateRange],
      metrics: [
        { name: 'userEngagementDuration' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'bounceRate' },
      ],
    };

    if (dimensionFilters) request.dimensionFilter = dimensionFilters;

    const response = await client.properties.runReport({ property, requestBody: request });

    const row = response.data.rows?.[0];
    return {
      avgEngagementTime: parseFloat(row?.metricValues?.[0]?.value) || 0,
      engagedSessions: parseInt(row?.metricValues?.[1]?.value) || 0,
      engagementRate: parseFloat(row?.metricValues?.[2]?.value) || 0,
      bounceRate: parseFloat(row?.metricValues?.[3]?.value) || 0,
    };
  }, GA4_TTL);
}

export async function getTrafficSources(period = '30d', filters = {}) {
  const cacheKey = `ga4:sources:${period}:${JSON.stringify(filters)}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const property = getPropertyId();
    const dateRange = parseDateRange(period);
    const dimensionFilters = buildDimensionFilters(filters);

    const request = {
      property,
      dateRanges: [dateRange],
      dimensions: [
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 15,
    };

    if (dimensionFilters) request.dimensionFilter = dimensionFilters;

    const response = await client.properties.runReport({ property, requestBody: request });

    return (response.data.rows || []).map(row => ({
      source: row.dimensionValues[0].value || 'direct',
      medium: row.dimensionValues[1].value || 'none',
      sessions: parseInt(row.metricValues[0].value) || 0,
      users: parseInt(row.metricValues[1].value) || 0,
    }));
  }, GA4_TTL);
}

export async function getDeviceBreakdown(period = '30d', filters = {}) {
  const cacheKey = `ga4:devices:${period}:${JSON.stringify(filters)}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const property = getPropertyId();
    const dateRange = parseDateRange(period);
    const dimensionFilters = buildDimensionFilters(filters);

    const request = {
      property,
      dateRanges: [dateRange],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
      ],
    };

    if (dimensionFilters) request.dimensionFilter = dimensionFilters;

    const response = await client.properties.runReport({ property, requestBody: request });

    return (response.data.rows || []).map(row => ({
      device: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value) || 0,
      users: parseInt(row.metricValues[1].value) || 0,
    }));
  }, GA4_TTL);
}

export async function getGeoBreakdown(period = '30d', filters = {}) {
  const cacheKey = `ga4:geo:${period}:${JSON.stringify(filters)}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const property = getPropertyId();
    const dateRange = parseDateRange(period);
    const dimensionFilters = buildDimensionFilters(filters);

    const request = {
      property,
      dateRanges: [dateRange],
      dimensions: [{ name: 'country' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    };

    if (dimensionFilters) request.dimensionFilter = dimensionFilters;

    const response = await client.properties.runReport({ property, requestBody: request });

    return (response.data.rows || []).map(row => ({
      country: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value) || 0,
      users: parseInt(row.metricValues[1].value) || 0,
    }));
  }, GA4_TTL);
}

export async function getKPIs(period = '30d') {
  const cacheKey = `ga4:kpis:${period}`;
  return memCache.wrap(cacheKey, async () => {
    const [currentData, previousData] = await Promise.all([
      Promise.all([
        getPageViews(period),
        getUniqueVisitors(period),
        getEngagementMetrics(period),
      ]),
      Promise.all([
        getPageViews(period, {}, true),
        getUniqueVisitors(period, {}, true),
        getEngagementMetrics(period, {}, true),
      ]).catch(() => [null, null, null]),
    ]);

    const [currentViews, currentVisitors, currentEngagement] = currentData;
    const [previousViews, previousVisitors, previousEngagement] = previousData;

    const totalViewsCurrent = currentViews.reduce((sum, d) => sum + d.pageViews, 0);
    const totalViewsPrevious = previousViews?.reduce((sum, d) => sum + d.pageViews, 0) || 0;

    const totalVisitorsCurrent = currentVisitors.reduce((sum, d) => sum + d.activeUsers, 0);
    const totalVisitorsPrevious = previousVisitors?.reduce((sum, d) => sum + d.activeUsers, 0) || 0;

    return {
      pageViews: {
        value: totalViewsCurrent,
        change: totalViewsPrevious > 0
          ? ((totalViewsCurrent - totalViewsPrevious) / totalViewsPrevious * 100).toFixed(1)
          : 0,
      },
      uniqueVisitors: {
        value: totalVisitorsCurrent,
        change: totalVisitorsPrevious > 0
          ? ((totalVisitorsCurrent - totalVisitorsPrevious) / totalVisitorsPrevious * 100).toFixed(1)
          : 0,
      },
      avgEngagementTime: {
        value: currentEngagement.avgEngagementTime,
        change: previousEngagement?.avgEngagementTime
          ? ((currentEngagement.avgEngagementTime - previousEngagement.avgEngagementTime) / previousEngagement.avgEngagementTime * 100).toFixed(1)
          : 0,
      },
      bounceRate: {
        value: currentEngagement.bounceRate,
        change: previousEngagement?.bounceRate
          ? ((currentEngagement.bounceRate - previousEngagement.bounceRate) / previousEngagement.bounceRate * 100).toFixed(1)
          : 0,
      },
      viewsTrend: currentViews,
    };
  }, GA4_TTL);
}

export async function getTrend(metric, period = '30d', filters = {}) {
  const cacheKey = `ga4:trend:${metric}:${period}:${JSON.stringify(filters)}`;
  return memCache.wrap(cacheKey, async () => {
    const client = getClient();
    const property = getPropertyId();
    const dateRange = parseDateRange(period);
    const dimensionFilters = buildDimensionFilters(filters);

    const metricMap = {
      pageViews: 'screenPageViews',
      sessions: 'sessions',
      activeUsers: 'activeUsers',
      engagedSessions: 'engagedSessions',
      avgEngagementTime: 'userEngagementDuration',
      bounceRate: 'bounceRate',
    };

    const ga4Metric = metricMap[metric] || 'pageViews';

    const request = {
      property,
      dateRanges: [dateRange],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: ga4Metric }],
    };

    if (dimensionFilters) request.dimensionFilter = dimensionFilters;

    const response = await client.properties.runReport({ property, requestBody: request });

    return (response.data.rows || []).map(row => ({
      date: row.dimensionValues[0].value,
      value: parseFloat(row.metricValues[0].value) || 0,
    }));
  }, GA4_TTL);
}
