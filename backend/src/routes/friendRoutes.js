const express = require("express");
const router = express.Router();
const friendController = require("../controllers/friendController");

router.post("/", friendController.createFriend);

module.exports = router;
router.get("/:user_id", friendController.getFriends);