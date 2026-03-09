const express = require("express");
const router = express.Router();
const recurringController = require("../controllers/recurringController");

router.post("/", recurringController.createRecurringRule);
router.get("/:user_id", recurringController.getRecurringRules);
router.patch("/:rule_id", recurringController.updateRecurringRule);
router.post("/run/:user_id", recurringController.runRecurringRules);

module.exports = router;
