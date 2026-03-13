async function appendLedgerEvent(client, event) {
  const {
    userId,
    aggregateType,
    aggregateId,
    eventType,
    payload = {},
    actor = "system"
  } = event;

  await client.query(
    `INSERT INTO ledger_events
     (user_id, aggregate_type, aggregate_id, event_type, payload, actor)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, aggregateType, aggregateId, eventType, payload, actor]
  );
}

module.exports = {
  appendLedgerEvent
};
