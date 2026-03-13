const pool = require("../config/db");
const { isUUID, normalizeText, isValidDateString } = require("../utils/validators");
const {
  readPositiveAmount,
  ensureGroupAccess,
  ensureGroupUserMember,
  getGroupMembers
} = require("../services/groupLedgerService");

async function fetchSettlementById(client, settlementId) {
  const result = await client.query(
    `SELECT
       gs.id,
       gs.group_id,
       gs.from_member_id,
       sender.display_name AS from_name,
       gs.to_member_id,
       receiver.display_name AS to_name,
       gs.created_by_user_id,
       creator.name AS created_by_name,
       gs.amount,
       gs.notes,
       gs.approval_status,
       gs.approval_note,
       gs.approved_by_member_id,
       approver.display_name AS approved_by_name,
       gs.approved_at,
       gs.settled_at,
       gs.created_at
     FROM group_settlements gs
     JOIN group_members sender
       ON sender.id = gs.from_member_id
     JOIN group_members receiver
       ON receiver.id = gs.to_member_id
     LEFT JOIN users creator
       ON creator.id = gs.created_by_user_id
     LEFT JOIN group_members approver
       ON approver.id = gs.approved_by_member_id
     WHERE gs.id = $1`,
    [settlementId]
  );
  return result.rows[0] || null;
}

exports.createGroupSettlement = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      group_id,
      user_id,
      from_member_id,
      to_member_id,
      amount,
      notes,
      settled_at
    } = req.body;

    if (!isUUID(group_id) || !isUUID(user_id) || !isUUID(from_member_id) || !isUUID(to_member_id)) {
      return res.status(400).json({
        error: "group_id, user_id, from_member_id and to_member_id must be valid UUID values"
      });
    }

    if (from_member_id === to_member_id) {
      return res.status(400).json({
        error: "from_member_id and to_member_id must be different"
      });
    }

    const parsedAmount = readPositiveAmount(amount);
    if (!parsedAmount) {
      return res.status(400).json({
        error: "amount must be a number greater than 0"
      });
    }

    const safeDate = settled_at || new Date().toISOString().slice(0, 10);
    if (!isValidDateString(safeDate)) {
      return res.status(400).json({
        error: "settled_at must be in YYYY-MM-DD format"
      });
    }

    await client.query("BEGIN");

    const group = await ensureGroupAccess(client, group_id, user_id);
    if (!group) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Group not found for this user"
      });
    }

    const actorMember = await ensureGroupUserMember(client, group_id, user_id);
    if (!actorMember) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Only user-members can record settlements in this group"
      });
    }

    const members = await getGroupMembers(client, group_id);
    const memberIds = new Set(members.map((item) => item.id));

    if (!memberIds.has(from_member_id) || !memberIds.has(to_member_id)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "from_member_id and to_member_id must belong to this group"
      });
    }

    const isOwner = group.owner_user_id === user_id;
    const approvalStatus = group.require_approval && !isOwner ? "pending" : "approved";
    const approvedByMemberId = approvalStatus === "approved" ? actorMember.id : null;
    const approvedAt = approvalStatus === "approved" ? new Date().toISOString() : null;

    const inserted = await client.query(
      `INSERT INTO group_settlements (
         group_id,
         from_member_id,
         to_member_id,
         created_by_user_id,
         amount,
         notes,
         approval_status,
         approved_by_member_id,
         approved_at,
         settled_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        group_id,
        from_member_id,
        to_member_id,
        user_id,
        parsedAmount,
        normalizeText(notes, 500),
        approvalStatus,
        approvedByMemberId,
        approvedAt,
        safeDate
      ]
    );

    const settlement = await fetchSettlementById(client, inserted.rows[0].id);

    await client.query("COMMIT");

    res.status(201).json({
      ...settlement,
      workflow_status:
        approvalStatus === "pending" ? "submitted_for_approval" : "approved_and_applied"
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  } finally {
    client.release();
  }
};

exports.listGroupSettlements = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id } = req.params;
    const userId = req.query.user_id;

    if (!isUUID(group_id) || !isUUID(userId)) {
      return res.status(400).json({
        error: "group_id and user_id must be valid UUID values"
      });
    }

    const group = await ensureGroupAccess(client, group_id, userId);
    if (!group) {
      return res.status(404).json({
        error: "Group not found for this user"
      });
    }

    const result = await client.query(
      `SELECT
         gs.id,
         gs.group_id,
         gs.from_member_id,
         sender.display_name AS from_name,
         gs.to_member_id,
         receiver.display_name AS to_name,
         gs.created_by_user_id,
         creator.name AS created_by_name,
         gs.amount,
         gs.notes,
         gs.approval_status,
         gs.approval_note,
         gs.approved_by_member_id,
         approver.display_name AS approved_by_name,
         gs.approved_at,
         gs.settled_at,
         gs.created_at
       FROM group_settlements gs
       JOIN group_members sender
         ON sender.id = gs.from_member_id
       JOIN group_members receiver
         ON receiver.id = gs.to_member_id
       LEFT JOIN users creator
         ON creator.id = gs.created_by_user_id
       LEFT JOIN group_members approver
         ON approver.id = gs.approved_by_member_id
       WHERE gs.group_id = $1
       ORDER BY gs.settled_at DESC, gs.created_at DESC`,
      [group_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  } finally {
    client.release();
  }
};

exports.deleteGroupSettlement = async (req, res) => {
  const client = await pool.connect();

  try {
    const { settlement_id } = req.params;
    const userId = req.query.user_id || req.body?.user_id;

    if (!isUUID(settlement_id) || !isUUID(userId)) {
      return res.status(400).json({
        error: "settlement_id and user_id must be valid UUID values"
      });
    }

    const settlementResult = await client.query(
      `SELECT
         gs.id,
         gs.group_id,
         gs.amount,
         gs.created_by_user_id,
         gs.approval_status,
         g.owner_user_id
       FROM group_settlements gs
       JOIN groups g
         ON g.id = gs.group_id
       WHERE gs.id = $1`,
      [settlement_id]
    );

    if (settlementResult.rowCount === 0) {
      return res.status(404).json({
        error: "Settlement not found"
      });
    }

    const settlement = settlementResult.rows[0];
    const isOwner = settlement.owner_user_id === userId;
    const isPendingCreator =
      settlement.created_by_user_id === userId && settlement.approval_status === "pending";

    if (!isOwner && !isPendingCreator) {
      return res.status(403).json({
        error: "Only the group owner or pending request creator can delete this settlement"
      });
    }

    await client.query(
      `DELETE FROM group_settlements
       WHERE id = $1`,
      [settlement_id]
    );

    res.json({
      message: "Settlement deleted successfully",
      settlement
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  } finally {
    client.release();
  }
};
