const { appendLedgerEvent } = require("./ledgerEventService");

async function createLedgerTransaction(client, input) {
  const {
    userId,
    friendId,
    type,
    settlementDirection = "from_friend",
    amount,
    description,
    createdAt = null,
    actor = "user",
    source = "manual"
  } = input;

  const params = [userId, friendId, type, settlementDirection, amount, description];
  let insertSql = `INSERT INTO transactions
       (user_id, friend_id, type, settlement_direction, amount, description)`;
  let valuesSql = `VALUES ($1, $2, $3, $4, $5, $6)`;

  if (createdAt) {
    params.push(createdAt);
    insertSql += `, created_at`;
    valuesSql = `VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp)`;
  }

  const txResult = await client.query(
    `${insertSql}
     ${valuesSql}
     RETURNING *`,
    params
  );

  const transaction = txResult.rows[0];

  await appendLedgerEvent(client, {
    userId,
    aggregateType: "transaction",
    aggregateId: transaction.id,
    eventType: "transaction.created",
    actor,
    payload: {
      source,
      transaction
    }
  });

  return transaction;
}

async function deleteLedgerTransaction(client, input) {
  const { transactionId, userId, actor = "user", reason = "manual_delete" } = input;

  const existingResult = await client.query(
    `SELECT *
     FROM transactions
     WHERE id = $1 AND user_id = $2`,
    [transactionId, userId]
  );

  if (existingResult.rowCount === 0) return null;

  const transaction = existingResult.rows[0];

  await client.query(
    `DELETE FROM transactions
     WHERE id = $1 AND user_id = $2`,
    [transactionId, userId]
  );

  await appendLedgerEvent(client, {
    userId,
    aggregateType: "transaction",
    aggregateId: transactionId,
    eventType: "transaction.deleted",
    actor,
    payload: {
      reason,
      transaction
    }
  });

  return transaction;
}

module.exports = {
  createLedgerTransaction,
  deleteLedgerTransaction
};
