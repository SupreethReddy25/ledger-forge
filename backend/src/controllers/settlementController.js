const pool = require("../config/db");
const { createLedgerTransaction } = require("../services/transactionWriteService");
const { isUUID, toPositiveNumber, normalizeText } = require("../utils/validators");
const {
  SETTLEMENT_DIRECTIONS,
  normalizeSettlementDirection,
  inferSettlementDirectionFromBalance,
  balanceCaseExpression
} = require("../utils/ledgerMath");

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

exports.settleDebt = async (req, res) => {
  const client = await pool.connect();

  try {
    const { user_id, friend_id, amount, description, settlement_direction, direction } = req.body;

    if (!user_id || !friend_id || !amount) {
      return res.status(400).json({
        error: "user_id, friend_id and amount are required"
      });
    }

    if (!isUUID(user_id) || !isUUID(friend_id)) {
      return res.status(400).json({
        error: "user_id and friend_id must be valid UUID values"
      });
    }

    const parsedAmount = toPositiveNumber(amount);
    if (!parsedAmount) {
      return res.status(400).json({
        error: "amount must be a number greater than 0"
      });
    }

    const requestedDirection = settlement_direction || direction;
    if (
      requestedDirection !== undefined &&
      !SETTLEMENT_DIRECTIONS.has(normalizeSettlementDirection(requestedDirection, ""))
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
    if (requestedDirection) {
      resolvedSettlementDirection = normalizeSettlementDirection(requestedDirection);
    } else {
      const currentBalance = await getFriendBalance(client, user_id, friend_id);
      resolvedSettlementDirection = inferSettlementDirectionFromBalance(currentBalance);
    }

    const createdTransaction = await createLedgerTransaction(client, {
      userId: user_id,
      friendId: friend_id,
      type: "settlement",
      settlementDirection: resolvedSettlementDirection,
      amount: parsedAmount,
      description: normalizeText(description || "Debt settlement", 500),
      actor: "user",
      source: "manual_settlement"
    });

    await client.query("COMMIT");

    res.status(201).json(createdTransaction);

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
