const pool = require("../config/db");
const { isUUID } = require("../utils/validators");
const { ensureGroupAccess, simplifyDebts } = require("../services/groupLedgerService");

async function fetchMemberBalances(client, groupId) {
  const result = await client.query(
    `WITH member_base AS (
       SELECT
         gm.id AS member_id,
         gm.display_name,
         gm.member_type,
         gm.user_id,
         gm.friend_id
       FROM group_members gm
       WHERE gm.group_id = $1
     ),
     paid AS (
       SELECT
         ge.paid_by_member_id AS member_id,
         COALESCE(SUM(ge.amount), 0) AS paid_total
       FROM group_expenses ge
       WHERE ge.group_id = $1
         AND ge.approval_status = 'approved'
       GROUP BY ge.paid_by_member_id
     ),
     owed AS (
       SELECT
         ges.member_id,
         COALESCE(SUM(ges.share_amount), 0) AS owe_total
       FROM group_expense_splits ges
       JOIN group_expenses ge
         ON ge.id = ges.expense_id
       WHERE ge.group_id = $1
         AND ge.approval_status = 'approved'
       GROUP BY ges.member_id
     ),
     settled_out AS (
       SELECT
         gs.from_member_id AS member_id,
         COALESCE(SUM(gs.amount), 0) AS settled_out
       FROM group_settlements gs
       WHERE gs.group_id = $1
         AND gs.approval_status = 'approved'
       GROUP BY gs.from_member_id
     ),
     settled_in AS (
       SELECT
         gs.to_member_id AS member_id,
         COALESCE(SUM(gs.amount), 0) AS settled_in
       FROM group_settlements gs
       WHERE gs.group_id = $1
         AND gs.approval_status = 'approved'
       GROUP BY gs.to_member_id
     )
     SELECT
       mb.member_id,
       mb.display_name,
       mb.member_type,
       mb.user_id,
       mb.friend_id,
       COALESCE(p.paid_total, 0) AS paid_total,
       COALESCE(o.owe_total, 0) AS owe_total,
       COALESCE(so.settled_out, 0) AS settled_out,
       COALESCE(si.settled_in, 0) AS settled_in,
       (
         COALESCE(p.paid_total, 0)
         - COALESCE(o.owe_total, 0)
         + COALESCE(so.settled_out, 0)
         - COALESCE(si.settled_in, 0)
       ) AS net_balance
     FROM member_base mb
     LEFT JOIN paid p
       ON p.member_id = mb.member_id
     LEFT JOIN owed o
       ON o.member_id = mb.member_id
     LEFT JOIN settled_out so
       ON so.member_id = mb.member_id
     LEFT JOIN settled_in si
       ON si.member_id = mb.member_id
     ORDER BY mb.display_name ASC`,
    [groupId]
  );

  return result.rows.map((row) => ({
    ...row,
    paid_total: Number(row.paid_total || 0),
    owe_total: Number(row.owe_total || 0),
    settled_out: Number(row.settled_out || 0),
    settled_in: Number(row.settled_in || 0),
    net_balance: Number(row.net_balance || 0)
  }));
}

async function fetchGroupSummary(client, groupId, memberBalances) {
  const summaryResult = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM group_members WHERE group_id = $1) AS member_count,
       (
         SELECT COALESCE(SUM(amount), 0)
         FROM group_expenses
         WHERE group_id = $1
           AND approval_status = 'approved'
       ) AS total_expense,
       (
         SELECT COALESCE(SUM(amount), 0)
         FROM group_settlements
         WHERE group_id = $1
           AND approval_status = 'approved'
       ) AS total_settled,
       (
         SELECT COUNT(*)::int
         FROM group_expenses
         WHERE group_id = $1
           AND approval_status = 'pending'
       ) AS pending_expense_approvals,
       (
         SELECT COUNT(*)::int
         FROM group_settlements
         WHERE group_id = $1
           AND approval_status = 'pending'
       ) AS pending_settlement_approvals`,
    [groupId]
  );

  const base = summaryResult.rows[0] || {};
  const receivable = memberBalances
    .filter((item) => item.net_balance > 0)
    .reduce((sum, item) => sum + item.net_balance, 0);
  const payable = memberBalances
    .filter((item) => item.net_balance < 0)
    .reduce((sum, item) => sum + Math.abs(item.net_balance), 0);

  return {
    member_count: Number(base.member_count || 0),
    total_expense: Number(base.total_expense || 0),
    total_settled: Number(base.total_settled || 0),
    pending_expense_approvals: Number(base.pending_expense_approvals || 0),
    pending_settlement_approvals: Number(base.pending_settlement_approvals || 0),
    total_receivable: Number(receivable.toFixed(2)),
    total_payable: Number(payable.toFixed(2)),
    outstanding_gap: Number(Math.abs(receivable - payable).toFixed(2))
  };
}

async function loadBalancePayload(client, groupId) {
  const members = await fetchMemberBalances(client, groupId);
  const summary = await fetchGroupSummary(client, groupId, members);
  const settlementPlan = simplifyDebts(members);
  return {
    summary,
    members,
    simplified_settlements: settlementPlan
  };
}

exports.getGroupBalances = async (req, res) => {
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

    const payload = await loadBalancePayload(client, group_id);

    res.json({
      group: {
        id: group.id,
        name: group.name,
        owner_user_id: group.owner_user_id,
        require_approval: group.require_approval,
        reminder_interval_days: group.reminder_interval_days
      },
      ...payload
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

exports.getSettlementPlan = async (req, res) => {
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

    const payload = await loadBalancePayload(client, group_id);

    res.json({
      group_id,
      simplified_settlements: payload.simplified_settlements
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
