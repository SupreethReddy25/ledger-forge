const express = require("express");
const router = express.Router();
const reportController = require("../controllers/reportController");

router.get("/:user_id.csv", reportController.exportTransactionsCsv);

module.exports = router;
