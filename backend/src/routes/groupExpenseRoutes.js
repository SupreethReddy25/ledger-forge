const express = require("express");
const router = express.Router();
const groupExpenseController = require("../controllers/groupExpenseController");

router.post("/", groupExpenseController.createGroupExpense);
router.get("/group/:group_id", groupExpenseController.listGroupExpenses);
router.delete("/:expense_id", groupExpenseController.deleteGroupExpense);

module.exports = router;
