const pool = require("../config/db");
const { isUUID } = require("../utils/validators");

exports.getFriendBalances = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const result = await pool.query(
      `SELECT
        f.id AS friend_id,
        f.name AS friend_name,
        COALESCE(
          SUM(
            CASE
              WHEN t.type IN ('expense', 'lend') THEN t.amount
              WHEN t.type = 'settlement' THEN -t.amount
              ELSE 0
            END
          ),
          0
        ) AS balance
      FROM friends f
      LEFT JOIN transactions t
        ON t.friend_id = f.id
        AND t.user_id = f.user_id
      WHERE f.user_id = $1
      GROUP BY f.id, f.name
      ORDER BY f.name;`,
      [user_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getBalanceSummary = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const result = await pool.query(
      `WITH friend_balances AS (
         SELECT
           f.id AS friend_id,
           COALESCE(
             SUM(
               CASE
                 WHEN t.type IN ('expense', 'lend') THEN t.amount
                 WHEN t.type = 'settlement' THEN -t.amount
                 ELSE 0
               END
             ),
             0
           ) AS balance
         FROM friends f
         LEFT JOIN transactions t
           ON t.friend_id = f.id
           AND t.user_id = f.user_id
         WHERE f.user_id = $1
         GROUP BY f.id
       )
       SELECT
         COUNT(*)::int AS total_friends,
         COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS receivable_total,
         COALESCE(SUM(CASE WHEN balance < 0 THEN ABS(balance) ELSE 0 END), 0) AS payable_total,
         COALESCE(SUM(balance), 0) AS net_position,
         COUNT(*) FILTER (WHERE balance = 0)::int AS settled_friends
       FROM friend_balances`,
      [user_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
