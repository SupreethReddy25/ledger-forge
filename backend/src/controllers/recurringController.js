const pool = require("../config/db");
const {
  isUUID,
  toPositiveNumber,
  normalizeText,
  isValidDateString
} = require("../utils/validators");

const FREQUENCIES = new Set(["weekly", "monthly"]);
const TRANSACTION_TYPES = new Set(["expense", "lend", "settlement"]);

function addFrequency(dateString, frequency) {
  const date = new Date(`${dateString}T00:00:00.000Z`);

  if (frequency === "weekly") {
    date.setUTCDate(date.getUTCDate() + 7);
  } else {
    date.setUTCMonth(date.getUTCMonth() + 1);
  }

  return date.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

exports.createRecurringRule = async (req, res) => {
  try {
    const {
      user_id,
      friend_id,
      type,
      amount,
      frequency,
      next_due_date,
      description
    } = req.body;

    if (!user_id || !friend_id || !type || !amount || !frequency || !next_due_date) {
      return res.status(400).json({
        error:
          "user_id, friend_id, type, amount, frequency and next_due_date are required"
      });
    }

    if (!isUUID(user_id) || !isUUID(friend_id)) {
      return res.status(400).json({
        error: "user_id and friend_id must be valid UUID values"
      });
    }

    if (!TRANSACTION_TYPES.has(type)) {
      return res.status(400).json({
        error: "type must be one of expense, lend, settlement"
      });
    }

    const parsedAmount = toPositiveNumber(amount);
    if (!parsedAmount) {
      return res.status(400).json({
        error: "amount must be a number greater than 0"
      });
    }

    if (!FREQUENCIES.has(frequency)) {
      return res.status(400).json({
        error: "frequency must be either weekly or monthly"
      });
    }

    if (!isValidDateString(next_due_date)) {
      return res.status(400).json({
        error: "next_due_date must be in YYYY-MM-DD format"
      });
    }

    const friendOwnership = await pool.query(
      `SELECT 1
       FROM friends
       WHERE id = $1 AND user_id = $2`,
      [friend_id, user_id]
    );

    if (friendOwnership.rowCount === 0) {
      return res.status(404).json({
        error: "friend_id does not belong to the given user_id"
      });
    }

    const result = await pool.query(
      `INSERT INTO recurring_rules
       (user_id, friend_id, type, amount, description, frequency, next_due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        user_id,
        friend_id,
        type,
        parsedAmount,
        normalizeText(description, 500),
        frequency,
        next_due_date
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getRecurringRules = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const result = await pool.query(
      `SELECT
         rr.*,
         f.name AS friend_name
       FROM recurring_rules rr
       JOIN friends f ON f.id = rr.friend_id
       WHERE rr.user_id = $1
       ORDER BY rr.active DESC, rr.next_due_date ASC`,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.updateRecurringRule = async (req, res) => {
  try {
    const { rule_id } = req.params;
    const {
      amount,
      description,
      frequency,
      next_due_date,
      active,
      type,
      friend_id
    } = req.body;

    if (!isUUID(rule_id)) {
      return res.status(400).json({
        error: "rule_id must be a valid UUID value"
      });
    }

    const updates = [];
    const values = [];

    if (amount !== undefined) {
      const parsedAmount = toPositiveNumber(amount);
      if (!parsedAmount) {
        return res.status(400).json({
          error: "amount must be a number greater than 0"
        });
      }
      values.push(parsedAmount);
      updates.push(`amount = $${values.length}`);
    }

    if (description !== undefined) {
      values.push(normalizeText(description, 500));
      updates.push(`description = $${values.length}`);
    }

    if (frequency !== undefined) {
      if (!FREQUENCIES.has(frequency)) {
        return res.status(400).json({
          error: "frequency must be either weekly or monthly"
        });
      }
      values.push(frequency);
      updates.push(`frequency = $${values.length}`);
    }

    if (next_due_date !== undefined) {
      if (!isValidDateString(next_due_date)) {
        return res.status(400).json({
          error: "next_due_date must be in YYYY-MM-DD format"
        });
      }
      values.push(next_due_date);
      updates.push(`next_due_date = $${values.length}`);
    }

    if (active !== undefined) {
      values.push(Boolean(active));
      updates.push(`active = $${values.length}`);
    }

    if (type !== undefined) {
      if (!TRANSACTION_TYPES.has(type)) {
        return res.status(400).json({
          error: "type must be one of expense, lend, settlement"
        });
      }
      values.push(type);
      updates.push(`type = $${values.length}`);
    }

    if (friend_id !== undefined) {
      if (!isUUID(friend_id)) {
        return res.status(400).json({
          error: "friend_id must be a valid UUID value"
        });
      }
      values.push(friend_id);
      updates.push(`friend_id = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: "At least one editable field must be provided"
      });
    }

    values.push(rule_id);

    const result = await pool.query(
      `UPDATE recurring_rules
       SET ${updates.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Recurring rule not found"
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.runRecurringRules = async (req, res) => {
  const client = await pool.connect();

  try {
    const { user_id } = req.params;
    const today = todayISO();

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    await client.query("BEGIN");

    const rulesResult = await client.query(
      `SELECT *
       FROM recurring_rules
       WHERE user_id = $1
         AND active = true
         AND next_due_date <= $2
       ORDER BY next_due_date ASC
       FOR UPDATE`,
      [user_id, today]
    );

    let generatedCount = 0;
    const touchedRules = [];

    for (const rule of rulesResult.rows) {
      let nextDue = rule.next_due_date.toISOString().slice(0, 10);
      let iterations = 0;

      // hard stop protects against accidental runaway loops in malformed data
      while (nextDue <= today && iterations < 120) {
        await client.query(
          `INSERT INTO transactions
           (user_id, friend_id, type, amount, description, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::timestamp)`,
          [
            rule.user_id,
            rule.friend_id,
            rule.type,
            rule.amount,
            normalizeText(
              `${rule.description || "Recurring transaction"} [Auto-generated]`,
              500
            ),
            `${nextDue}T10:00:00.000Z`
          ]
        );

        generatedCount += 1;
        iterations += 1;
        nextDue = addFrequency(nextDue, rule.frequency);
      }

      await client.query(
        `UPDATE recurring_rules
         SET next_due_date = $1
         WHERE id = $2`,
        [nextDue, rule.id]
      );

      touchedRules.push({
        rule_id: rule.id,
        generated_transactions: iterations,
        updated_next_due_date: nextDue
      });
    }

    await client.query("COMMIT");

    res.json({
      message: "Recurring transactions generated",
      generated_transactions: generatedCount,
      impacted_rules: touchedRules
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
};
