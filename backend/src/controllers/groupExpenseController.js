const pool = require("../config/db");
const { isUUID, normalizeText, isValidDateString } = require("../utils/validators");
const {
  readPositiveAmount,
  ensureGroupAccess,
  ensureGroupUserMember,
  getGroupMembers,
  normalizeExpenseSplits
} = require("../services/groupLedgerService");

async function fetchExpenseById(client, expenseId) {
  const result = await client.query(
    `SELECT
       ge.id,
       ge.group_id,
       ge.paid_by_member_id,
       payer.display_name AS paid_by_name,
       ge.created_by_user_id,
       creator.name AS created_by_name,
       ge.title,
       ge.notes,
       ge.amount,
       ge.split_method,
       ge.approval_status,
       ge.approval_note,
       ge.approved_by_member_id,
       approver.display_name AS approved_by_name,
       ge.approved_at,
       ge.expense_date,
       ge.created_at,
       COALESCE(
         json_agg(
           json_build_object(
             'member_id', gm.id,
             'display_name', gm.display_name,
             'share_amount', ges.share_amount,
             'share_percent', ges.share_percent
           )
           ORDER BY gm.display_name
         ) FILTER (WHERE ges.id IS NOT NULL),
         '[]'::json
       ) AS splits
     FROM group_expenses ge
     JOIN group_members payer
       ON payer.id = ge.paid_by_member_id
     LEFT JOIN users creator
       ON creator.id = ge.created_by_user_id
     LEFT JOIN group_members approver
       ON approver.id = ge.approved_by_member_id
     LEFT JOIN group_expense_splits ges
       ON ges.expense_id = ge.id
     LEFT JOIN group_members gm
       ON gm.id = ges.member_id
     WHERE ge.id = $1
     GROUP BY ge.id, payer.display_name, creator.name, approver.display_name`,
    [expenseId]
  );
  return result.rows[0] || null;
}

exports.createGroupExpense = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      group_id,
      user_id,
      paid_by_member_id,
      title,
      notes,
      amount,
      split_method,
      splits,
      expense_date
    } = req.body;

    if (!isUUID(group_id) || !isUUID(user_id) || !isUUID(paid_by_member_id)) {
      return res.status(400).json({
        error: "group_id, user_id and paid_by_member_id must be valid UUID values"
      });
    }

    const safeTitle = normalizeText(title, 220);
    if (!safeTitle) {
      return res.status(400).json({
        error: "title is required"
      });
    }

    const parsedAmount = readPositiveAmount(amount);
    if (!parsedAmount) {
      return res.status(400).json({
        error: "amount must be a number greater than 0"
      });
    }

    if (!["equal", "exact", "percentage"].includes(split_method)) {
      return res.status(400).json({
        error: "split_method must be one of equal, exact, percentage"
      });
    }

    const safeDate = expense_date || new Date().toISOString().slice(0, 10);
    if (!isValidDateString(safeDate)) {
      return res.status(400).json({
        error: "expense_date must be in YYYY-MM-DD format"
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
        error: "Only user-members can create expenses in this group"
      });
    }

    const members = await getGroupMembers(client, group_id);
    const memberMap = new Map(members.map((item) => [item.id, item]));

    if (!memberMap.has(paid_by_member_id)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "paid_by_member_id does not belong to this group"
      });
    }

    let normalizedSplits;
    try {
      normalizedSplits = normalizeExpenseSplits({
        amount: parsedAmount,
        splitMethod: split_method,
        splits,
        membersMap: memberMap
      });
    } catch (splitErr) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: splitErr.message
      });
    }

    const isOwner = group.owner_user_id === user_id;
    const approvalStatus = group.require_approval && !isOwner ? "pending" : "approved";
    const approvedByMemberId = approvalStatus === "approved" ? actorMember.id : null;
    const approvedAt = approvalStatus === "approved" ? new Date().toISOString() : null;

    const insertedExpense = await client.query(
      `INSERT INTO group_expenses (
         group_id,
         paid_by_member_id,
         created_by_user_id,
         title,
         notes,
         amount,
         split_method,
         approval_status,
         approved_by_member_id,
         approved_at,
         expense_date
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        group_id,
        paid_by_member_id,
        user_id,
        safeTitle,
        normalizeText(notes, 500),
        parsedAmount,
        split_method,
        approvalStatus,
        approvedByMemberId,
        approvedAt,
        safeDate
      ]
    );

    const expenseId = insertedExpense.rows[0].id;

    for (const splitRow of normalizedSplits) {
      await client.query(
        `INSERT INTO group_expense_splits (
           expense_id,
           member_id,
           share_amount,
           share_percent
         )
         VALUES ($1, $2, $3, $4)`,
        [expenseId, splitRow.member_id, splitRow.share_amount, splitRow.share_percent]
      );
    }

    const createdExpense = await fetchExpenseById(client, expenseId);

    await client.query("COMMIT");

    res.status(201).json({
      ...createdExpense,
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

exports.listGroupExpenses = async (req, res) => {
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
         ge.id,
         ge.group_id,
         ge.paid_by_member_id,
         payer.display_name AS paid_by_name,
         ge.created_by_user_id,
         creator.name AS created_by_name,
         ge.title,
         ge.notes,
         ge.amount,
         ge.split_method,
         ge.approval_status,
         ge.approval_note,
         ge.approved_by_member_id,
         approver.display_name AS approved_by_name,
         ge.approved_at,
         ge.expense_date,
         ge.created_at,
         COALESCE(
           json_agg(
             json_build_object(
               'member_id', gm.id,
               'display_name', gm.display_name,
               'share_amount', ges.share_amount,
               'share_percent', ges.share_percent
             )
             ORDER BY gm.display_name
           ) FILTER (WHERE ges.id IS NOT NULL),
           '[]'::json
         ) AS splits
       FROM group_expenses ge
       JOIN group_members payer
         ON payer.id = ge.paid_by_member_id
       LEFT JOIN users creator
         ON creator.id = ge.created_by_user_id
       LEFT JOIN group_members approver
         ON approver.id = ge.approved_by_member_id
       LEFT JOIN group_expense_splits ges
         ON ges.expense_id = ge.id
       LEFT JOIN group_members gm
         ON gm.id = ges.member_id
       WHERE ge.group_id = $1
       GROUP BY ge.id, payer.display_name, creator.name, approver.display_name
       ORDER BY ge.expense_date DESC, ge.created_at DESC`,
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

exports.deleteGroupExpense = async (req, res) => {
  const client = await pool.connect();

  try {
    const { expense_id } = req.params;
    const userId = req.query.user_id || req.body?.user_id;

    if (!isUUID(expense_id) || !isUUID(userId)) {
      return res.status(400).json({
        error: "expense_id and user_id must be valid UUID values"
      });
    }

    const expenseResult = await client.query(
      `SELECT
         ge.id,
         ge.group_id,
         ge.title,
         ge.amount,
         ge.created_by_user_id,
         ge.approval_status,
         g.owner_user_id
       FROM group_expenses ge
       JOIN groups g
         ON g.id = ge.group_id
       WHERE ge.id = $1`,
      [expense_id]
    );

    if (expenseResult.rowCount === 0) {
      return res.status(404).json({
        error: "Expense not found"
      });
    }

    const expense = expenseResult.rows[0];
    const isOwner = expense.owner_user_id === userId;
    const isPendingCreator =
      expense.created_by_user_id === userId && expense.approval_status === "pending";

    if (!isOwner && !isPendingCreator) {
      return res.status(403).json({
        error: "Only the group owner or pending request creator can delete this expense"
      });
    }

    await client.query(
      `DELETE FROM group_expenses
       WHERE id = $1`,
      [expense_id]
    );

    res.json({
      message: "Expense deleted successfully",
      expense
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
