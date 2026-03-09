const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function runMigrations() {
  const migrationPath = path.join(__dirname, "..", "..", "sql", "001_schema.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");

  try {
    await pool.query(sql);
    console.log("Migrations applied successfully.");
  } catch (error) {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runMigrations();
