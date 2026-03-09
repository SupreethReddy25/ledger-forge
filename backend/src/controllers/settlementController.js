const pool = require("../config/db");
const { isUUID, toPositiveNumber, normalizeText } = require("../utils/validators");

exports.settleDebt = async (req, res) => {
  try {
    const { user_id, friend_id, amount, description } = req.body;

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
      `INSERT INTO transactions (user_id, friend_id, type, amount, description)
       VALUES ($1, $2, 'settlement', $3, $4)
       RETURNING *`,
      [
        user_id,
        friend_id,
        parsedAmount,
        normalizeText(description || "Debt settlement", 500)
      ]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};
