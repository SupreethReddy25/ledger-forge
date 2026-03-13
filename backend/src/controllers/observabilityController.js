const pool = require("../config/db");
const { getMetricsSnapshot } = require("../observability/metricsStore");

exports.getRuntimeMetrics = async (req, res) => {
  try {
    const snapshot = getMetricsSnapshot();
    res.json(snapshot);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getSloStatus = async (req, res) => {
  try {
    const runtime = getMetricsSnapshot();
    const dbPingStart = process.hrtime.bigint();
    await pool.query("SELECT 1");
    const dbPingNs = process.hrtime.bigint() - dbPingStart;
    const dbPingMs = Number(dbPingNs) / 1_000_000;

    const target = {
      availability_percent: 99.0,
      p95_latency_ms: 350
    };

    const availabilityOk = runtime.window_5m.availability >= target.availability_percent;
    const latencyOk = runtime.window_5m.p95_latency_ms <= target.p95_latency_ms;

    res.json({
      target,
      current: {
        window_5m: runtime.window_5m,
        db_ping_ms: Number(dbPingMs.toFixed(2))
      },
      status: availabilityOk && latencyOk ? "healthy" : "degraded"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
