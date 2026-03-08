const express = require("express");
const router = express.Router();
const balanceController = require("../controllers/balanceController");

router.get("/:user_id", balanceController.getFriendBalances);

module.exports = router;