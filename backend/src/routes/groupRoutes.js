const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");
const groupXFactorController = require("../controllers/groupXFactorController");

router.post("/", groupController.createGroup);
router.get("/user/:user_id", groupController.listUserGroups);
router.post("/invites/:invite_code/accept", groupXFactorController.acceptInvite);
router.get("/:group_id/members", groupController.listGroupMembers);
router.post("/:group_id/members", groupController.addGroupMember);
router.delete("/:group_id/members/:member_id", groupController.removeGroupMember);
router.get("/:group_id/activity", groupController.getGroupActivity);
router.patch("/:group_id/settings", groupXFactorController.updateGroupSettings);
router.post("/:group_id/invites", groupXFactorController.createGroupInvite);
router.get("/:group_id/invites", groupXFactorController.listGroupInvites);
router.delete("/:group_id/invites/:invite_id", groupXFactorController.revokeGroupInvite);
router.get("/:group_id/approvals", groupXFactorController.listPendingApprovals);
router.post(
  "/:group_id/approvals/:entity_type/:entity_id",
  groupXFactorController.decideApproval
);
router.get("/:group_id/reminders", groupXFactorController.getReminderSuggestions);
router.get("/:group_id", groupController.getGroupById);
router.patch("/:group_id", groupController.updateGroup);
router.delete("/:group_id", groupController.deleteGroup);

module.exports = router;
