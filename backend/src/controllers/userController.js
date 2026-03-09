const pool = require("../config/db");
const { normalizeText } = require("../utils/validators");

exports.createUser = async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        error: "Name and email are required"
      });
    }

    const safeName = normalizeText(name, 120);
    const safeEmail = String(email).trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!safeName) {
      return res.status(400).json({
        error: "Name cannot be empty"
      });
    }

    if (!emailRegex.test(safeEmail)) {
      return res.status(400).json({
        error: "Email format is invalid"
      });
    }

    const result = await pool.query(
      `INSERT INTO users (name, email)
       VALUES ($1, $2)
       RETURNING *`,
      [safeName, safeEmail]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error(err);

    if (err.code === "23505") {
      return res.status(409).json({
        error: "User with this email already exists"
      });
    }

    res.status(500).json({
      error: "Internal server error"
    });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
};
