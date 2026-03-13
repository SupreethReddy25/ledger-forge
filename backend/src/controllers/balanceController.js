const pool = require("../config/db");
const { isUUID, clampInteger } = require("../utils/validators");
const { balanceCaseExpression } = require("../utils/ledgerMath");

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
          SUM(${balanceCaseExpression("t")}),
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
             SUM(${balanceCaseExpression("t")}),
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

exports.getDebtReminders = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const minAmount = Number(req.query.min_amount ?? 100);
    if (!Number.isFinite(minAmount) || minAmount < 0) {
      return res.status(400).json({
        error: "min_amount must be a non-negative number"
      });
    }

    const direction = String(req.query.direction || "all").toLowerCase();
    if (!["all", "collect", "pay"].includes(direction)) {
      return res.status(400).json({
        error: "direction must be one of all, collect, pay"
      });
    }

    const limit = clampInteger(req.query.limit, 12, 1, 100);

    const result = await pool.query(
      `WITH friend_balances AS (
         SELECT
           f.id AS friend_id,
           f.name AS friend_name,
           f.created_at AS friend_created_at,
           COALESCE(
             SUM(${balanceCaseExpression("t")}),
             0
           ) AS balance,
           MAX(t.created_at) AS last_activity_at,
           MAX(CASE WHEN t.type = 'settlement' THEN t.created_at END) AS last_settlement_at
         FROM friends f
         LEFT JOIN transactions t
           ON t.friend_id = f.id
           AND t.user_id = f.user_id
         WHERE f.user_id = $1
         GROUP BY f.id, f.name, f.created_at
       )
       SELECT
         friend_id,
         friend_name,
         balance,
         last_activity_at,
         last_settlement_at,
         CASE
           WHEN balance > 0 THEN 'collect'
           ELSE 'pay'
         END AS reminder_action,
         EXTRACT(
           DAY FROM NOW() - COALESCE(last_settlement_at, last_activity_at, friend_created_at)
         )::int AS days_pending,
         CASE
           WHEN ABS(balance) >= 5000 OR EXTRACT(
             DAY FROM NOW() - COALESCE(last_settlement_at, last_activity_at, friend_created_at)
           ) >= 30 THEN 'high'
           WHEN ABS(balance) >= 1500 OR EXTRACT(
             DAY FROM NOW() - COALESCE(last_settlement_at, last_activity_at, friend_created_at)
           ) >= 14 THEN 'medium'
           ELSE 'low'
         END AS urgency,
         CASE
           WHEN balance > 0 THEN
             friend_name || ' owes you Rs.' || to_char(balance, 'FM999999990.00')
           ELSE
             'You owe ' || friend_name || ' Rs.' || to_char(ABS(balance), 'FM999999990.00')
         END AS reminder_message
       FROM friend_balances
       WHERE balance <> 0
         AND ABS(balance) >= $2
         AND (
           $3 = 'all'
           OR ($3 = 'collect' AND balance > 0)
           OR ($3 = 'pay' AND balance < 0)
         )
       ORDER BY
         CASE
           WHEN ABS(balance) >= 5000 OR EXTRACT(
             DAY FROM NOW() - COALESCE(last_settlement_at, last_activity_at, friend_created_at)
           ) >= 30 THEN 1
           WHEN ABS(balance) >= 1500 OR EXTRACT(
             DAY FROM NOW() - COALESCE(last_settlement_at, last_activity_at, friend_created_at)
           ) >= 14 THEN 2
           ELSE 3
         END,
         ABS(balance) DESC,
         friend_name ASC
       LIMIT $4`,
      [user_id, minAmount, direction, limit]
    );

    const reminders = result.rows.map((row) => ({
      ...row,
      balance: Number(row.balance || 0),
      days_pending: Number(row.days_pending || 0)
    }));

    const summary = reminders.reduce(
      (acc, row) => {
        if (row.reminder_action === "collect") {
          acc.collect_count += 1;
          acc.collect_total += row.balance;
        } else {
          acc.pay_count += 1;
          acc.pay_total += Math.abs(row.balance);
        }
        return acc;
      },
      {
        collect_count: 0,
        pay_count: 0,
        collect_total: 0,
        pay_total: 0
      }
    );

    res.json({
      reminders,
      summary: {
        ...summary,
        collect_total: Number(summary.collect_total.toFixed(2)),
        pay_total: Number(summary.pay_total.toFixed(2))
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
