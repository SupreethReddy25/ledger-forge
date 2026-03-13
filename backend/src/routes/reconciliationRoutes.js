const express = require("express");
const router = express.Router();
const reconciliationController = require("../controllers/reconciliationController");

router.post("/preview", reconciliationController.previewReconciliation);
router.post("/commit", reconciliationController.commitReconciliation);
router.get("/imports/:user_id", reconciliationController.getImports);

module.exports = router;
