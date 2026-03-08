const express = require("express");
const router = express.Router();
const settlementController = require("../controllers/settlementController");

router.post("/", settlementController.settleDebt);

module.exports = router;