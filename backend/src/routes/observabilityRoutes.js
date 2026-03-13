const express = require("express");
const router = express.Router();
const observabilityController = require("../controllers/observabilityController");

router.get("/metrics", observabilityController.getRuntimeMetrics);
router.get("/slo", observabilityController.getSloStatus);

module.exports = router;
