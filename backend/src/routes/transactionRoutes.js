const express = require("express");
const router = express.Router();
const transactionController = require("../controllers/transactionController");

router.post("/", transactionController.createTransaction);

router.get("/:friend_id", transactionController.getTransactionsByFriend);

module.exports = router;