const SETTLEMENT_DIRECTIONS = new Set(["from_friend", "to_friend"]);

function normalizeSettlementDirection(value, fallback = "from_friend") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (SETTLEMENT_DIRECTIONS.has(normalized)) return normalized;
  return fallback;
}

function inferSettlementDirectionFromBalance(balance) {
  return Number(balance) < 0 ? "to_friend" : "from_friend";
}

function signedTransactionAmount(type, amount, settlementDirection = "from_friend") {
  const numeric = Number(amount) || 0;
  const direction = normalizeSettlementDirection(settlementDirection);

  if (type === "expense" || type === "lend") return numeric;
  if (type === "debt") return -numeric;
  if (type === "settlement") {
    return direction === "to_friend" ? numeric : -numeric;
  }

  return 0;
}

function balanceCaseExpression(alias = "") {
  const column = (name) => (alias ? `${alias}.${name}` : name);

  return `CASE
            WHEN ${column("type")} IN ('expense', 'lend') THEN ${column("amount")}
            WHEN ${column("type")} = 'debt' THEN -${column("amount")}
            WHEN ${column("type")} = 'settlement'
                 AND ${column("settlement_direction")} = 'to_friend' THEN ${column("amount")}
            WHEN ${column("type")} = 'settlement' THEN -${column("amount")}
            ELSE 0
          END`;
}

module.exports = {
  SETTLEMENT_DIRECTIONS,
  normalizeSettlementDirection,
  inferSettlementDirectionFromBalance,
  signedTransactionAmount,
  balanceCaseExpression
};
