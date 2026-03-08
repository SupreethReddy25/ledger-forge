const pool = require("../config/db");

exports.settleDebt = async (req, res) => {
  try {
    const { user_id, friend_id, amount, description } = req.body;

    if (!user_id || !friend_id || !amount) {
      return res.status(400).json({
        error: "user_id, friend_id and amount are required"
      });
    }

    const result = await pool.query(
      `INSERT INTO transactions (user_id, friend_id, type, amount, description)
       VALUES ($1, $2, 'settlement', $3, $4)
       RETURNING *`,
      [user_id, friend_id, amount, description || "Debt settlement"]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};