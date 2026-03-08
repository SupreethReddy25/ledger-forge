const pool = require("../config/db");

exports.createFriend = async (req, res) => {
  try {
    const { user_id, name } = req.body;

    if (!user_id || !name) {
      return res.status(400).json({
        error: "user_id and name required"
      });
    }

    const result = await pool.query(
      `INSERT INTO friends (user_id, name)
       VALUES ($1, $2)
       RETURNING *`,
      [user_id, name]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};