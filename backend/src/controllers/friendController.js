const pool = require("../config/db");
const { isUUID, normalizeText } = require("../utils/validators");

exports.createFriend = async (req, res) => {
  try {
    const { user_id, name } = req.body;

    if (!user_id || !name) {
      return res.status(400).json({
        error: "user_id and name required"
      });
    }

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const safeName = normalizeText(name, 120);
    if (!safeName) {
      return res.status(400).json({
        error: "name must be non-empty"
      });
    }

    const result = await pool.query(
      `INSERT INTO friends (user_id, name)
       VALUES ($1, $2)
       RETURNING *`,
      [user_id, safeName]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getFriends = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM friends
       WHERE user_id = $1
       ORDER BY name ASC`,
      [user_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.updateFriend = async (req, res) => {
  try {
    const { friend_id } = req.params;
    const { user_id, name } = req.body;

    if (!isUUID(friend_id) || !isUUID(user_id)) {
      return res.status(400).json({
        error: "friend_id and user_id must be valid UUID values"
      });
    }

    const safeName = normalizeText(name, 120);
    if (!safeName) {
      return res.status(400).json({
        error: "name is required"
      });
    }

    const result = await pool.query(
      `UPDATE friends
       SET name = $1
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [safeName, friend_id, user_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Friend not found for this user"
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteFriend = async (req, res) => {
  try {
    const { friend_id } = req.params;
    const { user_id } = req.query;

    if (!isUUID(friend_id) || !isUUID(user_id)) {
      return res.status(400).json({
        error: "friend_id and user_id must be valid UUID values"
      });
    }

    const txResult = await pool.query(
      `SELECT COUNT(*)::int AS tx_count
       FROM transactions
       WHERE friend_id = $1 AND user_id = $2`,
      [friend_id, user_id]
    );

    if (txResult.rows[0].tx_count > 0) {
      return res.status(409).json({
        error:
          "Cannot delete friend with transaction history. Archive strategy is recommended."
      });
    }

    const result = await pool.query(
      `DELETE FROM friends
       WHERE id = $1 AND user_id = $2
       RETURNING id, name`,
      [friend_id, user_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Friend not found for this user"
      });
    }

    res.json({
      message: "Friend deleted successfully",
      friend: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
