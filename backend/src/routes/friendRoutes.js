const express = require("express");
const router = express.Router();
const friendController = require("../controllers/friendController");

router.post("/", friendController.createFriend);
router.patch("/:friend_id", friendController.updateFriend);
router.delete("/:friend_id", friendController.deleteFriend);
router.get("/:user_id", friendController.getFriends);

module.exports = router;
