const pool = require("../config/db");

exports.createTransaction = async (req, res) => {
  try {
    const { user_id, friend_id, type, amount, description } = req.body;

    if (!user_id || !friend_id || !type || !amount) {
      return res.status(400).json({
        error: "user_id, friend_id, type and amount are required"
      });
    }

    const result = await pool.query(
      `INSERT INTO transactions
       (user_id, friend_id, type, amount, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, friend_id, type, amount, description]
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

    const result = await pool.query(
      `SELECT *
       FROM transactions
       WHERE friend_id = $1
       ORDER BY created_at DESC`,
      [friend_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};