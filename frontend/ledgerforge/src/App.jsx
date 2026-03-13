import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import SplitwiseTab from "./components/SplitwiseTab";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const DEFAULT_USER_ID =
  import.meta.env.VITE_DEFAULT_USER_ID ||
  "1f866940-cc5b-4c6f-a949-5776ded9d1c6";
const RECON_SAMPLE = "date,amount,description\n2026-03-01,450,Paid Rahul dinner split";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

const typeLabel = {
  expense: "Expense",
  lend: "Lend",
  debt: "Debt",
  settlement: "Settlement"
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSearch = (value) =>
  String(value || "")
    .toLowerCase()
    .trim();

const isSubsequence = (needle, haystack) => {
  if (!needle) return true;
  let pointer = 0;
  for (let index = 0; index < haystack.length; index += 1) {
    if (haystack[index] === needle[pointer]) pointer += 1;
    if (pointer === needle.length) return true;
  }
  return false;
};

const scoreFriendName = (name, query) => {
  const normalizedName = normalizeSearch(name);
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return 10;

  const tokens = normalizedName.split(/\s+/).filter(Boolean);
  let score = 0;

  if (normalizedName === normalizedQuery) score += 140;
  if (normalizedName.startsWith(normalizedQuery)) score += 95;
  if (normalizedName.includes(normalizedQuery)) score += 65;
  if (tokens.some((token) => token.startsWith(normalizedQuery))) score += 48;
  if (isSubsequence(normalizedQuery, normalizedName)) score += 22;

  score -= Math.max(0, normalizedName.length - normalizedQuery.length) * 0.12;
  return score > 0 ? score : 0;
};

const sortFriendsSmart = (rows, query, extractor) =>
  rows
    .map((row) => ({
      row,
      score: scoreFriendName(extractor(row), query)
    }))
    .filter((item) => item.score > 0 || !normalizeSearch(query))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return extractor(left.row).localeCompare(extractor(right.row));
    })
    .map((item) => item.row);

const tone = (value) => (value > 0 ? "positive" : value < 0 ? "negative" : "neutral");

const formatDateTime = (value) => {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const transactionImpact = (type, amount, settlementDirection) => {
  const numeric = toNumber(amount);
  if (type === "debt") return -numeric;
  if (type === "settlement") {
    return settlementDirection === "to_friend" ? numeric : -numeric;
  }
  return numeric;
};

const recommendationLabel = (value) => {
  if (value === "match_existing") return "Matched";
  if (value === "likely_duplicate") return "Likely duplicate";
  if (value === "create_new") return "Create new";
  if (value === "invalid_row") return "Invalid";
  return value || "Unknown";
};

function App() {
  const [activeView, setActiveView] = useState("ledger");
  const [ledgerPane, setLedgerPane] = useState("workspace");
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [userInput, setUserInput] = useState(DEFAULT_USER_ID);

  const [friends, setFriends] = useState([]);
  const [balances, setBalances] = useState([]);
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [rules, setRules] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [debtReminders, setDebtReminders] = useState([]);
  const [debtReminderSummary, setDebtReminderSummary] = useState(null);

  const [ledgerReplay, setLedgerReplay] = useState(null);
  const [ledgerEvents, setLedgerEvents] = useState([]);
  const [sloStatus, setSloStatus] = useState(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState(null);
  const [imports, setImports] = useState([]);

  const [friendName, setFriendName] = useState("");
  const [friendPane, setFriendPane] = useState("directory");
  const [friendSearch, setFriendSearch] = useState("");
  const [composerFriendSearch, setComposerFriendSearch] = useState("");
  const [deleteFriendSearch, setDeleteFriendSearch] = useState("");
  const [deleteFriendId, setDeleteFriendId] = useState("");
  const [quickInput, setQuickInput] = useState("");
  const [quickPreview, setQuickPreview] = useState(null);
  const [quickChoice, setQuickChoice] = useState({
    interpretationId: "",
    friendId: ""
  });
  const [reconInput, setReconInput] = useState(RECON_SAMPLE);
  const [reconRows, setReconRows] = useState([]);
  const [reconSummary, setReconSummary] = useState(null);

  const [txForm, setTxForm] = useState({
    friend_id: "",
    type: "expense",
    settlement_direction: "from_friend",
    amount: "",
    description: ""
  });
  const [ruleForm, setRuleForm] = useState({
    friend_id: "",
    type: "expense",
    amount: "",
    frequency: "monthly",
    next_due_date: new Date().toISOString().slice(0, 10),
    description: ""
  });

  const [busy, setBusy] = useState({
    friend: false,
    deleteFriendId: "",
    tx: false,
    parse: false,
    smartSave: false,
    quickFriend: false,
    deleteTxId: "",
    rule: false,
    runRules: false,
    reconPreview: false,
    reconCommit: false,
    backfill: false
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const apiFetch = useCallback(async (path, options = {}) => {
    const requestOptions = { ...options };
    const headers = { ...(options.headers || {}) };
    if (requestOptions.body && typeof requestOptions.body === "object") {
      headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(requestOptions.body);
    }
    requestOptions.headers = headers;

    const response = await fetch(`${API_BASE_URL}${path}`, requestOptions);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Request failed");
    return payload;
  }, []);

  const setNotice = useCallback((type, message) => {
    if (type === "error") {
      setError(message);
      setSuccess("");
      return;
    }
    setSuccess(message);
    setError("");
  }, []);

  const reloadCore = useCallback(async () => {
    const [friendsPayload, balancesPayload, summaryPayload, statsPayload, rulesPayload, remindersPayload] =
      await Promise.all([
        apiFetch(`/friends/${userId}`),
        apiFetch(`/balances/${userId}`),
        apiFetch(`/balances/summary/${userId}`),
        apiFetch(`/transactions/stats/${userId}`),
        apiFetch(`/recurring/${userId}`),
        apiFetch(`/balances/reminders/${userId}?limit=8&direction=all&min_amount=1`)
      ]);
    setFriends(friendsPayload);
    setBalances(balancesPayload);
    setSummary(summaryPayload);
    setStats(statsPayload);
    setRules(rulesPayload);
    setDebtReminders(remindersPayload.reminders || []);
    setDebtReminderSummary(remindersPayload.summary || null);
  }, [apiFetch, userId]);

  const reloadTransactions = useCallback(async () => {
    const payload = await apiFetch(`/transactions/user/${userId}?page=1&limit=30`);
    setTransactions(payload.data || []);
  }, [apiFetch, userId]);

  const reloadOps = useCallback(async () => {
    const [replayPayload, eventsPayload, sloPayload, metricsPayload, importsPayload] =
      await Promise.all([
        apiFetch(`/ledger/replay/${userId}`),
        apiFetch(`/ledger/events/${userId}?limit=12&page=1`),
        apiFetch("/observability/slo"),
        apiFetch("/observability/metrics"),
        apiFetch(`/reconciliation/imports/${userId}`)
      ]);
    setLedgerReplay(replayPayload);
    setLedgerEvents(eventsPayload.data || []);
    setSloStatus(sloPayload);
    setRuntimeMetrics(metricsPayload);
    setImports(importsPayload || []);
  }, [apiFetch, userId]);

  const reloadAll = useCallback(async () => {
    try {
      await Promise.all([reloadCore(), reloadTransactions(), reloadOps()]);
    } catch (loadError) {
      setNotice("error", loadError.message || "Could not load data");
    }
  }, [reloadCore, reloadTransactions, reloadOps, setNotice]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    if (!friends.length) return;
    setTxForm((prev) => ({
      ...prev,
      friend_id: friends.some((friend) => friend.id === prev.friend_id)
        ? prev.friend_id
        : friends[0].id
    }));
    setComposerFriendSearch((prev) => {
      if (prev.trim()) return prev;
      return friends[0].name;
    });
    setRuleForm((prev) => ({
      ...prev,
      friend_id: friends.some((friend) => friend.id === prev.friend_id)
        ? prev.friend_id
        : friends[0].id
    }));
  }, [friends]);

  useEffect(() => {
    if (!deleteFriendId) return;
    if (!friends.some((friend) => friend.id === deleteFriendId)) {
      setDeleteFriendId("");
      setDeleteFriendSearch("");
    }
  }, [friends, deleteFriendId]);

  const balanceRows = useMemo(() => {
    const map = balances.reduce((acc, row) => {
      acc[row.friend_id] = toNumber(row.balance);
      return acc;
    }, {});
    return friends.map((friend) => ({
      id: friend.id,
      name: friend.name,
      balance: map[friend.id] || 0
    }));
  }, [friends, balances]);

  const filteredFriendRows = useMemo(
    () => sortFriendsSmart(balanceRows, friendSearch, (row) => row.name),
    [balanceRows, friendSearch]
  );

  const composerFriendOptions = useMemo(
    () => sortFriendsSmart(friends, composerFriendSearch, (row) => row.name).slice(0, 8),
    [friends, composerFriendSearch]
  );

  const deleteFriendOptions = useMemo(
    () => sortFriendsSmart(friends, deleteFriendSearch, (row) => row.name).slice(0, 8),
    [friends, deleteFriendSearch]
  );

  const selectedComposerFriend = useMemo(
    () => friends.find((friend) => friend.id === txForm.friend_id) || null,
    [friends, txForm.friend_id]
  );

  const selectedDeleteFriend = useMemo(
    () => friends.find((friend) => friend.id === deleteFriendId) || null,
    [friends, deleteFriendId]
  );

  const selectedDeleteFriendBalance = useMemo(() => {
    const row = balanceRows.find((item) => item.id === deleteFriendId);
    return row ? row.balance : 0;
  }, [balanceRows, deleteFriendId]);

  const quickInterpretations = useMemo(() => quickPreview?.interpretations || [], [quickPreview]);

  const quickSelectedInterpretation = useMemo(
    () =>
      quickInterpretations.find((item) => item.id === quickChoice.interpretationId) ||
      quickInterpretations[0] ||
      null,
    [quickInterpretations, quickChoice.interpretationId]
  );

  const quickSelectedFriend = useMemo(() => {
    if (!quickChoice.friendId) return null;
    return friends.find((friend) => friend.id === quickChoice.friendId) || null;
  }, [friends, quickChoice.friendId]);

  const smartDraft = useMemo(() => {
    if (!quickPreview) return null;

    const interpretation = quickSelectedInterpretation;
    const type = interpretation?.type || quickPreview.type || "expense";
    const settlementDirection =
      interpretation?.settlement_direction ||
      quickPreview.settlement_direction ||
      "from_friend";

    const fallbackFriend = quickPreview.friend_match?.id || quickPreview.friend_candidates?.[0]?.id;
    const friendId = quickChoice.friendId || fallbackFriend || "";
    const amount = toNumber(quickPreview.amount);

    return {
      type,
      settlement_direction: settlementDirection,
      friend_id: friendId,
      amount,
      description: quickPreview.description || quickInput.trim()
    };
  }, [quickPreview, quickSelectedInterpretation, quickChoice.friendId, quickInput]);

  const canSmartSave = useMemo(() => {
    if (!quickPreview || !smartDraft) return false;
    if (smartDraft.amount <= 0 || !smartDraft.friend_id) return false;
    if (quickPreview.needs_clarification && !quickSelectedInterpretation) return false;
    return true;
  }, [quickPreview, smartDraft, quickSelectedInterpretation]);

  const switchUser = (event) => {
    event.preventDefault();
    const next = userInput.trim();
    if (!next) return;
    setUserId(next);
    setLedgerPane("workspace");
    setComposerFriendSearch("");
    setFriendSearch("");
    setDeleteFriendSearch("");
    setDeleteFriendId("");
    setFriendPane("directory");
    setQuickPreview(null);
    setQuickChoice({
      interpretationId: "",
      friendId: ""
    });
    setNotice("success", "Switched user workspace.");
  };

  const addFriend = async (event) => {
    event.preventDefault();
    if (!friendName.trim()) return;
    setBusy((prev) => ({ ...prev, friend: true }));
    try {
      await apiFetch("/friends", {
        method: "POST",
        body: { user_id: userId, name: friendName.trim() }
      });
      setFriendName("");
      setNotice("success", "Friend added.");
      await reloadAll();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, friend: false }));
    }
  };

  const deleteFriend = async (friend) => {
    if (!window.confirm(`Delete ${friend.name}?`)) return;
    setBusy((prev) => ({ ...prev, deleteFriendId: friend.id }));
    try {
      await apiFetch(`/friends/${friend.id}?user_id=${userId}`, { method: "DELETE" });
      setDeleteFriendId("");
      setDeleteFriendSearch("");
      setNotice("success", "Friend deleted.");
      await reloadAll();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, deleteFriendId: "" }));
    }
  };

  const selectComposerFriend = (friend) => {
    setTxForm((prev) => ({ ...prev, friend_id: friend.id }));
    setRuleForm((prev) => ({ ...prev, friend_id: friend.id }));
    setComposerFriendSearch(friend.name);
  };

  const selectDeleteFriend = (friend) => {
    setDeleteFriendId(friend.id);
    setDeleteFriendSearch(friend.name);
  };

  const chooseQuickInterpretation = (item) => {
    setQuickChoice((prev) => ({
      ...prev,
      interpretationId: item.id
    }));
    setTxForm((prev) => ({
      ...prev,
      type: item.type || prev.type,
      settlement_direction: item.settlement_direction || prev.settlement_direction
    }));
  };

  const chooseQuickFriend = (friend) => {
    setQuickChoice((prev) => ({
      ...prev,
      friendId: friend.id
    }));
    setTxForm((prev) => ({
      ...prev,
      friend_id: friend.id
    }));
    setComposerFriendSearch(friend.name);
  };

  const createQuickFriend = async () => {
    const guessed = quickPreview?.friend_name_guess?.trim();
    if (!guessed) return;

    setBusy((prev) => ({ ...prev, quickFriend: true }));
    try {
      const created = await apiFetch("/friends", {
        method: "POST",
        body: { user_id: userId, name: guessed }
      });
      setQuickChoice((prev) => ({
        ...prev,
        friendId: created.id
      }));
      setTxForm((prev) => ({
        ...prev,
        friend_id: created.id
      }));
      setComposerFriendSearch(created.name);
      setNotice("success", `Friend ${created.name} created.`);
      await reloadCore();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, quickFriend: false }));
    }
  };

  const saveSmartEntry = async () => {
    if (!smartDraft || !canSmartSave) return;

    setBusy((prev) => ({ ...prev, smartSave: true }));
    try {
      await apiFetch("/transactions", {
        method: "POST",
        body: {
          user_id: userId,
          friend_id: smartDraft.friend_id,
          type: smartDraft.type,
          settlement_direction:
            smartDraft.type === "settlement" ? smartDraft.settlement_direction : undefined,
          amount: smartDraft.amount,
          description: smartDraft.description,
          source: "smart_command_bar"
        }
      });

      setTxForm((prev) => ({
        ...prev,
        friend_id: smartDraft.friend_id,
        type: smartDraft.type,
        settlement_direction: smartDraft.settlement_direction,
        amount: "",
        description: ""
      }));
      setQuickInput("");
      setQuickPreview(null);
      setQuickChoice({
        interpretationId: "",
        friendId: ""
      });
      setNotice("success", "Smart entry saved.");
      await reloadAll();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, smartSave: false }));
    }
  };

  const copyReminder = async (message) => {
    try {
      await navigator.clipboard.writeText(message);
      setNotice("success", "Reminder message copied.");
    } catch {
      setNotice("error", "Could not copy reminder message.");
    }
  };

  const saveTransaction = async (event) => {
    event.preventDefault();
    if (!txForm.friend_id || toNumber(txForm.amount) <= 0) return;
    setBusy((prev) => ({ ...prev, tx: true }));
    try {
      await apiFetch("/transactions", {
        method: "POST",
        body: {
          user_id: userId,
          friend_id: txForm.friend_id,
          type: txForm.type,
          settlement_direction:
            txForm.type === "settlement" ? txForm.settlement_direction : undefined,
          amount: toNumber(txForm.amount),
          description: txForm.description,
          source: "dashboard_ui"
        }
      });
      setTxForm((prev) => ({ ...prev, amount: "", description: "" }));
      setQuickInput("");
      setQuickPreview(null);
      setNotice("success", "Transaction saved.");
      await reloadAll();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, tx: false }));
    }
  };

  const parseQuick = async (event) => {
    event.preventDefault();
    if (!quickInput.trim()) return;
    setBusy((prev) => ({ ...prev, parse: true }));
    try {
      const payload = await apiFetch("/transactions/parse", {
        method: "POST",
        body: { input: quickInput, fallback_type: txForm.type, user_id: userId }
      });
      setQuickPreview(payload);
      setQuickChoice({
        interpretationId: payload.interpretations?.[0]?.id || "",
        friendId:
          payload.friend_match?.id || payload.friend_candidates?.[0]?.id || ""
      });
      setTxForm((prev) => ({
        ...prev,
        type: payload.type || prev.type,
        settlement_direction: payload.settlement_direction || prev.settlement_direction,
        amount: payload.amount ? String(payload.amount) : prev.amount,
        description: payload.description || prev.description
      }));
      setNotice("success", "Smart parse applied.");
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, parse: false }));
    }
  };

  const deleteTransaction = async (transactionId) => {
    if (!window.confirm("Delete this transaction?")) return;
    setBusy((prev) => ({ ...prev, deleteTxId: transactionId }));
    try {
      await apiFetch(`/transactions/${transactionId}?user_id=${userId}`, { method: "DELETE" });
      setNotice("success", "Transaction deleted.");
      await reloadAll();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, deleteTxId: "" }));
    }
  };

  const previewReconciliation = async (event) => {
    event.preventDefault();
    if (!reconInput.trim()) return;
    setBusy((prev) => ({ ...prev, reconPreview: true }));
    try {
      const payload = await apiFetch("/reconciliation/preview", {
        method: "POST",
        body: { user_id: userId, csv_text: reconInput }
      });
      const fallbackFriend = friends[0]?.id || "";
      const rows = (payload.suggestions || []).map((row) => ({
        ...row,
        action:
          row.recommendation === "invalid_row"
            ? "ignore"
            : row.recommendation === "create_new"
              ? "create_new"
              : "match_existing",
        friend_id: row.friend_guess?.id || fallbackFriend,
        type: row.parsed_type || "expense",
        transaction_id: row.top_candidates?.[0]?.transaction_id || ""
      }));
      setReconRows(rows);
      setReconSummary(payload.summary || null);
      setNotice("success", "Reconciliation preview ready.");
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, reconPreview: false }));
    }
  };

  const commitReconciliation = async () => {
    if (!reconRows.length) return;
    setBusy((prev) => ({ ...prev, reconCommit: true }));
    try {
      await apiFetch("/reconciliation/commit", {
        method: "POST",
        body: {
          user_id: userId,
          source_name: "dashboard-reconciliation",
          entries: reconRows.map((row) => ({
            row_number: row.row_number,
            date: row.date,
            amount: row.amount,
            description: row.description,
            confidence: row.confidence
          })),
          actions: reconRows.map((row) => ({
            row_number: row.row_number,
            action: row.action,
            friend_id: row.action === "create_new" ? row.friend_id : undefined,
            type: row.action === "create_new" ? row.type : undefined,
            description: row.action === "create_new" ? row.description : undefined,
            transaction_id: row.action === "match_existing" ? row.transaction_id : undefined
          }))
        }
      });
      setReconRows([]);
      setReconSummary(null);
      setNotice("success", "Reconciliation committed.");
      await reloadAll();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, reconCommit: false }));
    }
  };

  const updateReconRow = (rowNumber, patch) => {
    setReconRows((prev) =>
      prev.map((item) =>
        item.row_number === rowNumber
          ? {
              ...item,
              ...patch
            }
          : item
      )
    );
  };

  const saveRule = async (event) => {
    event.preventDefault();
    if (!ruleForm.friend_id || toNumber(ruleForm.amount) <= 0) return;
    setBusy((prev) => ({ ...prev, rule: true }));
    try {
      await apiFetch("/recurring", { method: "POST", body: { user_id: userId, ...ruleForm } });
      setRuleForm((prev) => ({ ...prev, amount: "", description: "" }));
      setNotice("success", "Rule created.");
      await reloadAll();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, rule: false }));
    }
  };

  const runRules = async () => {
    setBusy((prev) => ({ ...prev, runRules: true }));
    try {
      const payload = await apiFetch(`/recurring/run/${userId}`, { method: "POST" });
      setNotice("success", `Generated ${payload.generated_transactions || 0} recurring rows.`);
      await reloadAll();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, runRules: false }));
    }
  };

  const toggleRule = async (rule) => {
    try {
      await apiFetch(`/recurring/${rule.id}`, {
        method: "PATCH",
        body: { active: !rule.active }
      });
      await reloadAll();
    } catch (requestError) {
      setNotice("error", requestError.message);
    }
  };

  const backfillEvents = async () => {
    setBusy((prev) => ({ ...prev, backfill: true }));
    try {
      const payload = await apiFetch(`/ledger/backfill/${userId}`, { method: "POST" });
      setNotice("success", `Backfilled ${payload.inserted_events || 0} events.`);
      await reloadOps();
    } catch (requestError) {
      setNotice("error", requestError.message);
    } finally {
      setBusy((prev) => ({ ...prev, backfill: false }));
    }
  };

  return (
    <main className="forge-shell">
      <div className="atmosphere one" />
      <div className="atmosphere two" />
      <header className="hero">
        <div>
          <p className="eyebrow">LedgerForge // Smart Money OS</p>
          <h1>Personal + Group Money Tracking That Feels Premium</h1>
          <p className="hero-copy">
            Fast natural-language entry, debt clarity, and clean collaboration flows with friends.
          </p>
        </div>
        <form className="user-switch" onSubmit={switchUser}>
          <label>User ID</label>
          <input value={userInput} onChange={(event) => setUserInput(event.target.value)} />
          <button type="submit" className="ghost-btn">Load</button>
        </form>
      </header>

      {(error || success) && (
        <section className="notice-strip">
          {error && <p className="notice error">{error}</p>}
          {success && <p className="notice success">{success}</p>}
        </section>
      )}

      <section className="quick-bar">
        <div className="quick-head">
          <h2>Smart Command Bar</h2>
          <p>Type naturally: <span className="muted">gave vijay 2k for food</span> or <span className="muted">took 3k from sujith</span></p>
        </div>
        <form className="quick-form" onSubmit={parseQuick}>
          <input
            value={quickInput}
            onChange={(event) => setQuickInput(event.target.value)}
            placeholder="Enter any sentence about money..."
          />
          <button type="submit" className="solid-btn" disabled={busy.parse}>
            {busy.parse ? "Understanding..." : "Interpret"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={saveSmartEntry}
            disabled={!canSmartSave || busy.smartSave}
          >
            {busy.smartSave ? "Saving..." : "Save Smart Entry"}
          </button>
        </form>

        {quickPreview && (
          <div className="quick-result">
            <div className="quick-summary">
              <p className="stream-main">
                {quickSelectedInterpretation?.label || typeLabel[quickPreview.type] || quickPreview.type}
                {quickPreview.needs_clarification && <span className="pill debt">Needs review</span>}
              </p>
              <p className="stream-meta">
                Amount: {quickPreview.amount ? INR.format(toNumber(quickPreview.amount)) : "--"} ·
                Friend: {quickSelectedFriend?.name || quickPreview.friend_name_guess || "--"} ·
                Confidence: {(quickPreview.confidence || "low").toUpperCase()}
              </p>
            </div>

            {quickInterpretations.length > 1 && (
              <div>
                <p className="mini-label">Choose Interpretation</p>
                <div className="friend-suggest">
                  {quickInterpretations.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`suggest-btn ${quickChoice.interpretationId === item.id ? "active" : ""}`}
                      onClick={() => chooseQuickInterpretation(item)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(quickPreview.friend_candidates?.length > 0 || quickPreview.friend_name_guess) && (
              <div>
                <p className="mini-label">Confirm Friend</p>
                <div className="friend-suggest">
                  {quickPreview.friend_candidates?.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`suggest-btn ${quickChoice.friendId === item.id ? "active" : ""}`}
                      onClick={() => chooseQuickFriend(item)}
                    >
                      {item.name}
                    </button>
                  ))}
                  {!quickPreview.friend_match && quickPreview.friend_name_guess && (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={createQuickFriend}
                      disabled={busy.quickFriend}
                    >
                      {busy.quickFriend ? "Creating..." : `Create ${quickPreview.friend_name_guess}`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="view-toggle-wrap">
        <button
          type="button"
          className={`view-toggle-btn ${activeView === "ledger" ? "active" : ""}`}
          onClick={() => setActiveView("ledger")}
        >
          Ledger Ops
        </button>
        <button
          type="button"
          className={`view-toggle-btn ${activeView === "splitwise" ? "active" : ""}`}
          onClick={() => setActiveView("splitwise")}
        >
          Group Splits
        </button>
      </section>

      {activeView === "ledger" && (
        <section className="view-toggle-wrap subtle">
          <button
            type="button"
            className={`view-toggle-btn ${ledgerPane === "workspace" ? "active" : ""}`}
            onClick={() => setLedgerPane("workspace")}
          >
            Workspace
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${ledgerPane === "lab" ? "active" : ""}`}
            onClick={() => setLedgerPane("lab")}
          >
            Advanced Lab
          </button>
        </section>
      )}

      {activeView === "ledger" ? (
        <>
          <section className="stats-grid">
            <article className="metric"><p>Receivable</p><h3 className="positive">{INR.format(toNumber(summary?.receivable_total))}</h3></article>
            <article className="metric"><p>Payable</p><h3 className="negative">{INR.format(toNumber(summary?.payable_total))}</h3></article>
            <article className="metric"><p>Net</p><h3 className={tone(toNumber(summary?.net_position))}>{INR.format(toNumber(summary?.net_position))}</h3></article>
            <article className="metric"><p>Total Tx</p><h3>{Math.trunc(toNumber(stats?.total_transactions))}</h3></article>
            {ledgerPane === "workspace" ? (
              <>
                <article className="metric"><p>Friends</p><h3>{friends.length}</h3></article>
                <article className="metric"><p>Reminders</p><h3>{debtReminders.length}</h3></article>
              </>
            ) : (
              <>
                <article className="metric"><p>SLO</p><h3>{sloStatus?.status || "--"}</h3></article>
                <article className="metric"><p>P95 (5m)</p><h3>{toNumber(sloStatus?.current?.window_5m?.p95_latency_ms).toFixed(1)}ms</h3></article>
              </>
            )}
          </section>

          {ledgerPane === "workspace" ? (
            <>
              <section className="panel deck-grid">
                <article className="deck-card">
              <div className="deck-head">
                <h2>Friend Workspace</h2>
                <div className="subtabs">
                  <button
                    type="button"
                    className={`subtab-btn ${friendPane === "directory" ? "active" : ""}`}
                    onClick={() => setFriendPane("directory")}
                  >
                    Directory
                  </button>
                  <button
                    type="button"
                    className={`subtab-btn ${friendPane === "delete" ? "active" : ""}`}
                    onClick={() => setFriendPane("delete")}
                  >
                    Delete Friend
                  </button>
                </div>
              </div>

              {friendPane === "directory" ? (
                <>
                  <label className="mini-label">
                    Smart Search
                    <input
                      value={friendSearch}
                      onChange={(event) => setFriendSearch(event.target.value)}
                      placeholder="Type full name, initials, or partial..."
                    />
                  </label>
                  <ul className="friend-list">
                    {filteredFriendRows.slice(0, 12).map((row) => (
                      <li key={row.id} className="friend-row">
                        <div>
                          <span>{row.name}</span>
                          <p className="muted">Net balance: {INR.format(row.balance)}</p>
                        </div>
                        <div className="friend-actions">
                          <strong className={tone(row.balance)}>{INR.format(row.balance)}</strong>
                        </div>
                      </li>
                    ))}
                    {filteredFriendRows.length === 0 && (
                      <li className="muted center">No friends match this search.</li>
                    )}
                  </ul>
                  <form className="stack-form compact" onSubmit={addFriend}>
                    <input
                      value={friendName}
                      onChange={(event) => setFriendName(event.target.value)}
                      placeholder="Add friend"
                    />
                    <button type="submit" className="solid-btn" disabled={busy.friend}>
                      {busy.friend ? "Adding..." : "Add"}
                    </button>
                  </form>
                </>
              ) : (
                <div className="danger-zone">
                  <label className="mini-label">
                    Select Friend To Delete
                    <input
                      value={deleteFriendSearch}
                      onChange={(event) => setDeleteFriendSearch(event.target.value)}
                      placeholder="Smart search friend..."
                    />
                  </label>
                  <div className="friend-suggest">
                    {deleteFriendOptions.map((friend) => (
                      <button
                        key={friend.id}
                        type="button"
                        className={`suggest-btn ${deleteFriendId === friend.id ? "active" : ""}`}
                        onClick={() => selectDeleteFriend(friend)}
                      >
                        {friend.name}
                      </button>
                    ))}
                  </div>
                  {selectedDeleteFriend ? (
                    <div className="danger-card">
                      <p className="stream-main">{selectedDeleteFriend.name}</p>
                      <p className="stream-meta">
                        Current balance: {INR.format(selectedDeleteFriendBalance)}
                      </p>
                      <p className="muted">
                        Deletion is blocked if any transaction history exists for this friend.
                      </p>
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() => deleteFriend(selectedDeleteFriend)}
                        disabled={busy.deleteFriendId === selectedDeleteFriend.id}
                      >
                        {busy.deleteFriendId === selectedDeleteFriend.id
                          ? "Deleting..."
                          : "Delete Friend"}
                      </button>
                    </div>
                  ) : (
                    <p className="muted center">Pick a friend from suggestions to continue.</p>
                  )}
                </div>
              )}
                </article>

                <article className="deck-card">
              <h2>Transaction Composer</h2>
              <label className="mini-label">
                Smart Friend Search
                <input
                  value={composerFriendSearch}
                  onChange={(event) => setComposerFriendSearch(event.target.value)}
                  placeholder="Type friend name..."
                />
              </label>
              <div className="friend-suggest">
                {composerFriendOptions.map((friend) => (
                  <button
                    key={friend.id}
                    type="button"
                    className={`suggest-btn ${txForm.friend_id === friend.id ? "active" : ""}`}
                    onClick={() => selectComposerFriend(friend)}
                  >
                    {friend.name}
                  </button>
                ))}
              </div>
              {selectedComposerFriend && (
                <p className="muted">Selected friend: {selectedComposerFriend.name}</p>
              )}
              <form className="stack-form" onSubmit={saveTransaction}>
                <label>
                  Type
                  <select
                    value={txForm.type}
                    onChange={(event) =>
                      setTxForm((prev) => ({ ...prev, type: event.target.value }))
                    }
                  >
                    <option value="expense">Expense</option>
                    <option value="lend">Lend</option>
                    <option value="debt">Debt</option>
                    <option value="settlement">Settlement</option>
                  </select>
                </label>
                {txForm.type === "settlement" && (
                  <label>
                    Settlement Direction
                    <select
                      value={txForm.settlement_direction}
                      onChange={(event) =>
                        setTxForm((prev) => ({
                          ...prev,
                          settlement_direction: event.target.value
                        }))
                      }
                    >
                      <option value="from_friend">From friend (received)</option>
                      <option value="to_friend">To friend (paid)</option>
                    </select>
                  </label>
                )}
                <label>Friend<select value={txForm.friend_id} onChange={(event) => {
                  const friend = friends.find((item) => item.id === event.target.value);
                  setTxForm((prev) => ({ ...prev, friend_id: event.target.value }));
                  if (friend) setComposerFriendSearch(friend.name);
                }}>{friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select></label>
                <label>Amount<input type="number" min="1" step="0.01" value={txForm.amount} onChange={(event) => setTxForm((prev) => ({ ...prev, amount: event.target.value }))} /></label>
                <label>Description<textarea rows="2" value={txForm.description} onChange={(event) => setTxForm((prev) => ({ ...prev, description: event.target.value }))} /></label>
                <button type="submit" className="solid-btn" disabled={busy.tx}>{busy.tx ? "Saving..." : "Save"}</button>
              </form>
                </article>

                <article className="deck-card">
              <h2>Debt Reminder Center</h2>
              <div className="mini-kpis">
                <div>
                  <p className="muted">Collect</p>
                  <strong>{Math.trunc(toNumber(debtReminderSummary?.collect_count))}</strong>
                </div>
                <div>
                  <p className="muted">Pay</p>
                  <strong>{Math.trunc(toNumber(debtReminderSummary?.pay_count))}</strong>
                </div>
                <div>
                  <p className="muted">Collect Total</p>
                  <strong>{INR.format(toNumber(debtReminderSummary?.collect_total))}</strong>
                </div>
                <div>
                  <p className="muted">Pay Total</p>
                  <strong>{INR.format(toNumber(debtReminderSummary?.pay_total))}</strong>
                </div>
              </div>
              <ul className="stream-list compact">
                {debtReminders.map((item) => (
                  <li key={item.friend_id}>
                    <div>
                      <p className="stream-main">
                        {item.friend_name} <span className={`pill ${item.reminder_action}`}>{item.reminder_action}</span>
                      </p>
                      <p className="stream-meta">
                        {item.reminder_message} · {item.days_pending} days pending · {item.urgency}
                      </p>
                    </div>
                    <div className="stream-side">
                      <strong className={tone(toNumber(item.balance))}>{INR.format(toNumber(item.balance))}</strong>
                      <button type="button" className="ghost-btn" onClick={() => copyReminder(item.reminder_message)}>
                        Copy
                      </button>
                    </div>
                  </li>
                ))}
                {debtReminders.length === 0 && (
                  <li className="muted center">No pending debt reminders right now.</li>
                )}
              </ul>
                </article>
              </section>

              <section className="panel">
                <h2>Transactions (Delete-enabled)</h2>
                <ul className="stream-list">
                  {transactions.map((tx) => {
                    const impact = transactionImpact(tx.type, tx.amount, tx.settlement_direction);
                    return <li key={tx.id}><div><p className="stream-main">{tx.friend_name} <span className={`pill ${tx.type}`}>{typeLabel[tx.type]}</span></p><p className="stream-meta">{tx.description || "No description"} · {formatDateTime(tx.created_at)}</p></div><div className="stream-side"><strong className={tone(impact)}>{INR.format(impact)}</strong><button type="button" className="danger-btn" onClick={() => deleteTransaction(tx.id)} disabled={busy.deleteTxId === tx.id}>{busy.deleteTxId === tx.id ? "Deleting..." : "Delete"}</button></div></li>;
                  })}
                </ul>
              </section>
            </>
          ) : (
            <section className="panel">
              <h2>Platform Telemetry</h2>
              <div className="radar-grid">
                <div><p className="muted">Availability</p><h3>{toNumber(sloStatus?.current?.window_5m?.availability).toFixed(2)}%</h3></div>
                <div><p className="muted">Error rate</p><h3>{toNumber(sloStatus?.current?.window_5m?.error_rate).toFixed(2)}%</h3></div>
                <div><p className="muted">Requests</p><h3>{runtimeMetrics?.total_requests ?? "--"}</h3></div>
                <div><p className="muted">DB ping</p><h3>{toNumber(sloStatus?.current?.db_ping_ms).toFixed(2)}ms</h3></div>
              </div>
              <button type="button" className="ghost-btn" onClick={backfillEvents} disabled={busy.backfill}>{busy.backfill ? "Backfilling..." : "Backfill Events"}</button>
            </section>
          )}

          {ledgerPane === "lab" && (
            <section className="panel two-up">
            <article>
              <h2>Reconciliation Lab</h2>
              <form className="stack-form" onSubmit={previewReconciliation}>
                <label>CSV<textarea rows="6" value={reconInput} onChange={(event) => setReconInput(event.target.value)} /></label>
                <button type="submit" className="ghost-btn" disabled={busy.reconPreview}>{busy.reconPreview ? "Analyzing..." : "Preview"}</button>
              </form>
              {reconSummary && <p className="muted">Rows {reconSummary.total_rows} · matched {reconSummary.matched_rows} · new {reconSummary.new_rows}</p>}
              <div className="recon-table-wrap">
                <table className="recon-table">
                  <thead><tr><th>Row</th><th>Description</th><th>Reco</th><th>Action</th><th>Target</th></tr></thead>
                  <tbody>
                    {reconRows.map((row) => (
                      <tr key={row.row_number}>
                        <td>{row.row_number}</td>
                        <td>{row.description}<br /><span className="muted">{INR.format(toNumber(row.amount))}</span></td>
                        <td>{recommendationLabel(row.recommendation)}</td>
                        <td><select value={row.action} onChange={(event) => setReconRows((prev) => prev.map((item) => item.row_number === row.row_number ? { ...item, action: event.target.value } : item))}><option value="create_new">Create</option><option value="match_existing">Match</option><option value="ignore">Ignore</option></select></td>
                        <td>
                          {row.action === "create_new" && <select value={row.friend_id || ""} onChange={(event) => updateReconRow(row.row_number, { friend_id: event.target.value })}><option value="">Friend</option>{friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select>}
                          {row.action === "match_existing" && <select value={row.transaction_id || ""} onChange={(event) => updateReconRow(row.row_number, { transaction_id: event.target.value })}><option value="">Candidate</option>{(row.top_candidates || []).map((candidate) => <option key={candidate.transaction_id} value={candidate.transaction_id}>{candidate.friend_name} · {INR.format(toNumber(candidate.amount))}</option>)}</select>}
                        </td>
                      </tr>
                    ))}
                    {reconRows.length === 0 && <tr><td colSpan="5" className="muted center">No preview yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <button type="button" className="solid-btn" onClick={commitReconciliation} disabled={busy.reconCommit || reconRows.length === 0}>{busy.reconCommit ? "Committing..." : "Commit Reconciliation"}</button>
            </article>

            <article>
              <h2>Replay + Recurring</h2>
              <div className="truth-cards"><div><p className="muted">Events</p><h3>{ledgerReplay?.replay_meta?.processed_events ?? "--"}</h3></div><div><p className="muted">Active Tx</p><h3>{ledgerReplay?.replay_meta?.active_transactions ?? "--"}</h3></div><div><p className="muted">Mismatches</p><h3>{ledgerReplay?.replay_meta?.mismatched_friends ?? "--"}</h3></div></div>
              <ul className="stream-list compact">{ledgerEvents.map((event) => <li key={event.id}><span>{event.event_type}</span><span className="muted">{formatDateTime(event.created_at)}</span></li>)}</ul>
              <h4>Recurring Rules</h4>
              <form className="stack-form" onSubmit={saveRule}>
                <label>Friend<select value={ruleForm.friend_id} onChange={(event) => setRuleForm((prev) => ({ ...prev, friend_id: event.target.value }))}>{friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select></label>
                <label>Type<select value={ruleForm.type} onChange={(event) => setRuleForm((prev) => ({ ...prev, type: event.target.value }))}><option value="expense">Expense</option><option value="lend">Lend</option><option value="debt">Debt</option><option value="settlement">Settlement</option></select></label>
                <label>Frequency<select value={ruleForm.frequency} onChange={(event) => setRuleForm((prev) => ({ ...prev, frequency: event.target.value }))}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                <label>Due<input type="date" value={ruleForm.next_due_date} onChange={(event) => setRuleForm((prev) => ({ ...prev, next_due_date: event.target.value }))} /></label>
                <label>Amount<input type="number" min="1" step="0.01" value={ruleForm.amount} onChange={(event) => setRuleForm((prev) => ({ ...prev, amount: event.target.value }))} /></label>
                <button type="submit" className="ghost-btn" disabled={busy.rule}>{busy.rule ? "Saving..." : "Create Rule"}</button>
              </form>
              <button type="button" className="solid-btn" onClick={runRules} disabled={busy.runRules}>{busy.runRules ? "Running..." : "Run Due Rules"}</button>
              <ul className="stream-list compact">{rules.map((rule) => <li key={rule.id}><span>{rule.friend_name} · {typeLabel[rule.type]} · {rule.frequency}</span><button type="button" className="ghost-btn" onClick={() => toggleRule(rule)}>{rule.active ? "Pause" : "Activate"}</button></li>)}</ul>
              <h4>Imports</h4>
              <ul className="stream-list compact">{imports.slice(0, 5).map((item) => <li key={item.id}><span>{item.source_name}</span><span className="muted">{item.created_rows} created</span></li>)}</ul>
            </article>
            </section>
          )}
        </>
      ) : (
        <SplitwiseTab userId={userId} apiFetch={apiFetch} setNotice={setNotice} />
      )}
    </main>
  );
}

export default App;
