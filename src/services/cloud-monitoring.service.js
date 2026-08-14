import { google } from 'googleapis';
import { memCache } from '../utils/memCache.js';

const MONITOR_TTL = 60 * 1_000; // 1 min cache

let monitoringClient = null;

function getClient() {
  if (monitoringClient) return monitoringClient;

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const auth = new google.auth.GoogleAuth({
    ...(keyFile ? { keyFile } : {}),
    scopes: ['https://www.googleapis.com/auth/monitoring.readonly'],
  });
  monitoringClient = google.monitoring({ version: 'v3', auth });
  return monitoringClient;
}

function getProjectId() {
  return process.env.GCP_PROJECT_ID || 'mango-people-news-504608';
}

function getServiceName() {
  return process.env.GCP_CLOUD_RUN_SERVICE || 'mangopeople-backend';
}

function getRegion() {
  return process.env.GCP_CLOUD_RUN_REGION || 'us-central1';
}

function buildTimeRange(durationMinutes = 60) {
  const now = new Date();
  const startTime = new Date(now.getTime() - durationMinutes * 60 * 1000);
  return {
    startTime: startTime.toISOString(),
    endTime: now.toISOString(),
  };
}

async function queryMetric(metricType, durationMinutes = 60, aggregation = 'ALIGN_RATE') {
  const client = getClient();
  const projectId = getProjectId();
  const serviceName = getServiceName();
  const region = getRegion();
  const timeRange = buildTimeRange(durationMinutes);

  const name = `projects/${projectId}`;

  const filter = `resource.type = "cloud_run_revision" AND resource.labels.service_name = "${serviceName}" AND resource.labels.location = "${region}" AND metric.type = "${metricType}"`;

  const response = await client.projects.timeSeries.list({
    name,
    filter,
    interval: {
      startTime: timeRange.startTime,
      endTime: timeRange.endTime,
    },
    aggregation: {
      alignmentPeriod: '60s',
      perSeriesAligner: aggregation,
    },
  });

  return response.data.timeSeries || [];
}

export async function getServiceHealth() {
  const cacheKey = 'monitor:health';
  return memCache.wrap(cacheKey, async () => {
    try {
      const [requestCount, errorRate, latency] = await Promise.all([
        queryMetric('run.googleapis.com/request_count', 5, 'ALIGN_COUNT'),
        queryMetric('run.googleapis.com/request_count', 5, 'ALIGN_RATE'),
        queryMetric('run.googleapis.com/request_latencies', 5, 'ALIGN_PERCENTILE_99'),
      ]);

      const totalRequests = requestCount.reduce((sum, ts) => {
        return sum + (ts.points?.[0]?.value?.int64Value || 0);
      }, 0);

      const p95Latency = latency.length > 0
        ? (latency[0].points?.[0]?.value?.distributionValue?.mean || 0) / 1000
        : 0;

      return {
        status: totalRequests > 0 ? 'healthy' : 'idle',
        requestCount: totalRequests,
        p95Latency: Math.round(p95Latency),
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      return {
        status: 'unknown',
        error: err.message,
        requestCount: 0,
        p95Latency: 0,
        lastChecked: new Date().toISOString(),
      };
    }
  }, MONITOR_TTL);
}

export async function getRequestMetrics(durationMinutes = 60) {
  const cacheKey = `monitor:requests:${durationMinutes}`;
  return memCache.wrap(cacheKey, async () => {
    try {
      const [requestCount, latencyData] = await Promise.all([
        queryMetric('run.googleapis.com/request_count', durationMinutes, 'ALIGN_RATE'),
        queryMetric('run.googleapis.com/request_latencies', durationMinutes, 'ALIGN_PERCENTILE_99'),
      ]);

      const timeline = [];

      if (requestCount.length > 0) {
        const ts = requestCount[0];
        if (ts.points) {
          for (const point of ts.points) {
            timeline.push({
              timestamp: point.interval.endTime,
              requests: Math.round(point.value.int64Value || 0),
            });
          }
        }
      }

      if (latencyData.length > 0) {
        const ts = latencyData[0];
        if (ts.points) {
          for (let i = 0; i < ts.points.length && i < timeline.length; i++) {
            timeline[i].latency = Math.round((ts.points[i].value.distributionValue?.mean || 0) / 1000);
          }
        }
      }

      return { timeline };
    } catch (err) {
      return { timeline: [], error: err.message };
    }
  }, MONITOR_TTL);
}

export async function getErrorMetrics(durationMinutes = 60) {
  const cacheKey = `monitor:errors:${durationMinutes}`;
  return memCache.wrap(cacheKey, async () => {
    try {
      const client = getClient();
      const projectId = getProjectId();
      const serviceName = getServiceName();
      const region = getRegion();
      const timeRange = buildTimeRange(durationMinutes);

      const filter = `resource.type = "cloud_run_revision" AND resource.labels.service_name = "${serviceName}" AND resource.labels.location = "${region}" AND metric.type = "run.googleapis.com/request_count"`;

      const response = await client.projects.timeSeries.list({
        name: `projects/${projectId}`,
        filter,
        interval: {
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
        },
        aggregation: {
          alignmentPeriod: '300s',
          perSeriesAligner: 'ALIGN_SUM',
          crossSeriesReducer: 'REDUCE_SUM',
          groupByFields: ['metric.labels.response_code_class'],
        },
      });

      const errorBreakdown = {};
      for (const ts of (response.data.timeSeries || [])) {
        const codeClass = ts.metric?.labels?.response_code_class || 'unknown';
        const total = (ts.points || []).reduce((sum, p) => sum + (p.value.int64Value || 0), 0);
        errorBreakdown[codeClass] = total;
      }

      const total = Object.values(errorBreakdown).reduce((a, b) => a + b, 0);
      const errors = errorBreakdown['4xx'] + errorBreakdown['5xx'] || 0;

      return {
        breakdown: errorBreakdown,
        total,
        errors,
        errorRate: total > 0 ? (errors / total * 100).toFixed(2) : 0,
      };
    } catch (err) {
      return { breakdown: {}, total: 0, errors: 0, errorRate: 0, error: err.message };
    }
  }, MONITOR_TTL);
}
