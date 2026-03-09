const express = require("express");
const router = express.Router();
const balanceController = require("../controllers/balanceController");

router.get("/summary/:user_id", balanceController.getBalanceSummary);
router.get("/:user_id", balanceController.getFriendBalances);

module.exports = router;
