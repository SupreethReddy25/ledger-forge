const pool = require("../config/db");

exports.getFriendBalances = async (req, res) => {
  try {

    const { user_id } = req.params;

    const result = await pool.query(
    `
    SELECT 
        f.id AS friend_id,
        f.name AS friend_name,
        SUM(
            CASE
                WHEN t.type IN ('expense','lend') THEN t.amount
                WHEN t.type = 'settlement' THEN -t.amount
            END
        ) AS balance
    FROM transactions t
    JOIN friends f ON t.friend_id = f.id
    WHERE t.user_id = $1
    GROUP BY f.id, f.name
    ORDER BY f.name;
    `,
    [user_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};  