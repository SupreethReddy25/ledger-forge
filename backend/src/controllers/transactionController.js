const pool = require("../config/db");
const { parseQuickEntry } = require("../utils/quickEntryParser");
const {
  createLedgerTransaction,
  deleteLedgerTransaction
} = require("../services/transactionWriteService");
const {
  isUUID,
  toPositiveNumber,
  normalizeText,
  clampInteger,
  isValidDateString
} = require("../utils/validators");
const {
  SETTLEMENT_DIRECTIONS,
  normalizeSettlementDirection,
  inferSettlementDirectionFromBalance,
  balanceCaseExpression
} = require("../utils/ledgerMath");

const TRANSACTION_TYPES = new Set(["expense", "lend", "debt", "settlement"]);

async function getFriendBalance(client, userId, friendId) {
  const result = await client.query(
    `SELECT COALESCE(SUM(${balanceCaseExpression("t")}), 0) AS balance
     FROM transactions t
     WHERE t.user_id = $1
       AND t.friend_id = $2`,
    [userId, friendId]
  );

  return Number(result.rows[0]?.balance || 0);
}

exports.createTransaction = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      user_id,
      friend_id,
      type,
      amount,
      description,
      source,
      settlement_direction
    } = req.body;

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
        error: "type must be one of expense, lend, debt, settlement"
      });
    }

    const parsedAmount = toPositiveNumber(amount);
    if (!parsedAmount) {
      return res.status(400).json({
        error: "amount must be a number greater than 0"
      });
    }

    if (
      settlement_direction !== undefined &&
      !SETTLEMENT_DIRECTIONS.has(normalizeSettlementDirection(settlement_direction, ""))
    ) {
      return res.status(400).json({
        error: "settlement_direction must be either from_friend or to_friend"
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

    await client.query("BEGIN");

    let resolvedSettlementDirection = "from_friend";
    let inferredFromBalance = null;

    if (type === "settlement") {
      if (settlement_direction) {
        resolvedSettlementDirection = normalizeSettlementDirection(settlement_direction);
      } else {
        const currentBalance = await getFriendBalance(client, user_id, friend_id);
        resolvedSettlementDirection = inferSettlementDirectionFromBalance(currentBalance);
        inferredFromBalance = currentBalance;
      }
    }

    const createdTransaction = await createLedgerTransaction(client, {
      userId: user_id,
      friendId: friend_id,
      type,
      settlementDirection: resolvedSettlementDirection,
      amount: parsedAmount,
      description: normalizeText(description, 500),
      actor: "user",
      source: normalizeText(source || "manual", 60)
    });

    await client.query("COMMIT");

    res.status(201).json({
      ...createdTransaction,
      parser_meta:
        type === "settlement" && inferredFromBalance !== null
          ? {
              settlement_direction_inferred: true,
              inferred_from_balance: Number(inferredFromBalance.toFixed(2))
            }
          : undefined
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
          error: "type filter must be one of expense, lend, debt, settlement"
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
         t.settlement_direction,
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
         COALESCE(SUM(CASE WHEN type = 'debt' THEN amount ELSE 0 END), 0) AS debt_total,
         COALESCE(
           SUM(
             CASE
               WHEN type = 'settlement' AND settlement_direction = 'from_friend' THEN amount
               ELSE 0
             END
           ),
           0
         ) AS settlement_from_friend_total,
         COALESCE(
           SUM(
             CASE
               WHEN type = 'settlement' AND settlement_direction = 'to_friend' THEN amount
               ELSE 0
             END
           ),
           0
         ) AS settlement_to_friend_total,
         COALESCE(SUM(CASE WHEN type = 'settlement' THEN amount ELSE 0 END), 0) AS settlement_total,
         COALESCE(SUM(${balanceCaseExpression()}), 0) AS net_outstanding
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
    const { input, fallback_type, user_id } = req.body;
    const fallbackType =
      typeof fallback_type === "string" && TRANSACTION_TYPES.has(fallback_type)
        ? fallback_type
        : "expense";

    if (!input || typeof input !== "string") {
      return res.status(400).json({
        error: "input text is required"
      });
    }

    let friends = [];
    if (user_id !== undefined) {
      if (!isUUID(user_id)) {
        return res.status(400).json({
          error: "user_id must be a valid UUID value when provided"
        });
      }

      const friendsResult = await pool.query(
        `SELECT id, name
         FROM friends
         WHERE user_id = $1
         ORDER BY name ASC`,
        [user_id]
      );
      friends = friendsResult.rows;
    }

    const parsed = parseQuickEntry(input, {
      fallbackType,
      friends
    });

    const hints = [
      parsed.needs_clarification
        ? "Pick one suggested interpretation before saving."
        : "Review detected friend, amount and type before saving.",
      "You can still override type, friend, amount, and direction manually."
    ];
    if (!parsed.friend_match && parsed.friend_name_guess) {
      hints.push(`No exact friend matched for "${parsed.friend_name_guess}".`);
    }
    if (!parsed.amount) {
      hints.push("Could not detect amount. Add a number like 500, 2k, or 1.5 lakh.");
    }

    res.json({
      ...parsed,
      hints
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};

exports.deleteTransaction = async (req, res) => {
  const client = await pool.connect();

  try {
    const { transaction_id } = req.params;
    const user_id = req.query.user_id || req.body?.user_id;
    const reason = req.query.reason || req.body?.reason || "manual_delete";

    if (!isUUID(transaction_id) || !isUUID(user_id)) {
      return res.status(400).json({
        error: "transaction_id and user_id must be valid UUID values"
      });
    }

    await client.query("BEGIN");

    const deletedTransaction = await deleteLedgerTransaction(client, {
      transactionId: transaction_id,
      userId: user_id,
      actor: "user",
      reason: normalizeText(reason, 120)
    });

    if (!deletedTransaction) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Transaction not found for this user"
      });
    }

    await client.query("COMMIT");

    res.json({
      message: "Transaction deleted successfully",
      transaction: deletedTransaction
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
