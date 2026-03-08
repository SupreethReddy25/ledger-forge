const pool = require("../config/db");

exports.getFriendBalances = async (req, res) => {
  try {

    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT 
          friend_id,
          SUM(
            CASE 
              WHEN type IN ('expense','lend') THEN amount
              WHEN type = 'settlement' THEN -amount
            END
          ) AS balance
       FROM transactions
       WHERE user_id = $1
       GROUP BY friend_id`,
      [user_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};  