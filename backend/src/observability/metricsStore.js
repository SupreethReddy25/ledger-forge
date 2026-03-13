const REQUEST_LOG_LIMIT = 12000;
const UUID_PATH_SEGMENT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

const state = {
  startedAt: Date.now(),
  totalRequests: 0,
  requestsByPath: new Map(),
  statusClassCount: {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0
  },
  logs: []
};

function normalizePath(rawPath) {
  return rawPath
    .replace(UUID_PATH_SEGMENT, ":uuid")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

function statusClass(statusCode) {
  if (statusCode >= 500) return "5xx";
  if (statusCode >= 400) return "4xx";
  if (statusCode >= 300) return "3xx";
  return "2xx";
}

function recordRequest(metric) {
  const {
    method,
    path,
    statusCode,
    latencyMs,
    timestamp = Date.now()
  } = metric;

  state.totalRequests += 1;
  const normalizedPath = `${method.toUpperCase()} ${normalizePath(path)}`;
  state.requestsByPath.set(
    normalizedPath,
    (state.requestsByPath.get(normalizedPath) || 0) + 1
  );

  const className = statusClass(statusCode);
  state.statusClassCount[className] += 1;

  state.logs.push({
    timestamp,
    statusCode,
    latencyMs
  });

  if (state.logs.length > REQUEST_LOG_LIMIT) {
    state.logs.splice(0, state.logs.length - REQUEST_LOG_LIMIT);
  }
}

function computeWindowStats(windowMs) {
  const now = Date.now();
  const rows = state.logs.filter((row) => now - row.timestamp <= windowMs);

  if (rows.length === 0) {
    return {
      request_count: 0,
      error_rate: 0,
      availability: 100,
      p50_latency_ms: 0,
      p95_latency_ms: 0
    };
  }

  const latencies = rows
    .map((row) => row.latencyMs)
    .sort((a, b) => a - b);

  const idx = (percent) => Math.min(latencies.length - 1, Math.floor(percent * latencies.length));
  const errors = rows.filter((row) => row.statusCode >= 500).length;

  return {
    request_count: rows.length,
    error_rate: Number(((errors / rows.length) * 100).toFixed(2)),
    availability: Number((((rows.length - errors) / rows.length) * 100).toFixed(2)),
    p50_latency_ms: Number(latencies[idx(0.5)].toFixed(2)),
    p95_latency_ms: Number(latencies[idx(0.95)].toFixed(2))
  };
}

function getMetricsSnapshot() {
  const uptimeSeconds = Math.floor((Date.now() - state.startedAt) / 1000);
  const routes = Array.from(state.requestsByPath.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([route, hits]) => ({ route, hits }));

  return {
    uptime_seconds: uptimeSeconds,
    total_requests: state.totalRequests,
    status_classes: state.statusClassCount,
    top_routes: routes,
    window_5m: computeWindowStats(5 * 60 * 1000),
    window_60m: computeWindowStats(60 * 60 * 1000)
  };
}

module.exports = {
  recordRequest,
  getMetricsSnapshot
};
