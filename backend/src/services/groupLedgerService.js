const { isUUID, toPositiveNumber } = require("../utils/validators");

function toCents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

function fromCents(cents) {
  return Number((cents / 100).toFixed(2));
}

function readPositiveAmount(value) {
  const parsed = toPositiveNumber(value);
  return parsed ? Number(parsed.toFixed(2)) : null;
}

async function ensureGroupOwner(client, groupId, userId) {
  const result = await client.query(
    `SELECT
       id,
       owner_user_id,
       name,
       description,
       require_approval,
       reminder_interval_days,
       created_at
     FROM groups
     WHERE id = $1 AND owner_user_id = $2`,
    [groupId, userId]
  );
  return result.rows[0] || null;
}

async function ensureGroupAccess(client, groupId, userId) {
  const result = await client.query(
    `SELECT
       g.id,
       g.owner_user_id,
       g.name,
       g.description,
       g.require_approval,
       g.reminder_interval_days,
       g.created_at
     FROM groups g
     WHERE g.id = $1
       AND (
         g.owner_user_id = $2
         OR EXISTS (
           SELECT 1
           FROM group_members gm
           WHERE gm.group_id = g.id
             AND gm.member_type = 'user'
             AND gm.user_id = $2
         )
       )`,
    [groupId, userId]
  );
  return result.rows[0] || null;
}

async function ensureGroupUserMember(client, groupId, userId) {
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
       AND member_type = 'user'
       AND user_id = $2`,
    [groupId, userId]
  );
  return result.rows[0] || null;
}

async function getGroupMembers(client, groupId) {
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
     ORDER BY display_name`,
    [groupId]
  );
  return result.rows;
}

function validateMemberIds(rawSplits, membersMap) {
  const unique = new Set();
  const rows = [];

  for (const raw of rawSplits) {
    const memberId = typeof raw?.member_id === "string" ? raw.member_id.trim() : "";
    if (!isUUID(memberId)) {
      throw new Error("Every split row must contain a valid member_id");
    }
    if (unique.has(memberId)) {
      throw new Error("Duplicate member_id found in splits");
    }
    if (!membersMap.has(memberId)) {
      throw new Error("One or more split members do not belong to this group");
    }
    unique.add(memberId);
    rows.push({ ...raw, member_id: memberId });
  }

  return rows;
}

function normalizeExpenseSplits({ amount, splitMethod, splits, membersMap }) {
  const totalCents = toCents(amount);
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error("amount must be greater than 0");
  }

  const rawSplits = Array.isArray(splits) ? splits : [];
  const normalizedInputRows = validateMemberIds(rawSplits, membersMap);

  if (splitMethod === "equal") {
    const participantIds = normalizedInputRows.length
      ? normalizedInputRows.map((item) => item.member_id)
      : [...membersMap.keys()];

    if (!participantIds.length) {
      throw new Error("At least one participant is required");
    }

    const base = Math.floor(totalCents / participantIds.length);
    let remaining = totalCents - base * participantIds.length;

    return participantIds.map((memberId) => {
      const cents = base + (remaining > 0 ? 1 : 0);
      remaining -= remaining > 0 ? 1 : 0;
      return {
        member_id: memberId,
        share_amount: fromCents(cents),
        share_percent: null
      };
    });
  }

  if (splitMethod === "exact") {
    if (!normalizedInputRows.length) {
      throw new Error("exact split requires split rows with share_amount");
    }

    let runningTotal = 0;
    const normalized = normalizedInputRows.map((item) => {
      const cents = toCents(item.share_amount);
      if (!Number.isInteger(cents) || cents < 0) {
        throw new Error("share_amount must be a non-negative number");
      }
      runningTotal += cents;
      return {
        member_id: item.member_id,
        share_amount: fromCents(cents),
        share_percent: null
      };
    });

    if (runningTotal !== totalCents) {
      throw new Error("Sum of exact split amounts must match total amount");
    }

    return normalized;
  }

  if (splitMethod === "percentage") {
    if (!normalizedInputRows.length) {
      throw new Error("percentage split requires split rows with share_percent");
    }

    const percentages = normalizedInputRows.map((item, index) => {
      const parsed = Number(item.share_percent);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        throw new Error("share_percent must be between 0 and 100");
      }
      return {
        index,
        member_id: item.member_id,
        percent: Number(parsed.toFixed(2))
      };
    });

    const totalPercent = percentages.reduce((sum, item) => sum + item.percent, 0);
    if (Math.abs(totalPercent - 100) > 0.01) {
      throw new Error("Sum of split percentages must be exactly 100");
    }

    const computed = percentages.map((row) => {
      const exactCents = (totalCents * row.percent) / 100;
      const floorCents = Math.floor(exactCents);
      return {
        ...row,
        floorCents,
        fractional: exactCents - floorCents,
        assigned: floorCents
      };
    });

    let remaining = totalCents - computed.reduce((sum, row) => sum + row.floorCents, 0);

    computed
      .slice()
      .sort((a, b) => {
        if (b.fractional !== a.fractional) return b.fractional - a.fractional;
        return a.index - b.index;
      })
      .forEach((row) => {
        if (remaining <= 0) return;
        computed[row.index].assigned += 1;
        remaining -= 1;
      });

    return computed.map((row) => ({
      member_id: row.member_id,
      share_amount: fromCents(row.assigned),
      share_percent: row.percent
    }));
  }

  throw new Error("split_method must be one of equal, exact, percentage");
}

function simplifyDebts(memberBalances) {
  const creditors = [];
  const debtors = [];

  for (const item of memberBalances) {
    const cents = toCents(item.net_balance);
    if (!Number.isInteger(cents) || cents === 0) continue;

    if (cents > 0) {
      creditors.push({
        member_id: item.member_id,
        display_name: item.display_name,
        cents
      });
    } else {
      debtors.push({
        member_id: item.member_id,
        display_name: item.display_name,
        cents: Math.abs(cents)
      });
    }
  }

  creditors.sort((a, b) => b.cents - a.cents);
  debtors.sort((a, b) => b.cents - a.cents);

  const plan = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const transfer = Math.min(debtor.cents, creditor.cents);

    if (transfer > 0) {
      plan.push({
        from_member_id: debtor.member_id,
        from_name: debtor.display_name,
        to_member_id: creditor.member_id,
        to_name: creditor.display_name,
        amount: fromCents(transfer)
      });
    }

    debtor.cents -= transfer;
    creditor.cents -= transfer;

    if (debtor.cents === 0) i += 1;
    if (creditor.cents === 0) j += 1;
  }

  return plan;
}

module.exports = {
  toCents,
  fromCents,
  readPositiveAmount,
  ensureGroupOwner,
  ensureGroupAccess,
  ensureGroupUserMember,
  getGroupMembers,
  normalizeExpenseSplits,
  simplifyDebts
};
