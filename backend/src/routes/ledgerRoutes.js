const express = require("express");
const router = express.Router();
const ledgerController = require("../controllers/ledgerController");

router.get("/events/:user_id", ledgerController.getLedgerEvents);
router.get("/replay/:user_id", ledgerController.replayLedger);
router.post("/backfill/:user_id", ledgerController.backfillTransactionEvents);

module.exports = router;
