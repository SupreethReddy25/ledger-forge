const express = require("express");
const router = express.Router();
const analyticsController = require("../controllers/analyticsController");

router.get("/:user_id", analyticsController.getAnalyticsOverview);

module.exports = router;
