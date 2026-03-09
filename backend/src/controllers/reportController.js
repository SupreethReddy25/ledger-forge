const pool = require("../config/db");
const { isUUID, isValidDateString } = require("../utils/validators");

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

exports.exportTransactionsCsv = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

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

    const result = await pool.query(
      `SELECT
         t.id,
         t.created_at,
         f.name AS friend_name,
         t.type,
         t.amount,
         t.description
       FROM transactions t
       JOIN friends f ON f.id = t.friend_id
       WHERE ${whereClause}
       ORDER BY t.created_at DESC`,
      values
    );

    const headers = [
      "transaction_id",
      "created_at",
      "friend_name",
      "type",
      "amount",
      "description"
    ];

    const lines = [headers.join(",")];

    for (const row of result.rows) {
      lines.push(
        [
          csvEscape(row.id),
          csvEscape(row.created_at.toISOString()),
          csvEscape(row.friend_name),
          csvEscape(row.type),
          csvEscape(row.amount),
          csvEscape(row.description)
        ].join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ledger-report-${user_id.slice(0, 8)}.csv"`
    );

    res.status(200).send(lines.join("\n"));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
