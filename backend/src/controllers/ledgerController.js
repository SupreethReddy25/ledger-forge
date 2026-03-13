const pool = require("../config/db");
const { isUUID, clampInteger } = require("../utils/validators");
const { appendLedgerEvent } = require("../services/ledgerEventService");
const { signedTransactionAmount, balanceCaseExpression } = require("../utils/ledgerMath");

function transactionImpact(type, amount, settlementDirection) {
  return signedTransactionAmount(type, amount, settlementDirection);
}

exports.getLedgerEvents = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const page = clampInteger(req.query.page, 1, 1, 10000);
    const limit = clampInteger(req.query.limit, 50, 1, 200);
    const offset = (page - 1) * limit;

    const [countResult, eventsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total_count
         FROM ledger_events
         WHERE user_id = $1`,
        [user_id]
      ),
      pool.query(
        `SELECT
           id,
           aggregate_type,
           aggregate_id,
           event_type,
           payload,
           actor,
           created_at
         FROM ledger_events
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [user_id, limit, offset]
      )
    ]);

    const totalCount = countResult.rows[0].total_count;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    res.json({
      data: eventsResult.rows,
      pagination: {
        page,
        limit,
        total_count: totalCount,
        total_pages: totalPages
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.replayLedger = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    const [eventsResult, friendsResult, liveBalancesResult] = await Promise.all([
      pool.query(
        `SELECT event_type, payload, created_at
         FROM ledger_events
         WHERE user_id = $1
           AND aggregate_type = 'transaction'
           AND event_type IN ('transaction.created', 'transaction.deleted')
         ORDER BY created_at ASC`,
        [user_id]
      ),
      pool.query(
        `SELECT id, name
         FROM friends
         WHERE user_id = $1`,
        [user_id]
      ),
      pool.query(
        `SELECT
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
         GROUP BY f.id`,
        [user_id]
      )
    ]);

    const activeTransactions = new Map();

    for (const event of eventsResult.rows) {
      const transaction = event.payload?.transaction;
      if (!transaction?.id) continue;

      if (event.event_type === "transaction.created") {
        activeTransactions.set(transaction.id, transaction);
      } else if (event.event_type === "transaction.deleted") {
        activeTransactions.delete(transaction.id);
      }
    }

    const friendNameMap = friendsResult.rows.reduce((acc, row) => {
      acc[row.id] = row.name;
      return acc;
    }, {});

    const replayBalanceMap = {};
    for (const friend of friendsResult.rows) {
      replayBalanceMap[friend.id] = 0;
    }

    for (const transaction of activeTransactions.values()) {
      const delta = transactionImpact(
        transaction.type,
        transaction.amount,
        transaction.settlement_direction
      );
      replayBalanceMap[transaction.friend_id] =
        (replayBalanceMap[transaction.friend_id] || 0) + delta;
    }

    const replayRows = Object.entries(replayBalanceMap).map(([friendId, balance]) => ({
      friend_id: friendId,
      friend_name: friendNameMap[friendId] || "Unknown friend",
      balance: Number(balance.toFixed(2))
    }));

    const liveMap = liveBalancesResult.rows.reduce((acc, row) => {
      acc[row.friend_id] = Number(row.balance);
      return acc;
    }, {});

    const diffRows = replayRows
      .map((row) => {
        const live = liveMap[row.friend_id] || 0;
        const replay = row.balance;
        return {
          friend_id: row.friend_id,
          friend_name: row.friend_name,
          live_balance: Number(live.toFixed(2)),
          replay_balance: Number(replay.toFixed(2)),
          delta: Number((replay - live).toFixed(2))
        };
      })
      .filter((row) => row.delta !== 0);

    res.json({
      replay_meta: {
        processed_events: eventsResult.rowCount,
        active_transactions: activeTransactions.size,
        mismatched_friends: diffRows.length
      },
      replay_balances: replayRows.sort((a, b) => a.friend_name.localeCompare(b.friend_name)),
      differences: diffRows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.backfillTransactionEvents = async (req, res) => {
  const client = await pool.connect();

  try {
    const { user_id } = req.params;
    if (!isUUID(user_id)) {
      return res.status(400).json({
        error: "user_id must be a valid UUID value"
      });
    }

    await client.query("BEGIN");

    const missingResult = await client.query(
      `SELECT t.*
       FROM transactions t
       LEFT JOIN ledger_events e
         ON e.aggregate_id = t.id
         AND e.aggregate_type = 'transaction'
         AND e.event_type = 'transaction.created'
       WHERE t.user_id = $1
         AND e.id IS NULL
       ORDER BY t.created_at ASC`,
      [user_id]
    );

    for (const transaction of missingResult.rows) {
      await appendLedgerEvent(client, {
        userId: user_id,
        aggregateType: "transaction",
        aggregateId: transaction.id,
        eventType: "transaction.created",
        actor: "backfill",
        payload: {
          source: "backfill",
          transaction
        }
      });
    }

    await client.query("COMMIT");

    res.json({
      message: "Transaction event backfill completed",
      inserted_events: missingResult.rowCount
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
};
