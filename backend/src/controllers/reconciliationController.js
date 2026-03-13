const pool = require("../config/db");
const { appendLedgerEvent } = require("../services/ledgerEventService");
const { createLedgerTransaction } = require("../services/transactionWriteService");
const { isUUID, normalizeText, toPositiveNumber } = require("../utils/validators");

const TYPE_KEYWORDS = {
  settlement: ["settle", "settlement", "repay", "returned"],
  debt: ["debt", "owe", "owed", "borrow", "borrowed"],
  lend: ["lent", "lend", "loan"],
  expense: ["spent", "expense", "paid", "bill", "split"]
};

function detectType(description) {
  const lower = String(description || "").toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) return type;
  }
  return "expense";
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function parseCsvText(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.trim().toLowerCase()
  );

  const dateIndex = headers.findIndex((value) => ["date", "txn_date"].includes(value));
  const amountIndex = headers.findIndex((value) =>
    ["amount", "value", "debit", "credit"].includes(value)
  );
  const descriptionIndex = headers.findIndex((value) =>
    ["description", "narration", "details", "note"].includes(value)
  );

  const startIndex = dateIndex >= 0 || amountIndex >= 0 ? 1 : 0;

  const entries = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);

    const date = normalizeText(
      dateIndex >= 0 ? cells[dateIndex] : cells[0] || "",
      30
    );
    const amount = cells[amountIndex >= 0 ? amountIndex : 1] || cells[0] || "";
    const description = normalizeText(
      descriptionIndex >= 0 ? cells[descriptionIndex] : cells[cells.length - 1] || "",
      500
    );

    entries.push({
      row_number: i + 1,
      date,
      amount,
      description
    });
  }

  return entries;
}

function parseEntriesInput(body) {
  if (Array.isArray(body.entries) && body.entries.length > 0) {
    return body.entries.map((entry, index) => ({
      row_number: Number(entry.row_number) || index + 1,
      date: normalizeText(entry.date, 30),
      amount: entry.amount,
      description: normalizeText(entry.description, 500)
    }));
  }

  return parseCsvText(body.csv_text);
}

function guessFriend(description, friends) {
  const lower = String(description || "").toLowerCase();
  let best = null;

  for (const friend of friends) {
    const name = String(friend.name || "").trim();
    if (!name) continue;

    if (lower.includes(name.toLowerCase())) {
      if (!best || name.length > best.name.length) {
        best = friend;
      }
    }
  }

  return best;
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function dayDiff(leftDate, rightDate) {
  const left = parseDateSafe(leftDate);
  const right = parseDateSafe(rightDate);
  if (!left || !right) return null;

  const diffMs = Math.abs(left.getTime() - right.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function buildSuggestion(entry, friends, transactions) {
  const amount = toPositiveNumber(entry.amount);
  const parsedType = detectType(entry.description);
  const friendGuess = guessFriend(entry.description, friends);

  if (!amount) {
    return {
      ...entry,
      amount: null,
      parsed_type: parsedType,
      friend_guess: friendGuess,
      recommendation: "invalid_row",
      confidence: 0
    };
  }

  const candidateScores = transactions.map((transaction) => {
    let score = 0.25;

    const amountDelta = Math.abs(Number(transaction.amount) - amount);
    if (amountDelta < 0.01) score += 0.35;
    else if (amountDelta <= 2) score += 0.18;

    if (transaction.type === parsedType) score += 0.2;

    if (friendGuess && friendGuess.id === transaction.friend_id) score += 0.25;

    const createdDate = transaction.created_at;
    const dateDistance = dayDiff(entry.date, createdDate);
    if (dateDistance !== null) {
      if (dateDistance <= 1) score += 0.2;
      else if (dateDistance <= 3) score += 0.12;
      else if (dateDistance <= 7) score += 0.05;
    }

    return {
      transaction_id: transaction.id,
      friend_id: transaction.friend_id,
      friend_name: transaction.friend_name,
      type: transaction.type,
      amount: Number(transaction.amount),
      created_at: transaction.created_at,
      score: Number(Math.min(score, 0.99).toFixed(2))
    };
  });

  candidateScores.sort((a, b) => b.score - a.score);
  const best = candidateScores[0] || null;

  let recommendation = "create_new";
  if (best && best.score >= 0.82) recommendation = "likely_duplicate";
  if (best && best.score >= 0.92) recommendation = "match_existing";

  return {
    ...entry,
    amount,
    parsed_type: parsedType,
    friend_guess: friendGuess
      ? {
          id: friendGuess.id,
          name: friendGuess.name
        }
      : null,
    top_candidates: candidateScores.slice(0, 3),
    recommendation,
    confidence: best ? best.score : friendGuess ? 0.6 : 0.42
  };
}

exports.previewReconciliation = async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const parsedEntries = parseEntriesInput(req.body);
    if (parsedEntries.length === 0) {
      return res.status(400).json({
        error: "No statement rows found. Provide entries[] or csv_text."
      });
    }

    const [friendsResult, transactionsResult] = await Promise.all([
      pool.query(
        `SELECT id, name
         FROM friends
         WHERE user_id = $1`,
        [user_id]
      ),
      pool.query(
        `SELECT
           t.id,
           t.friend_id,
           f.name AS friend_name,
           t.type,
           t.amount,
           t.created_at
         FROM transactions t
         JOIN friends f ON f.id = t.friend_id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC
         LIMIT 2000`,
        [user_id]
      )
    ]);

    const suggestions = parsedEntries.map((entry) =>
      buildSuggestion(entry, friendsResult.rows, transactionsResult.rows)
    );

    const summary = suggestions.reduce(
      (acc, row) => {
        acc.total_rows += 1;
        if (row.recommendation === "match_existing") acc.matched_rows += 1;
        if (row.recommendation === "create_new") acc.new_rows += 1;
        if (row.recommendation === "invalid_row") acc.invalid_rows += 1;
        return acc;
      },
      {
        total_rows: 0,
        matched_rows: 0,
        new_rows: 0,
        invalid_rows: 0
      }
    );

    res.json({
      summary,
      suggestions
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.commitReconciliation = async (req, res) => {
  const client = await pool.connect();

  try {
    const { user_id, source_name, entries, actions } = req.body;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        error: "entries array is required"
      });
    }

    if (!Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({
        error: "actions array is required"
      });
    }

    const entriesByRow = new Map();
    for (const row of entries) {
      entriesByRow.set(Number(row.row_number), row);
    }

    await client.query("BEGIN");

    const importResult = await client.query(
      `INSERT INTO statement_imports
       (user_id, source_name, total_rows)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [user_id, normalizeText(source_name || "manual-import", 180), entries.length]
    );

    const importId = importResult.rows[0].id;

    const statementEntryIds = new Map();
    for (const row of entries) {
      const amount = toPositiveNumber(row.amount) || 0;
      const result = await client.query(
        `INSERT INTO statement_entries
         (import_id, row_number, entry_date, amount, description, suggested_type, confidence_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          importId,
          Number(row.row_number),
          row.date || null,
          amount,
          normalizeText(row.description, 500),
          detectType(row.description),
          Number(row.confidence || 0)
        ]
      );
      statementEntryIds.set(Number(row.row_number), result.rows[0].id);
    }

    let createdRows = 0;
    let matchedRows = 0;
    let ignoredRows = 0;

    for (const action of actions) {
      const rowNumber = Number(action.row_number);
      const entry = entriesByRow.get(rowNumber);
      if (!entry) continue;

      const statementEntryId = statementEntryIds.get(rowNumber);
      const resolution = action.action;

      if (resolution === "ignore") {
        ignoredRows += 1;
        await client.query(
          `UPDATE statement_entries
           SET resolution_action = 'ignore',
               resolved_at = NOW()
           WHERE id = $1`,
          [statementEntryId]
        );
        continue;
      }

      if (resolution === "match_existing") {
        if (!isUUID(action.transaction_id)) {
          throw new Error(`row ${rowNumber}: transaction_id is required for match_existing`);
        }

        matchedRows += 1;
        await client.query(
          `UPDATE statement_entries
           SET resolution_action = 'match_existing',
               resolution_transaction_id = $2,
               resolved_at = NOW()
           WHERE id = $1`,
          [statementEntryId, action.transaction_id]
        );
        continue;
      }

      if (resolution === "create_new") {
        if (!isUUID(action.friend_id)) {
          throw new Error(`row ${rowNumber}: friend_id is required for create_new`);
        }

        const type = ["expense", "lend", "debt", "settlement"].includes(action.type)
          ? action.type
          : detectType(entry.description);

        const amount = toPositiveNumber(entry.amount);
        if (!amount) {
          throw new Error(`row ${rowNumber}: amount must be a positive number`);
        }

        const createdTransaction = await createLedgerTransaction(client, {
          userId: user_id,
          friendId: action.friend_id,
          type,
          amount,
          description: normalizeText(action.description || entry.description, 500),
          actor: "reconciliation",
          source: "statement_import"
        });

        createdRows += 1;

        await client.query(
          `UPDATE statement_entries
           SET resolution_action = 'create_new',
               resolution_transaction_id = $2,
               resolved_at = NOW()
           WHERE id = $1`,
          [statementEntryId, createdTransaction.id]
        );
      }
    }

    await client.query(
      `UPDATE statement_imports
       SET matched_rows = $2,
           created_rows = $3,
           ignored_rows = $4
       WHERE id = $1`,
      [importId, matchedRows, createdRows, ignoredRows]
    );

    await appendLedgerEvent(client, {
      userId: user_id,
      aggregateType: "statement_import",
      aggregateId: importId,
      eventType: "statement.reconciled",
      actor: "reconciliation",
      payload: {
        total_rows: entries.length,
        matched_rows: matchedRows,
        created_rows: createdRows,
        ignored_rows: ignoredRows
      }
    });

    await client.query("COMMIT");

    res.json({
      import_id: importId,
      summary: {
        total_rows: entries.length,
        matched_rows: matchedRows,
        created_rows: createdRows,
        ignored_rows: ignoredRows
      }
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({
      error: err.message || "Internal server error"
    });
  } finally {
    client.release();
  }
};

exports.getImports = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM statement_imports
       WHERE user_id = $1
       ORDER BY imported_at DESC
       LIMIT 50`,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
