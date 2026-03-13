const pool = require("../config/db");
const { isUUID, normalizeText, clampInteger } = require("../utils/validators");
const {
  ensureGroupOwner,
  ensureGroupAccess
} = require("../services/groupLedgerService");

async function fetchGroupOverview(client, groupId) {
  const result = await client.query(
    `SELECT
       g.id,
       g.owner_user_id,
       g.name,
       g.description,
       g.require_approval,
       g.reminder_interval_days,
       g.created_at,
       (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
       (
         SELECT COALESCE(SUM(amount), 0)
         FROM group_expenses ge
         WHERE ge.group_id = g.id
           AND ge.approval_status = 'approved'
       ) AS total_expense,
       (
         SELECT COALESCE(SUM(amount), 0)
         FROM group_settlements gs
         WHERE gs.group_id = g.id
           AND gs.approval_status = 'approved'
       ) AS total_settled,
       (
         SELECT COUNT(*)::int
         FROM group_expenses ge
         WHERE ge.group_id = g.id
           AND ge.approval_status = 'pending'
       ) AS pending_expense_approvals,
       (
         SELECT COUNT(*)::int
         FROM group_settlements gs
         WHERE gs.group_id = g.id
           AND gs.approval_status = 'pending'
       ) AS pending_settlement_approvals,
       (
         SELECT MAX(last_ts)
         FROM (
           SELECT MAX(ge.created_at) AS last_ts
           FROM group_expenses ge
           WHERE ge.group_id = g.id
             AND ge.approval_status = 'approved'
           UNION ALL
           SELECT MAX(gs.created_at) AS last_ts
           FROM group_settlements gs
           WHERE gs.group_id = g.id
             AND gs.approval_status = 'approved'
         ) activity
       ) AS last_activity_at
     FROM groups g
     WHERE g.id = $1`,
    [groupId]
  );

  return result.rows[0] || null;
}

exports.createGroup = async (req, res) => {
  const client = await pool.connect();

  try {
    const { owner_user_id, name, description } = req.body;

    if (!isUUID(owner_user_id)) {
      return res.status(400).json({
        error: "owner_user_id must be a valid UUID value"
      });
    }

    const safeName = normalizeText(name, 160);
    if (!safeName) {
      return res.status(400).json({
        error: "name is required"
      });
    }

    await client.query("BEGIN");

    const ownerResult = await client.query(
      `SELECT id, name
       FROM users
       WHERE id = $1`,
      [owner_user_id]
    );

    if (ownerResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "owner_user_id was not found"
      });
    }

    const createdGroupResult = await client.query(
      `INSERT INTO groups (owner_user_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING
         id,
         owner_user_id,
         name,
         description,
         require_approval,
         reminder_interval_days,
         created_at`,
      [owner_user_id, safeName, normalizeText(description, 500)]
    );

    const createdGroup = createdGroupResult.rows[0];
    const ownerName = ownerResult.rows[0].name;

    await client.query(
      `INSERT INTO group_members (group_id, member_type, user_id, display_name)
       VALUES ($1, 'user', $2, $3)`,
      [createdGroup.id, owner_user_id, normalizeText(ownerName, 160) || "Owner"]
    );

    await client.query("COMMIT");

    res.status(201).json({
      ...createdGroup,
      owner_member_added: true
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

exports.listUserGroups = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const result = await pool.query(
      `SELECT
         g.id,
         g.owner_user_id,
         g.name,
         g.description,
         g.require_approval,
         g.reminder_interval_days,
         g.created_at,
         (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
         (
           SELECT COALESCE(SUM(amount), 0)
           FROM group_expenses ge
           WHERE ge.group_id = g.id
             AND ge.approval_status = 'approved'
         ) AS total_expense,
         (
           SELECT COALESCE(SUM(amount), 0)
           FROM group_settlements gs
           WHERE gs.group_id = g.id
             AND gs.approval_status = 'approved'
         ) AS total_settled,
         (
           SELECT COUNT(*)::int
           FROM group_expenses ge
           WHERE ge.group_id = g.id
             AND ge.approval_status = 'pending'
         ) AS pending_expense_approvals,
         (
           SELECT COUNT(*)::int
           FROM group_settlements gs
           WHERE gs.group_id = g.id
             AND gs.approval_status = 'pending'
         ) AS pending_settlement_approvals,
         (
           SELECT MAX(last_ts)
           FROM (
             SELECT MAX(ge.created_at) AS last_ts
             FROM group_expenses ge
             WHERE ge.group_id = g.id
               AND ge.approval_status = 'approved'
             UNION ALL
             SELECT MAX(gs.created_at) AS last_ts
             FROM group_settlements gs
             WHERE gs.group_id = g.id
               AND gs.approval_status = 'approved'
           ) activity
         ) AS last_activity_at
       FROM groups g
       WHERE g.owner_user_id = $1
         OR EXISTS (
           SELECT 1
           FROM group_members gm
           WHERE gm.group_id = g.id
             AND gm.member_type = 'user'
             AND gm.user_id = $1
         )
       ORDER BY COALESCE((
         SELECT MAX(last_ts)
         FROM (
           SELECT MAX(ge.created_at) AS last_ts
           FROM group_expenses ge
           WHERE ge.group_id = g.id
             AND ge.approval_status = 'approved'
           UNION ALL
           SELECT MAX(gs.created_at) AS last_ts
           FROM group_settlements gs
           WHERE gs.group_id = g.id
             AND gs.approval_status = 'approved'
         ) activity
       ), g.created_at) DESC, g.name ASC`,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};

exports.getGroupById = async (req, res) => {
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

    const overview = await fetchGroupOverview(client, group_id);

    res.json(overview);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  } finally {
    client.release();
  }
};

exports.updateGroup = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id } = req.params;
    const { user_id, name, description } = req.body;

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

    if (name !== undefined) {
      const safeName = normalizeText(name, 160);
      if (!safeName) {
        return res.status(400).json({
          error: "name cannot be empty"
        });
      }
      values.push(safeName);
      fields.push(`name = $${values.length}`);
    }

    if (description !== undefined) {
      values.push(normalizeText(description, 500));
      fields.push(`description = $${values.length}`);
    }

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
      const parsed = Number.parseInt(req.body.reminder_interval_days, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 30) {
        return res.status(400).json({
          error: "reminder_interval_days must be between 1 and 30"
        });
      }
      values.push(parsed);
      fields.push(`reminder_interval_days = $${values.length}`);
    }

    if (!fields.length) {
      return res.status(400).json({
        error: "At least one editable field is required"
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

exports.deleteGroup = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id } = req.params;
    const userId = req.query.user_id || req.body?.user_id;

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

    await client.query(
      `DELETE FROM groups
       WHERE id = $1`,
      [group_id]
    );

    res.json({
      message: "Group deleted successfully"
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

exports.listGroupMembers = async (req, res) => {
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
         id,
         group_id,
         member_type,
         user_id,
         friend_id,
         display_name,
         created_at
       FROM group_members
       WHERE group_id = $1
       ORDER BY display_name ASC`,
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

exports.addGroupMember = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id } = req.params;
    const { user_id, member_type, friend_id, member_user_id, display_name } = req.body;

    if (!isUUID(group_id) || !isUUID(user_id)) {
      return res.status(400).json({
        error: "group_id and user_id must be valid UUID values"
      });
    }

    if (!member_type || !["user", "friend"].includes(member_type)) {
      return res.status(400).json({
        error: "member_type must be one of user or friend"
      });
    }

    const group = await ensureGroupOwner(client, group_id, user_id);
    if (!group) {
      return res.status(404).json({
        error: "Group not found for this owner"
      });
    }

    let resolvedUserId = null;
    let resolvedFriendId = null;
    let resolvedName = normalizeText(display_name, 160);

    if (member_type === "user") {
      if (!isUUID(member_user_id)) {
        return res.status(400).json({
          error: "member_user_id must be a valid UUID value for user members"
        });
      }

      const userRow = await client.query(
        `SELECT id, name
         FROM users
         WHERE id = $1`,
        [member_user_id]
      );

      if (userRow.rowCount === 0) {
        return res.status(404).json({
          error: "member_user_id not found"
        });
      }

      resolvedUserId = member_user_id;
      if (!resolvedName) resolvedName = normalizeText(userRow.rows[0].name, 160);
    } else {
      if (!isUUID(friend_id)) {
        return res.status(400).json({
          error: "friend_id must be a valid UUID value for friend members"
        });
      }

      const friendRow = await client.query(
        `SELECT id, name
         FROM friends
         WHERE id = $1 AND user_id = $2`,
        [friend_id, group.owner_user_id]
      );

      if (friendRow.rowCount === 0) {
        return res.status(404).json({
          error: "friend_id not found for this group owner"
        });
      }

      resolvedFriendId = friend_id;
      if (!resolvedName) resolvedName = normalizeText(friendRow.rows[0].name, 160);
    }

    const createdMember = await client.query(
      `INSERT INTO group_members (
         group_id,
         member_type,
         user_id,
         friend_id,
         display_name
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id,
         group_id,
         member_type,
         user_id,
         friend_id,
         display_name,
         created_at`,
      [group_id, member_type, resolvedUserId, resolvedFriendId, resolvedName || "Member"]
    );

    res.status(201).json(createdMember.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "This member is already added to the group"
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

exports.removeGroupMember = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id, member_id } = req.params;
    const userId = req.query.user_id || req.body?.user_id;

    if (!isUUID(group_id) || !isUUID(member_id) || !isUUID(userId)) {
      return res.status(400).json({
        error: "group_id, member_id and user_id must be valid UUID values"
      });
    }

    const group = await ensureGroupOwner(client, group_id, userId);
    if (!group) {
      return res.status(404).json({
        error: "Group not found for this owner"
      });
    }

    const memberResult = await client.query(
      `SELECT
         id,
         group_id,
         member_type,
         user_id,
         friend_id,
         display_name
       FROM group_members
       WHERE id = $1 AND group_id = $2`,
      [member_id, group_id]
    );

    if (memberResult.rowCount === 0) {
      return res.status(404).json({
        error: "Member not found in this group"
      });
    }

    const member = memberResult.rows[0];
    if (member.member_type === "user" && member.user_id === group.owner_user_id) {
      return res.status(400).json({
        error: "Owner member cannot be removed from the group"
      });
    }

    await client.query(
      `DELETE FROM group_members
       WHERE id = $1 AND group_id = $2`,
      [member_id, group_id]
    );

    res.json({
      message: "Member removed successfully",
      member
    });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({
        error: "Cannot remove member with existing expenses/splits/settlements"
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

exports.getGroupActivity = async (req, res) => {
  const client = await pool.connect();

  try {
    const { group_id } = req.params;
    const userId = req.query.user_id;
    const limit = clampInteger(req.query.limit, 40, 1, 200);

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
           ge.id,
           ge.group_id,
           'expense'::text AS activity_type,
           ge.title AS headline,
           ge.notes,
           ge.amount,
           ge.expense_date::text AS activity_date,
           ge.created_at,
           payer.display_name AS actor_name,
           NULL::text AS counterparty_name
         FROM group_expenses ge
         JOIN group_members payer
           ON payer.id = ge.paid_by_member_id
         WHERE ge.group_id = $1
           AND ge.approval_status = 'approved'

         UNION ALL

         SELECT
           gs.id,
           gs.group_id,
           'settlement'::text AS activity_type,
           COALESCE(gs.notes, 'Settlement') AS headline,
           gs.notes,
           gs.amount,
           gs.settled_at::text AS activity_date,
           gs.created_at,
           sender.display_name AS actor_name,
           receiver.display_name AS counterparty_name
         FROM group_settlements gs
         JOIN group_members sender
           ON sender.id = gs.from_member_id
         JOIN group_members receiver
           ON receiver.id = gs.to_member_id
         WHERE gs.group_id = $1
           AND gs.approval_status = 'approved'
       ) activity
       ORDER BY created_at DESC
       LIMIT $2`,
      [group_id, limit]
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
