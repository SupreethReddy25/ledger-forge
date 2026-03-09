const pool = require("../config/db");
const { isUUID, clampInteger } = require("../utils/validators");

exports.getAnalyticsOverview = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const months = clampInteger(req.query.months, 6, 1, 24);

    const [monthlyTrend, topExposure, activityByType] = await Promise.all([
      pool.query(
        `WITH month_series AS (
           SELECT generate_series(
             date_trunc('month', CURRENT_DATE) - (($2::int - 1) * interval '1 month'),
             date_trunc('month', CURRENT_DATE),
             interval '1 month'
           ) AS month_start
         ),
         tx AS (
           SELECT
             date_trunc('month', created_at) AS month_start,
             COALESCE(
               SUM(
                 CASE
                   WHEN type IN ('expense', 'lend') THEN amount
                   WHEN type = 'settlement' THEN -amount
                   ELSE 0
                 END
               ),
               0
             ) AS net_change,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense_total,
             COALESCE(SUM(CASE WHEN type = 'lend' THEN amount ELSE 0 END), 0) AS lend_total,
             COALESCE(SUM(CASE WHEN type = 'settlement' THEN amount ELSE 0 END), 0) AS settlement_total
           FROM transactions
           WHERE user_id = $1
             AND created_at >= (
               date_trunc('month', CURRENT_DATE) - (($2::int - 1) * interval '1 month')
             )
           GROUP BY date_trunc('month', created_at)
         )
         SELECT
           to_char(ms.month_start, 'YYYY-MM') AS month,
           COALESCE(tx.net_change, 0) AS net_change,
           COALESCE(tx.expense_total, 0) AS expense_total,
           COALESCE(tx.lend_total, 0) AS lend_total,
           COALESCE(tx.settlement_total, 0) AS settlement_total
         FROM month_series ms
         LEFT JOIN tx ON tx.month_start = ms.month_start
         ORDER BY ms.month_start ASC`,
        [user_id, months]
      ),
      pool.query(
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
         ORDER BY ABS(
           COALESCE(
             SUM(
               CASE
                 WHEN t.type IN ('expense', 'lend') THEN t.amount
                 WHEN t.type = 'settlement' THEN -t.amount
                 ELSE 0
               END
             ),
             0
           )
         ) DESC, f.name ASC
         LIMIT 5`,
        [user_id]
      ),
      pool.query(
        `SELECT
           type,
           COUNT(*)::int AS tx_count,
           COALESCE(SUM(amount), 0) AS total_amount
         FROM transactions
         WHERE user_id = $1
         GROUP BY type
         ORDER BY type ASC`,
        [user_id]
      )
    ]);

    res.json({
      months,
      monthly_trend: monthlyTrend.rows,
      top_exposure: topExposure.rows,
      activity_by_type: activityByType.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
