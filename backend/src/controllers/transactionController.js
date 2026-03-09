const pool = require("../config/db");
const { parseQuickEntry } = require("../utils/quickEntryParser");
const {
  isUUID,
  toPositiveNumber,
  normalizeText,
  clampInteger,
  isValidDateString
} = require("../utils/validators");

const TRANSACTION_TYPES = new Set(["expense", "lend", "settlement"]);

exports.createTransaction = async (req, res) => {
  try {
    const { user_id, friend_id, type, amount, description } = req.body;

    if (!user_id || !friend_id || !type || amount === undefined) {
      return res.status(400).json({
        error: "user_id, friend_id, type and amount are required"
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
      `INSERT INTO transactions
       (user_id, friend_id, type, amount, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, friend_id, type, parsedAmount, normalizeText(description, 500)]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};

exports.getTransactionsByFriend = async (req, res) => {
  try {
    const { friend_id } = req.params;
    const { user_id } = req.query;

    if (!isUUID(friend_id)) {
      return res.status(400).json({
        error: "friend_id must be a valid UUID value"
      });
    }

    const values = [friend_id];
    let query = `SELECT *
       FROM transactions
       WHERE friend_id = $1`;

    if (user_id) {
      if (!isUUID(user_id)) {
        return res.status(400).json({
          error: "user_id must be a valid UUID value"
        });
      }
      values.push(user_id);
      query += ` AND user_id = $${values.length}`;
    }

    const result = await pool.query(
      `${query}
       ORDER BY created_at DESC`,
      values
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};

exports.listUserTransactions = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const page = clampInteger(req.query.page, 1, 1, 10000);
    const limit = clampInteger(req.query.limit, 20, 1, 100);
    const offset = (page - 1) * limit;

    const filters = ["t.user_id = $1"];
    const values = [user_id];

    if (req.query.friend_id) {
      if (!isUUID(req.query.friend_id)) {
        return res.status(400).json({
          error: "friend_id must be a valid UUID value"
        });
      }
      values.push(req.query.friend_id);
      filters.push(`t.friend_id = $${values.length}`);
    }

    if (req.query.type) {
      if (!TRANSACTION_TYPES.has(req.query.type)) {
        return res.status(400).json({
          error: "type filter must be one of expense, lend, settlement"
        });
      }
      values.push(req.query.type);
      filters.push(`t.type = $${values.length}`);
    }

    if (req.query.from) {
      if (!isValidDateString(req.query.from)) {
        return res.status(400).json({
          error: "from must be in YYYY-MM-DD format"
        });
      }
      values.push(req.query.from);
      filters.push(`t.created_at::date >= $${values.length}`);
    }

    if (req.query.to) {
      if (!isValidDateString(req.query.to)) {
        return res.status(400).json({
          error: "to must be in YYYY-MM-DD format"
        });
      }
      values.push(req.query.to);
      filters.push(`t.created_at::date <= $${values.length}`);
    }

    const whereClause = filters.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total_count
       FROM transactions t
       WHERE ${whereClause}`,
      values
    );

    values.push(limit);
    values.push(offset);

    const result = await pool.query(
      `SELECT
         t.id,
         t.user_id,
         t.friend_id,
         f.name AS friend_name,
         t.type,
         t.amount,
         t.description,
         t.created_at
       FROM transactions t
       JOIN friends f ON f.id = t.friend_id
       WHERE ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values
    );

    const totalCount = Number(countResult.rows[0].total_count || 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total_count: totalCount,
        total_pages: totalPages
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};

exports.getTransactionStats = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total_transactions,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense_total,
         COALESCE(SUM(CASE WHEN type = 'lend' THEN amount ELSE 0 END), 0) AS lend_total,
         COALESCE(SUM(CASE WHEN type = 'settlement' THEN amount ELSE 0 END), 0) AS settlement_total,
         COALESCE(
            SUM(
              CASE
                WHEN type IN ('expense', 'lend') THEN amount
                WHEN type = 'settlement' THEN -amount
                ELSE 0
              END
            ),
            0
         ) AS net_outstanding
       FROM transactions
       WHERE user_id = $1`,
      [user_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};

exports.parseQuickTransaction = async (req, res) => {
  try {
    const { input, fallback_type } = req.body;
    const fallbackType =
      typeof fallback_type === "string" && TRANSACTION_TYPES.has(fallback_type)
        ? fallback_type
        : "expense";

    if (!input || typeof input !== "string") {
      return res.status(400).json({
        error: "input text is required"
      });
    }

    const parsed = parseQuickEntry(input, fallbackType);

    res.json({
      ...parsed,
      hints: [
        "Match friend_name_guess with an existing friend before saving",
        "Verify amount and type before submitting"
      ]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};
