const { recordRequest } = require("./metricsStore");

function observabilityMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  const rawPath = req.originalUrl.split("?")[0];

  res.on("finish", () => {
    const elapsedNs = process.hrtime.bigint() - start;
    const latencyMs = Number(elapsedNs) / 1_000_000;

    recordRequest({
      method: req.method,
      path: rawPath,
      statusCode: res.statusCode,
      latencyMs,
      timestamp: Date.now()
    });
  });

  next();
}

module.exports = {
  observabilityMiddleware
};
