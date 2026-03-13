const express = require("express");
const router = express.Router();
const groupBalanceController = require("../controllers/groupBalanceController");

router.get("/:group_id", groupBalanceController.getGroupBalances);
router.get("/:group_id/settlement-plan", groupBalanceController.getSettlementPlan);

module.exports = router;
