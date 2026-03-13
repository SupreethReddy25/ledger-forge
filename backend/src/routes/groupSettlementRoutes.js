const express = require("express");
const router = express.Router();
const groupSettlementController = require("../controllers/groupSettlementController");

router.post("/", groupSettlementController.createGroupSettlement);
router.get("/group/:group_id", groupSettlementController.listGroupSettlements);
router.delete("/:settlement_id", groupSettlementController.deleteGroupSettlement);

module.exports = router;
