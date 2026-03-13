const express = require("express");
const router = express.Router();
const transactionController = require("../controllers/transactionController");

router.post("/", transactionController.createTransaction);
router.post("/parse", transactionController.parseQuickTransaction);
router.get("/user/:user_id", transactionController.listUserTransactions);
router.get("/stats/:user_id", transactionController.getTransactionStats);
router.get("/friend/:friend_id", transactionController.getTransactionsByFriend);
router.delete("/:transaction_id", transactionController.deleteTransaction);

// legacy route kept for backward compatibility with existing Postman collections
router.get("/:friend_id", transactionController.getTransactionsByFriend);

module.exports = router;
