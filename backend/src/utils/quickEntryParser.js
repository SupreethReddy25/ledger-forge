const TYPE_KEYWORDS = {
  settlement: ["settle", "settled", "repay", "repaid", "repayment", "returned"],
  lend: ["lend", "lent", "loan", "gave", "given"],
  expense: ["expense", "spent", "paid", "split", "bought"]
};

function detectType(text, fallbackType = "expense") {
  const normalized = text.toLowerCase();

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    const hasKeyword = keywords.some((keyword) => normalized.includes(keyword));
    if (hasKeyword) return type;
  }

  return fallbackType;
}

function extractAmount(text) {
  const match = text.match(/(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d{1,2})?)/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function extractFriendName(text) {
  const match = text.match(
    /\b(?:to|with|from)\s+([a-zA-Z][a-zA-Z\s]{0,40}?)(?=\s+(?:for|on|at)\b|$)/i
  );

  if (!match) return "";
  return match[1].trim().replace(/\s+/g, " ");
}

function parseQuickEntry(input, fallbackType = "expense") {
  const cleanInput = String(input || "").trim();
  if (!cleanInput) {
    return {
      type: fallbackType,
      amount: null,
      friend_name_guess: "",
      description: "",
      confidence: "low"
    };
  }

  const type = detectType(cleanInput, fallbackType);
  const amount = extractAmount(cleanInput);
  const friend_name_guess = extractFriendName(cleanInput);
  const description = cleanInput;

  let score = 0;
  if (type) score += 1;
  if (amount) score += 1;
  if (friend_name_guess) score += 1;

  const confidence = score >= 3 ? "high" : score === 2 ? "medium" : "low";

  return {
    type,
    amount,
    friend_name_guess,
    description,
    confidence
  };
}

module.exports = {
  parseQuickEntry
};
