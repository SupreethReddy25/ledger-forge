const DEFAULT_FALLBACK = "expense";

const TYPE_KEYWORDS = {
  settlement: [
    "settle",
    "settled",
    "repay",
    "repaid",
    "repayment",
    "paid back",
    "pay back",
    "returned",
    "return back",
    "got back",
    "received back"
  ],
  debt: ["debt", "owe", "owed", "dues", "borrow", "borrowed", "took"],
  lend: ["lend", "lent", "loan", "gave", "given", "advance"],
  expense: ["expense", "spent", "paid", "split", "bought", "bill", "food", "dinner"]
};

const AMOUNT_MULTIPLIERS = {
  k: 1_000,
  thousand: 1_000,
  l: 100_000,
  lac: 100_000,
  lakh: 100_000,
  m: 1_000_000,
  million: 1_000_000,
  cr: 10_000_000,
  crore: 10_000_000
};

const NAME_STOPWORDS = new Set([
  "me",
  "myself",
  "mine",
  "you",
  "your",
  "my",
  "his",
  "her",
  "their",
  "our",
  "food",
  "dinner",
  "lunch",
  "breakfast",
  "bill",
  "trip",
  "restaurant",
  "weekend",
  "today",
  "yesterday",
  "tomorrow"
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedLower(value) {
  return normalizeText(value).toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(text, word) {
  const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
  return pattern.test(text);
}

function containsAnyKeyword(text, keywords) {
  return keywords.some((keyword) => containsWord(text, keyword));
}

function amountTokenToNumber(token, suffix = "") {
  const numeric = Number(String(token || "").replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const multiplier = AMOUNT_MULTIPLIERS[String(suffix || "").toLowerCase()] || 1;
  const scaled = numeric * multiplier;
  return Number(scaled.toFixed(2));
}

function extractAmount(text) {
  const amountRegex =
    /(?:₹|\binr\b|\brs\.?\b)?\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]+)?)\s*(k|thousand|l|lac|lakh|m|million|cr|crore)?\b/i;
  const match = text.match(amountRegex);
  if (!match) return { amount: null, raw_amount: "" };

  const amount = amountTokenToNumber(match[1], match[2]);
  return {
    amount,
    raw_amount: match[0].trim()
  };
}

function sanitizeNameCandidate(value) {
  const cleaned = normalizeText(String(value || "").replace(/[^a-zA-Z\s]/g, " "));
  if (!cleaned) return "";

  const tokens = cleaned.split(" ").filter(Boolean);
  if (!tokens.length) return "";
  if (tokens.length > 4) return "";
  if (tokens.some((token) => NAME_STOPWORDS.has(token.toLowerCase()))) return "";

  return tokens.join(" ");
}

function extractFriendCandidates(text) {
  const candidates = [];
  const patterns = [
    /\b(?:to|from|with)\s+([a-zA-Z][a-zA-Z\s]{1,35}?)(?=\s+(?:for|on|at|because|towards)\b|$)/gi,
    /\b(?:gave|lent|paid|borrowed|took)\s+([a-zA-Z][a-zA-Z\s]{1,35}?)(?=\s+(?:to|from|for|at|on)\b|\s+\d|$)/gi
  ];

  for (const pattern of patterns) {
    const localMatches = text.matchAll(pattern);
    for (const match of localMatches) {
      const candidate = sanitizeNameCandidate(match[1]);
      if (candidate) candidates.push(candidate);
    }
  }

  return [...new Set(candidates)];
}

function isSubsequence(needle, haystack) {
  if (!needle) return true;
  let pointer = 0;
  for (let index = 0; index < haystack.length; index += 1) {
    if (haystack[index] === needle[pointer]) pointer += 1;
    if (pointer === needle.length) return true;
  }
  return false;
}

function friendScoreFromText(friendName, text, friendCandidates) {
  const lowerText = normalizedLower(text);
  const lowerName = normalizedLower(friendName);
  if (!lowerName) return 0;

  let score = 0;

  if (containsWord(lowerText, lowerName)) score += 130;
  if (lowerText.includes(lowerName)) score += 60;
  if (friendCandidates.some((candidate) => normalizedLower(candidate) === lowerName)) score += 55;
  if (friendCandidates.some((candidate) => normalizedLower(candidate).includes(lowerName))) score += 25;

  const initials = lowerName
    .split(" ")
    .filter(Boolean)
    .map((token) => token[0])
    .join("");
  if (initials && containsWord(lowerText, initials)) score += 22;

  if (isSubsequence(lowerName, lowerText)) score += 10;
  score -= Math.max(0, lowerName.length - 10) * 0.4;

  return Math.max(0, Number(score.toFixed(2)));
}

function resolveFriend(text, friends) {
  const friendCandidates = extractFriendCandidates(text);
  const normalizedFriends = Array.isArray(friends) ? friends : [];

  if (!normalizedFriends.length) {
    return {
      friend_name_guess: friendCandidates[0] || "",
      friend_match: null,
      friend_candidates: []
    };
  }

  const ranked = normalizedFriends
    .map((friend) => ({
      id: friend.id,
      name: friend.name,
      score: friendScoreFromText(friend.name, text, friendCandidates)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.name.localeCompare(right.name);
    });

  const top = ranked[0] || null;
  const friendMatch =
    top && top.score >= 55
      ? {
          id: top.id,
          name: top.name,
          score: top.score
        }
      : null;

  return {
    friend_name_guess: friendMatch?.name || friendCandidates[0] || "",
    friend_match: friendMatch,
    friend_candidates: ranked.slice(0, 3)
  };
}

function addCandidate(candidates, type, settlementDirection, score, reason) {
  if (!type || score <= 0) return;

  const key = `${type}:${settlementDirection || "na"}`;
  const existing = candidates.get(key);
  if (!existing || score > existing.score) {
    candidates.set(key, {
      type,
      settlement_direction: settlementDirection || null,
      score,
      reason
    });
  }
}

function detectIntentCandidates(text, fallbackType) {
  const lower = normalizedLower(text);
  const candidates = new Map();

  let debtScore = 0;
  if (containsAnyKeyword(lower, TYPE_KEYWORDS.debt)) debtScore += 3;
  if (/\btook\b.*\bfrom\b/i.test(lower)) debtScore += 4;
  if (/\bborrow(?:ed)?\b.*\bfrom\b/i.test(lower)) debtScore += 4;
  if (/\bowe(?:d)?\b/i.test(lower)) debtScore += 3;
  addCandidate(candidates, "debt", null, debtScore, "Borrowing language detected.");

  let lendScore = 0;
  if (containsAnyKeyword(lower, TYPE_KEYWORDS.lend)) lendScore += 3;
  if (/\bgave\b.*\bto\b/i.test(lower)) lendScore += 3;
  if (/\blent\b/i.test(lower)) lendScore += 4;
  if (/\bloan\b/i.test(lower)) lendScore += 3;
  if (/\bback\b/i.test(lower)) lendScore -= 2;
  addCandidate(candidates, "lend", null, lendScore, "Lending language detected.");

  let expenseScore = 0;
  if (containsAnyKeyword(lower, TYPE_KEYWORDS.expense)) expenseScore += 2;
  if (/\bpaid\b.*\bfor\b/i.test(lower)) expenseScore += 4;
  if (/\bsplit\b|\bbill\b/i.test(lower)) expenseScore += 3;
  addCandidate(candidates, "expense", null, expenseScore, "Expense-style wording detected.");

  let settlementToScore = 0;
  let settlementFromScore = 0;

  if (containsAnyKeyword(lower, TYPE_KEYWORDS.settlement)) {
    settlementToScore += 2;
    settlementFromScore += 2;
  }

  if (/\b(?:paid back|pay back|repaid|returned to|settled with|sent back)\b/i.test(lower)) {
    settlementToScore += 4;
  }
  if (/\b(?:received|got back|collected|friend paid me|paid me)\b/i.test(lower)) {
    settlementFromScore += 4;
  }
  if (/\bfrom\b/i.test(lower) && /\b(?:received|got|collected|settl)/i.test(lower)) {
    settlementFromScore += 3;
  }
  if (/\bto\b/i.test(lower) && /\b(?:repaid|returned|settl|paid back)/i.test(lower)) {
    settlementToScore += 3;
  }

  addCandidate(
    candidates,
    "settlement",
    "to_friend",
    settlementToScore,
    "Repayment to friend language detected."
  );
  addCandidate(
    candidates,
    "settlement",
    "from_friend",
    settlementFromScore,
    "Repayment from friend language detected."
  );

  if (candidates.size === 0) {
    if (fallbackType === "settlement") {
      addCandidate(candidates, "settlement", "from_friend", 1, "Fallback interpretation.");
      addCandidate(candidates, "settlement", "to_friend", 1, "Fallback interpretation.");
    } else {
      addCandidate(candidates, fallbackType || DEFAULT_FALLBACK, null, 1, "Fallback interpretation.");
    }
  }

  return [...candidates.values()].sort((left, right) => right.score - left.score);
}

function interpretationLabel(type, settlementDirection) {
  if (type === "expense") return "Expense (friend owes you)";
  if (type === "lend") return "Lend (loan to friend)";
  if (type === "debt") return "Debt (you owe friend)";
  if (type === "settlement" && settlementDirection === "from_friend") {
    return "Settlement received (friend paid you)";
  }
  if (type === "settlement" && settlementDirection === "to_friend") {
    return "Settlement paid (you paid friend)";
  }
  return type;
}

function resolveOptions(optionsOrFallback) {
  if (typeof optionsOrFallback === "string") {
    return {
      fallbackType: optionsOrFallback || DEFAULT_FALLBACK,
      friends: []
    };
  }

  return {
    fallbackType: optionsOrFallback?.fallbackType || DEFAULT_FALLBACK,
    friends: optionsOrFallback?.friends || []
  };
}

function parseQuickEntry(input, optionsOrFallback = DEFAULT_FALLBACK) {
  const { fallbackType, friends } = resolveOptions(optionsOrFallback);

  const description = normalizeText(input);
  if (!description) {
    return {
      type: fallbackType,
      settlement_direction: null,
      amount: null,
      friend_name_guess: "",
      friend_match: null,
      friend_candidates: [],
      description: "",
      confidence: "low",
      confidence_score: 0.2,
      needs_clarification: true,
      interpretations: [],
      entities: {
        raw_amount: ""
      },
      parser_version: "v2"
    };
  }

  const amountMeta = extractAmount(description);
  const friendMeta = resolveFriend(description, friends);
  const intentCandidates = detectIntentCandidates(description, fallbackType);

  const top = intentCandidates[0] || {
    type: fallbackType,
    settlement_direction: null,
    score: 1,
    reason: "Fallback interpretation."
  };
  const second = intentCandidates[1] || null;

  const closeScore =
    second && top
      ? second.score >= Math.max(2, top.score - 1) && second.type !== top.type
      : false;
  const settleDirectionConflict =
    top.type === "settlement" &&
    second &&
    second.type === "settlement" &&
    second.settlement_direction !== top.settlement_direction &&
    second.score >= Math.max(2, top.score - 1);

  const needsClarification = Boolean(closeScore || settleDirectionConflict || !amountMeta.amount);

  let confidenceScore = 0.34 + clamp(top.score / 14, 0.04, 0.35);
  if (amountMeta.amount) confidenceScore += 0.18;
  if (friendMeta.friend_match) confidenceScore += 0.2;
  else if (friendMeta.friend_name_guess) confidenceScore += 0.08;
  if (needsClarification) confidenceScore -= 0.16;
  confidenceScore = clamp(confidenceScore, 0.12, 0.98);

  const confidence =
    confidenceScore >= 0.78 ? "high" : confidenceScore >= 0.56 ? "medium" : "low";

  const interpretations = intentCandidates.slice(0, 4).map((candidate) => ({
    id: `${candidate.type}:${candidate.settlement_direction || "na"}`,
    type: candidate.type,
    settlement_direction: candidate.settlement_direction,
    label: interpretationLabel(candidate.type, candidate.settlement_direction),
    reason: candidate.reason,
    score: Number(clamp(candidate.score / 10, 0.05, 0.99).toFixed(2))
  }));

  return {
    type: top.type,
    settlement_direction: top.type === "settlement" ? top.settlement_direction : null,
    amount: amountMeta.amount,
    friend_name_guess: friendMeta.friend_name_guess,
    friend_match: friendMeta.friend_match,
    friend_candidates: friendMeta.friend_candidates,
    description,
    confidence,
    confidence_score: Number(confidenceScore.toFixed(2)),
    needs_clarification: Boolean(needsClarification),
    interpretations,
    entities: {
      raw_amount: amountMeta.raw_amount
    },
    parser_version: "v2"
  };
}

module.exports = {
  parseQuickEntry
};
