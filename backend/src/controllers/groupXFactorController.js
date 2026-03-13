const crypto = require("crypto");
const pool = require("../config/db");
const { isUUID, normalizeText, clampInteger } = require("../utils/validators");
const {
  ensureGroupOwner,
  ensureGroupAccess,
  ensureGroupUserMember,
  simplifyDebts
} = require("../services/groupLedgerService");

function toIsoDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function addDays(baseDate, days) {
  const result = new Date(baseDate);
  result.setDate(result.getDate() + days);
  return result;
}

function buildInviteCode() {
  return `lf_${crypto.randomBytes(12).toString("hex")}`;
}

async function findOwnerMember(client, groupId, ownerUserId) {
  const ownerMember = await ensureGroupUserMember(client, groupId, ownerUserId);
  if (ownerMember) return ownerMember;

  const fallback = await client.query(
    `SELECT id, display_name
     FROM group_members
     WHERE group_id = $1
       AND member_type = 'user'
       AND user_id = $2`,
    [groupId, ownerUserId]
  );

  return fallback.rows[0] || null;
}

exports.updateGroupSettings = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id } = req.params;
    const { user_id } = req.body;

    if (!isUUID(group_id) || !isUUID(user_id)) {
      return res.status(400).json({
        error: "group_id and user_id must be valid UUID values"
      });
    }

    const group = await ensureGroupOwner(client, group_id, user_id);
    if (!group) {
      return res.status(404).json({
        error: "Group not found for this owner"
      });
    }

    const fields = [];
    const values = [];

    if (req.body.require_approval !== undefined) {
      if (typeof req.body.require_approval !== "boolean") {
        return res.status(400).json({
          error: "require_approval must be boolean"
        });
      }
      values.push(req.body.require_approval);
      fields.push(`require_approval = $${values.length}`);
    }

    if (req.body.reminder_interval_days !== undefined) {
      const interval = Number.parseInt(req.body.reminder_interval_days, 10);
      if (!Number.isFinite(interval) || interval < 1 || interval > 30) {
        return res.status(400).json({
          error: "reminder_interval_days must be between 1 and 30"
        });
      }
      values.push(interval);
      fields.push(`reminder_interval_days = $${values.length}`);
    }

    if (!fields.length) {
      return res.status(400).json({
        error: "At least one settings field is required"
      });
    }

    values.push(group_id);

    const updated = await client.query(
      `UPDATE groups
       SET ${fields.join(", ")}
       WHERE id = $${values.length}
       RETURNING
         id,
         owner_user_id,
         name,
         description,
         require_approval,
         reminder_interval_days,
         created_at`,
      values
    );

    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  } finally {
    client.release();
  }
};

exports.createGroupInvite = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id } = req.params;
    const { user_id } = req.body;

    if (!isUUID(group_id) || !isUUID(user_id)) {
      return res.status(400).json({
        error: "group_id and user_id must be valid UUID values"
      });
    }

    const group = await ensureGroupOwner(client, group_id, user_id);
    if (!group) {
      return res.status(404).json({
        error: "Group not found for this owner"
      });
    }

    const expiresInHours = clampInteger(req.body.expires_in_hours, 72, 1, 24 * 30);
    const maxUses = clampInteger(req.body.max_uses, 25, 1, 1000);
    const expiresAt = addDays(new Date(), expiresInHours / 24);

    let createdInvite = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = buildInviteCode();
      try {
        const result = await client.query(
          `INSERT INTO group_invites (
             group_id,
             created_by_user_id,
             invite_code,
             expires_at,
             max_uses
           )
           VALUES ($1, $2, $3, $4, $5)
           RETURNING
             id,
             group_id,
             created_by_user_id,
             invite_code,
             expires_at,
             max_uses,
             used_count,
             revoked_at,
             created_at`,
          [group_id, user_id, inviteCode, expiresAt.toISOString(), maxUses]
        );
        createdInvite = result.rows[0];
        break;
      } catch (err) {
        if (err.code !== "23505") throw err;
      }
    }

    if (!createdInvite) {
      return res.status(500).json({
        error: "Could not generate invite code. Try again."
      });
    }

    res.status(201).json({
      ...createdInvite,
      invite_link: `/groups/invites/${createdInvite.invite_code}/accept`
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

exports.listGroupInvites = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id } = req.params;
    const userId = req.query.user_id;

    if (!isUUID(group_id) || !isUUID(userId)) {
      return res.status(400).json({
        error: "group_id and user_id must be valid UUID values"
      });
    }

    const group = await ensureGroupOwner(client, group_id, userId);
    if (!group) {
      return res.status(404).json({
        error: "Group not found for this owner"
      });
    }

    const result = await client.query(
      `SELECT
         gi.id,
         gi.group_id,
         gi.created_by_user_id,
         gi.invite_code,
         gi.expires_at,
         gi.max_uses,
         gi.used_count,
         gi.revoked_at,
         gi.created_at,
         (gi.revoked_at IS NULL AND gi.expires_at > NOW() AND gi.used_count < gi.max_uses) AS is_active
       FROM group_invites gi
       WHERE gi.group_id = $1
       ORDER BY gi.created_at DESC`,
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

exports.revokeGroupInvite = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id, invite_id } = req.params;
    const userId = req.query.user_id || req.body?.user_id;

    if (!isUUID(group_id) || !isUUID(invite_id) || !isUUID(userId)) {
      return res.status(400).json({
        error: "group_id, invite_id and user_id must be valid UUID values"
      });
    }

    const group = await ensureGroupOwner(client, group_id, userId);
    if (!group) {
      return res.status(404).json({
        error: "Group not found for this owner"
      });
    }

    const revoked = await client.query(
      `UPDATE group_invites
       SET revoked_at = NOW()
       WHERE id = $1
         AND group_id = $2
         AND revoked_at IS NULL
       RETURNING id, invite_code, revoked_at`,
      [invite_id, group_id]
    );

    if (revoked.rowCount === 0) {
      return res.status(404).json({
        error: "Active invite not found"
      });
    }

    res.json({
      message: "Invite revoked",
      invite: revoked.rows[0]
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

exports.acceptInvite = async (req, res) => {
  const client = await pool.connect();

  try {
    const inviteCode = String(req.params.invite_code || "").trim();
    const { user_id, display_name } = req.body;

    if (!inviteCode || !isUUID(user_id)) {
      return res.status(400).json({
        error: "invite_code and user_id are required"
      });
    }

    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, name
       FROM users
       WHERE id = $1`,
      [user_id]
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "user_id was not found"
      });
    }

    const inviteResult = await client.query(
      `SELECT
         gi.id,
         gi.group_id,
         gi.invite_code,
         gi.expires_at,
         gi.max_uses,
         gi.used_count,
         gi.revoked_at,
         g.name AS group_name
       FROM group_invites gi
       JOIN groups g
         ON g.id = gi.group_id
       WHERE gi.invite_code = $1
       FOR UPDATE`,
      [inviteCode]
    );

    if (inviteResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Invite code not found"
      });
    }

    const invite = inviteResult.rows[0];
    const now = new Date();

    if (invite.revoked_at) {
      await client.query("ROLLBACK");
      return res.status(410).json({
        error: "Invite was revoked"
      });
    }

    if (new Date(invite.expires_at) <= now) {
      await client.query("ROLLBACK");
      return res.status(410).json({
        error: "Invite has expired"
      });
    }

    if (Number(invite.used_count) >= Number(invite.max_uses)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Invite has reached max uses"
      });
    }

    const existingMember = await client.query(
      `SELECT id, display_name
       FROM group_members
       WHERE group_id = $1
         AND member_type = 'user'
         AND user_id = $2`,
      [invite.group_id, user_id]
    );

    if (existingMember.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.json({
        message: "User already belongs to this group",
        group_id: invite.group_id,
        group_name: invite.group_name,
        member: existingMember.rows[0]
      });
    }

    const safeDisplayName =
      normalizeText(display_name, 160) || normalizeText(userResult.rows[0].name, 160) || "Member";

    const insertedMember = await client.query(
      `INSERT INTO group_members (
         group_id,
         member_type,
         user_id,
         display_name
       )
       VALUES ($1, 'user', $2, $3)
       RETURNING id, group_id, member_type, user_id, display_name, created_at`,
      [invite.group_id, user_id, safeDisplayName]
    );

    await client.query(
      `UPDATE group_invites
       SET used_count = used_count + 1
       WHERE id = $1`,
      [invite.id]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Joined group successfully",
      group_id: invite.group_id,
      group_name: invite.group_name,
      member: insertedMember.rows[0]
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({
        error: "User already joined this group"
      });
    }
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  } finally {
    client.release();
  }
};

exports.listPendingApprovals = async (req, res) => {
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
      `SELECT *
       FROM (
         SELECT
           ge.id AS entity_id,
           'expense'::text AS entity_type,
           ge.title AS headline,
           ge.notes,
           ge.amount,
           ge.expense_date::text AS activity_date,
           ge.created_at,
           ge.created_by_user_id,
           creator.name AS created_by_name,
           payer.display_name AS primary_member,
           NULL::text AS secondary_member
         FROM group_expenses ge
         JOIN group_members payer
           ON payer.id = ge.paid_by_member_id
         LEFT JOIN users creator
           ON creator.id = ge.created_by_user_id
         WHERE ge.group_id = $1
           AND ge.approval_status = 'pending'

         UNION ALL

         SELECT
           gs.id AS entity_id,
           'settlement'::text AS entity_type,
           COALESCE(gs.notes, 'Settlement') AS headline,
           gs.notes,
           gs.amount,
           gs.settled_at::text AS activity_date,
           gs.created_at,
           gs.created_by_user_id,
           creator.name AS created_by_name,
           sender.display_name AS primary_member,
           receiver.display_name AS secondary_member
         FROM group_settlements gs
         JOIN group_members sender
           ON sender.id = gs.from_member_id
         JOIN group_members receiver
           ON receiver.id = gs.to_member_id
         LEFT JOIN users creator
           ON creator.id = gs.created_by_user_id
         WHERE gs.group_id = $1
           AND gs.approval_status = 'pending'
       ) items
       ORDER BY created_at DESC`,
      [group_id]
    );

    res.json({
      is_owner: group.owner_user_id === userId,
      pending_items: result.rows
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

exports.decideApproval = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id, entity_type, entity_id } = req.params;
    const { user_id, decision, note } = req.body;

    if (!isUUID(group_id) || !isUUID(entity_id) || !isUUID(user_id)) {
      return res.status(400).json({
        error: "group_id, entity_id and user_id must be valid UUID values"
      });
    }

    if (!["expense", "settlement"].includes(entity_type)) {
      return res.status(400).json({
        error: "entity_type must be one of expense or settlement"
      });
    }

    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({
        error: "decision must be one of approved or rejected"
      });
    }

    await client.query("BEGIN");

    const group = await ensureGroupOwner(client, group_id, user_id);
    if (!group) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Group not found for this owner"
      });
    }

    const ownerMember = await findOwnerMember(client, group_id, user_id);
    if (!ownerMember) {
      await client.query("ROLLBACK");
      return res.status(500).json({
        error: "Owner member identity is missing for this group"
      });
    }

    const table = entity_type === "expense" ? "group_expenses" : "group_settlements";
    const idColumn = "id";

    const updated = await client.query(
      `UPDATE ${table}
       SET
         approval_status = $1,
         approval_note = $2,
         approved_by_member_id = $3,
         approved_at = NOW()
       WHERE ${idColumn} = $4
         AND group_id = $5
         AND approval_status = 'pending'
       RETURNING id, group_id, approval_status, approval_note, approved_at`,
      [decision, normalizeText(note, 500), ownerMember.id, entity_id, group_id]
    );

    if (updated.rowCount === 0) {
      const exists = await client.query(
        `SELECT approval_status
         FROM ${table}
         WHERE ${idColumn} = $1
           AND group_id = $2`,
        [entity_id, group_id]
      );

      await client.query("ROLLBACK");

      if (exists.rowCount === 0) {
        return res.status(404).json({
          error: `${entity_type} request not found`
        });
      }

      return res.status(409).json({
        error: `${entity_type} request is already ${exists.rows[0].approval_status}`
      });
    }

    await client.query("COMMIT");

    res.json({
      message: `${entity_type} ${decision}`,
      item: updated.rows[0]
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

async function fetchReminderBalances(client, groupId) {
  const result = await client.query(
    `WITH member_base AS (
       SELECT
         gm.id AS member_id,
         gm.display_name
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
       (
         COALESCE(p.paid_total, 0)
         - COALESCE(o.owe_total, 0)
         + COALESCE(so.settled_out, 0)
         - COALESCE(si.settled_in, 0)
       ) AS net_balance
     FROM member_base mb
     LEFT JOIN paid p ON p.member_id = mb.member_id
     LEFT JOIN owed o ON o.member_id = mb.member_id
     LEFT JOIN settled_out so ON so.member_id = mb.member_id
     LEFT JOIN settled_in si ON si.member_id = mb.member_id
     ORDER BY mb.display_name`,
    [groupId]
  );

  return result.rows.map((row) => ({
    member_id: row.member_id,
    display_name: row.display_name,
    net_balance: Number(row.net_balance || 0)
  }));
}

exports.getReminderSuggestions = async (req, res) => {
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

    const memberBalances = await fetchReminderBalances(client, group_id);
    const settlementPlan = simplifyDebts(memberBalances);

    const lastActivityResult = await client.query(
      `SELECT MAX(activity_time) AS last_activity_at
       FROM (
         SELECT ge.created_at AS activity_time
         FROM group_expenses ge
         WHERE ge.group_id = $1
           AND ge.approval_status = 'approved'
         UNION ALL
         SELECT gs.created_at AS activity_time
         FROM group_settlements gs
         WHERE gs.group_id = $1
           AND gs.approval_status = 'approved'
       ) activity`,
      [group_id]
    );

    const lastActivityAt = lastActivityResult.rows[0]?.last_activity_at
      ? new Date(lastActivityResult.rows[0].last_activity_at)
      : null;
    const today = new Date();
    const intervalDays = Number(group.reminder_interval_days || 3);
    const daysSinceActivity = lastActivityAt
      ? Math.floor((today.getTime() - lastActivityAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const reminderDue = daysSinceActivity !== null ? daysSinceActivity >= intervalDays : true;
    const scheduleDate = reminderDue
      ? toIsoDate(today)
      : toIsoDate(addDays(today, Math.max(0, intervalDays - daysSinceActivity)));

    const reminders = settlementPlan.map((item) => {
      const amount = Number(item.amount || 0);
      const urgency =
        reminderDue && amount >= 2000 ? "high" : reminderDue ? "medium" : "low";
      return {
        from_member_id: item.from_member_id,
        from_name: item.from_name,
        to_member_id: item.to_member_id,
        to_name: item.to_name,
        amount,
        schedule_date: scheduleDate,
        urgency,
        message: `Reminder: ${item.from_name} should pay ${item.to_name} Rs.${amount.toFixed(2)}`
      };
    });

    res.json({
      group_id,
      reminder_interval_days: intervalDays,
      last_activity_at: lastActivityAt ? lastActivityAt.toISOString() : null,
      days_since_activity: daysSinceActivity,
      reminder_due: reminderDue,
      reminders
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
