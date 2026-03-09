import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const DEFAULT_USER_ID =
  import.meta.env.VITE_DEFAULT_USER_ID ||
  "1f866940-cc5b-4c6f-a949-5776ded9d1c6";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildQuery(params) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }
  return searchParams.toString();
}

function formatDateTime(value) {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function tone(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function typeLabel(type) {
  const labels = { expense: "Expense", lend: "Lend", settlement: "Settlement" };
  return labels[type] || type;
}

function transactionImpact(type, amount) {
  const numeric = toNumber(amount);
  return type === "settlement" ? -numeric : numeric;
}

function App() {
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [userIdInput, setUserIdInput] = useState(DEFAULT_USER_ID);

  const [friends, setFriends] = useState([]);
  const [balances, setBalances] = useState([]);
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [rules, setRules] = useState([]);

  const [transactions, setTransactions] = useState([]);
  const [filters, setFilters] = useState({
    friend_id: "",
    type: "",
    from: "",
    to: "",
    page: 1,
    limit: 20
  });
  const [pagination, setPagination] = useState({
    page: 1,
    total_pages: 1,
    total_count: 0
  });

  const [loadingCore, setLoadingCore] = useState(true);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [friendName, setFriendName] = useState("");
  const [quickInput, setQuickInput] = useState("");
  const [quickPreview, setQuickPreview] = useState(null);
  const [txForm, setTxForm] = useState({
    friend_id: "",
    type: "expense",
    amount: "",
    description: ""
  });
  const [ruleForm, setRuleForm] = useState({
    friend_id: "",
    type: "expense",
    amount: "",
    frequency: "monthly",
    next_due_date: todayISO(),
    description: ""
  });
  const [busy, setBusy] = useState({
    friend: false,
    tx: false,
    parse: false,
    rule: false,
    runRules: false,
    export: false
  });

  const apiFetch = useCallback(async (path, options = {}) => {
    const requestOptions = { ...options };
    const headers = { ...(options.headers || {}) };

    if (requestOptions.body && typeof requestOptions.body === "object") {
      headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(requestOptions.body);
    }
    requestOptions.headers = headers;

    const response = await fetch(`${API_BASE_URL}${path}`, requestOptions);
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();

    if (!response.ok) {
      throw new Error(
        typeof payload === "object" ? payload.error || "Request failed" : "Request failed"
      );
    }

    return payload;
  }, []);

  const loadCoreData = useCallback(async () => {
    setLoadingCore(true);
    setError("");

    try {
      const results = await Promise.allSettled([
        apiFetch(`/friends/${userId}`),
        apiFetch(`/balances/${userId}`),
        apiFetch(`/balances/summary/${userId}`),
        apiFetch(`/transactions/stats/${userId}`),
        apiFetch(`/analytics/${userId}?months=6`),
        apiFetch(`/recurring/${userId}`)
      ]);

      const payloadOrDefault = (index, fallback) => {
        const result = results[index];
        if (result.status === "fulfilled") return result.value;
        return fallback;
      };

      setFriends(Array.isArray(payloadOrDefault(0, [])) ? payloadOrDefault(0, []) : []);
      setBalances(
        Array.isArray(payloadOrDefault(1, [])) ? payloadOrDefault(1, []) : []
      );
      setSummary(payloadOrDefault(2, null));
      setStats(payloadOrDefault(3, null));
      setAnalytics(payloadOrDefault(4, null));
      setRules(Array.isArray(payloadOrDefault(5, [])) ? payloadOrDefault(5, []) : []);

      const firstFailure = results.find((result) => result.status === "rejected");
      if (firstFailure) {
        setError(firstFailure.reason?.message || "Some dashboard sections failed to load.");
      }
    } catch (loadError) {
      setError(loadError.message || "Failed to load dashboard");
    } finally {
      setLoadingCore(false);
    }
  }, [apiFetch, userId]);

  const loadTransactions = useCallback(async () => {
    setLoadingTransactions(true);
    setError("");

    try {
      const query = buildQuery(filters);
      const payload = await apiFetch(`/transactions/user/${userId}?${query}`);
      setTransactions(Array.isArray(payload.data) ? payload.data : []);
      setPagination(payload.pagination || { page: 1, total_pages: 1, total_count: 0 });
    } catch (loadError) {
      setTransactions([]);
      setError(loadError.message || "Failed to load transactions");
    } finally {
      setLoadingTransactions(false);
    }
  }, [apiFetch, filters, userId]);

  useEffect(() => {
    loadCoreData();
  }, [loadCoreData]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (!friends.length) {
      setTxForm((prev) => ({ ...prev, friend_id: "" }));
      setRuleForm((prev) => ({ ...prev, friend_id: "" }));
      return;
    }

    setTxForm((prev) => {
      const exists = friends.some((friend) => friend.id === prev.friend_id);
      return exists ? prev : { ...prev, friend_id: friends[0].id };
    });

    setRuleForm((prev) => {
      const exists = friends.some((friend) => friend.id === prev.friend_id);
      return exists ? prev : { ...prev, friend_id: friends[0].id };
    });
  }, [friends]);

  const balanceRows = useMemo(() => {
    const map = balances.reduce((acc, row) => {
      acc[row.friend_id] = toNumber(row.balance);
      return acc;
    }, {});

    return friends
      .map((friend) => ({
        friend_id: friend.id,
        friend_name: friend.name,
        balance: map[friend.id] ?? 0
      }))
      .sort((a, b) => a.friend_name.localeCompare(b.friend_name));
  }, [balances, friends]);

  const monthlyTrend = analytics?.monthly_trend || [];
  const topExposure = analytics?.top_exposure || [];
  const activityByType = analytics?.activity_by_type || [];
  const maxTrend = Math.max(
    1,
    ...monthlyTrend.map((row) => Math.abs(toNumber(row.net_change)))
  );

  const handleUserSwitch = (event) => {
    event.preventDefault();
    const nextId = userIdInput.trim();
    if (!nextId) return;
    setUserId(nextId);
    setFilters((prev) => ({ ...prev, friend_id: "", page: 1 }));
    setSuccess("User switched.");
    setError("");
  };

  const addFriend = async (event) => {
    event.preventDefault();
    if (!friendName.trim()) return;
    setBusy((prev) => ({ ...prev, friend: true }));
    setError("");
    setSuccess("");
    try {
      await apiFetch("/friends", {
        method: "POST",
        body: { user_id: userId, name: friendName.trim() }
      });
      setFriendName("");
      setSuccess("Friend added.");
      await loadCoreData();
    } catch (requestError) {
      setError(requestError.message || "Could not add friend");
    } finally {
      setBusy((prev) => ({ ...prev, friend: false }));
    }
  };

  const saveTransaction = async (event) => {
    event.preventDefault();
    if (!txForm.friend_id || toNumber(txForm.amount) <= 0) return;
    setBusy((prev) => ({ ...prev, tx: true }));
    setError("");
    setSuccess("");
    try {
      await apiFetch("/transactions", {
        method: "POST",
        body: {
          user_id: userId,
          friend_id: txForm.friend_id,
          type: txForm.type,
          amount: toNumber(txForm.amount),
          description: txForm.description.trim()
        }
      });
      setTxForm((prev) => ({ ...prev, amount: "", description: "" }));
      setQuickInput("");
      setQuickPreview(null);
      setSuccess(`${typeLabel(txForm.type)} saved.`);
      await Promise.all([loadCoreData(), loadTransactions()]);
    } catch (requestError) {
      setError(requestError.message || "Could not save transaction");
    } finally {
      setBusy((prev) => ({ ...prev, tx: false }));
    }
  };

  const parseQuick = async (event) => {
    event.preventDefault();
    if (!quickInput.trim()) return;
    setBusy((prev) => ({ ...prev, parse: true }));
    setError("");
    setSuccess("");
    try {
      const parsed = await apiFetch("/transactions/parse", {
        method: "POST",
        body: { input: quickInput.trim(), fallback_type: txForm.type }
      });
      setQuickPreview(parsed);

      const guess = String(parsed.friend_name_guess || "").toLowerCase();
      const matchedFriend = friends.find((friend) => friend.name.toLowerCase() === guess);

      setTxForm((prev) => ({
        ...prev,
        type: parsed.type || prev.type,
        amount: parsed.amount ? String(parsed.amount) : prev.amount,
        description: parsed.description || prev.description,
        friend_id: matchedFriend ? matchedFriend.id : prev.friend_id
      }));
      setSuccess("Quick input parsed.");
    } catch (requestError) {
      setError(requestError.message || "Could not parse quick input");
    } finally {
      setBusy((prev) => ({ ...prev, parse: false }));
    }
  };

  const saveRule = async (event) => {
    event.preventDefault();
    if (!ruleForm.friend_id || toNumber(ruleForm.amount) <= 0) return;
    setBusy((prev) => ({ ...prev, rule: true }));
    setError("");
    setSuccess("");
    try {
      await apiFetch("/recurring", {
        method: "POST",
        body: {
          user_id: userId,
          friend_id: ruleForm.friend_id,
          type: ruleForm.type,
          amount: toNumber(ruleForm.amount),
          frequency: ruleForm.frequency,
          next_due_date: ruleForm.next_due_date,
          description: ruleForm.description.trim()
        }
      });
      setRuleForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
        next_due_date: todayISO()
      }));
      setSuccess("Recurring rule created.");
      await loadCoreData();
    } catch (requestError) {
      setError(requestError.message || "Could not create recurring rule");
    } finally {
      setBusy((prev) => ({ ...prev, rule: false }));
    }
  };

  const runRules = async () => {
    setBusy((prev) => ({ ...prev, runRules: true }));
    setError("");
    setSuccess("");
    try {
      const payload = await apiFetch(`/recurring/run/${userId}`, { method: "POST" });
      setSuccess(`Generated ${payload.generated_transactions || 0} recurring transactions.`);
      await Promise.all([loadCoreData(), loadTransactions()]);
    } catch (requestError) {
      setError(requestError.message || "Could not run recurring rules");
    } finally {
      setBusy((prev) => ({ ...prev, runRules: false }));
    }
  };

  const toggleRule = async (rule) => {
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/recurring/${rule.id}`, {
        method: "PATCH",
        body: { active: !rule.active }
      });
      setSuccess(rule.active ? "Rule paused." : "Rule activated.");
      await loadCoreData();
    } catch (requestError) {
      setError(requestError.message || "Could not update rule");
    }
  };

  const updateFilter = (event) => {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value, page: 1 }));
  };

  const movePage = (delta) => {
    setFilters((prev) => {
      const nextPage = Math.min(Math.max(prev.page + delta, 1), pagination.total_pages || 1);
      return { ...prev, page: nextPage };
    });
  };

  const exportCsv = async () => {
    setBusy((prev) => ({ ...prev, export: true }));
    setError("");
    setSuccess("");
    try {
      const query = buildQuery({
        friend_id: filters.friend_id,
        type: filters.type,
        from: filters.from,
        to: filters.to
      });
      const response = await fetch(
        `${API_BASE_URL}/reports/${userId}.csv${query ? `?${query}` : ""}`
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Could not export CSV");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ledger-report-${userId.slice(0, 8)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSuccess("CSV report exported.");
    } catch (requestError) {
      setError(requestError.message || "Could not export CSV");
    } finally {
      setBusy((prev) => ({ ...prev, export: false }));
    }
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Personal Finance Intelligence</p>
          <h1>LedgerForge</h1>
          <p className="hero-subtitle">
            Debt ledger with analytics, recurring automation, smart parsing, and exports.
          </p>
        </div>
        <form className="user-switch" onSubmit={handleUserSwitch}>
          <label htmlFor="user-id">Active User ID</label>
          <input
            id="user-id"
            value={userIdInput}
            onChange={(event) => setUserIdInput(event.target.value)}
          />
          <button type="submit" className="secondary-btn">
            Load
          </button>
        </form>
      </header>

      {(error || success) && (
        <section className="panel">
          {error && <p className="notice error">{error}</p>}
          {success && <p className="notice success">{success}</p>}
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <h2>Overview</h2>
          <button className="secondary-btn" onClick={loadCoreData} disabled={loadingCore}>
            {loadingCore ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="kpi-grid">
          <article className="kpi-card">
            <p className="kpi-label">Receivable</p>
            <p className="kpi-value positive">{INR.format(toNumber(summary?.receivable_total))}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Payable</p>
            <p className="kpi-value negative">{INR.format(toNumber(summary?.payable_total))}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Net</p>
            <p className={`kpi-value ${tone(toNumber(summary?.net_position))}`}>
              {INR.format(toNumber(summary?.net_position))}
            </p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Transactions</p>
            <p className="kpi-value">{Math.trunc(toNumber(stats?.total_transactions))}</p>
          </article>
        </div>
      </section>

      <section className="panel two-col">
        <div>
          <h2>Friends & Balances</h2>
          {!loadingCore && !balanceRows.length && <p className="state-text">No friends yet.</p>}
          <ul className="friend-list">
            {balanceRows.map((row) => (
              <li key={row.friend_id} className="friend-row">
                <div>
                  <p className="friend-name">{row.friend_name}</p>
                  <p className={`friend-note ${tone(row.balance)}`}>
                    {row.balance > 0
                      ? "Friend owes you"
                      : row.balance < 0
                        ? "You owe friend"
                        : "Settled"}
                  </p>
                </div>
                <p className={`friend-amount ${tone(row.balance)}`}>{INR.format(row.balance)}</p>
              </li>
            ))}
          </ul>
          <form className="inline-form" onSubmit={addFriend}>
            <input
              value={friendName}
              onChange={(event) => setFriendName(event.target.value)}
              placeholder="Add friend name"
            />
            <button type="submit" className="primary-btn" disabled={busy.friend}>
              {busy.friend ? "Adding..." : "+ Add Friend"}
            </button>
          </form>
        </div>

        <div>
          <h2>Quick Transaction</h2>
          <form className="stack-form" onSubmit={saveTransaction}>
            <label>
              Type
              <select
                value={txForm.type}
                onChange={(event) => setTxForm((prev) => ({ ...prev, type: event.target.value }))}
              >
                <option value="expense">Expense</option>
                <option value="lend">Lend</option>
                <option value="settlement">Settlement</option>
              </select>
            </label>
            <label>
              Friend
              <select
                value={txForm.friend_id}
                onChange={(event) =>
                  setTxForm((prev) => ({ ...prev, friend_id: event.target.value }))
                }
              >
                {friends.length === 0 && <option value="">No friend found</option>}
                {friends.map((friend) => (
                  <option value={friend.id} key={friend.id}>
                    {friend.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input
                type="number"
                min="1"
                step="0.01"
                value={txForm.amount}
                onChange={(event) => setTxForm((prev) => ({ ...prev, amount: event.target.value }))}
                required
              />
            </label>
            <label>
              Description
              <textarea
                rows="2"
                value={txForm.description}
                onChange={(event) =>
                  setTxForm((prev) => ({ ...prev, description: event.target.value }))
                }
              />
            </label>
            <button type="submit" className="primary-btn" disabled={busy.tx || friends.length === 0}>
              {busy.tx ? "Saving..." : "Save Transaction"}
            </button>
          </form>
          <form className="smart-form" onSubmit={parseQuick}>
            <label>
              Smart Input
              <input
                value={quickInput}
                onChange={(event) => setQuickInput(event.target.value)}
                placeholder="paid 650 to Rahul for dinner"
              />
            </label>
            <button type="submit" className="secondary-btn" disabled={busy.parse}>
              {busy.parse ? "Parsing..." : "Parse Text"}
            </button>
          </form>
          {quickPreview && (
            <div className="smart-preview">
              <p>
                Type: <strong>{typeLabel(quickPreview.type)}</strong>
              </p>
              <p>
                Amount:{" "}
                <strong>
                  {quickPreview.amount ? INR.format(toNumber(quickPreview.amount)) : "--"}
                </strong>
              </p>
              <p>Friend Guess: {quickPreview.friend_name_guess || "--"}</p>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Transactions</h2>
          <button
            type="button"
            className="secondary-btn"
            onClick={exportCsv}
            disabled={busy.export}
          >
            {busy.export ? "Exporting..." : "Export CSV"}
          </button>
        </div>
        <div className="filters-grid">
          <label>
            Friend
            <select name="friend_id" value={filters.friend_id} onChange={updateFilter}>
              <option value="">All friends</option>
              {friends.map((friend) => (
                <option value={friend.id} key={friend.id}>
                  {friend.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="type" value={filters.type} onChange={updateFilter}>
              <option value="">All types</option>
              <option value="expense">Expense</option>
              <option value="lend">Lend</option>
              <option value="settlement">Settlement</option>
            </select>
          </label>
          <label>
            From
            <input name="from" type="date" value={filters.from} onChange={updateFilter} />
          </label>
          <label>
            To
            <input name="to" type="date" value={filters.to} onChange={updateFilter} />
          </label>
        </div>
        {loadingTransactions && <p className="state-text">Loading transactions...</p>}
        {!loadingTransactions && transactions.length === 0 && (
          <p className="state-text">No transactions for selected filters.</p>
        )}
        <ul className="tx-list">
          {transactions.map((transaction) => {
            const impact = transactionImpact(transaction.type, transaction.amount);
            return (
              <li className="tx-row" key={transaction.id}>
                <div className="tx-left">
                  <p className="tx-main">
                    {transaction.friend_name}
                    <span className={`tx-badge tx-${transaction.type}`}>
                      {typeLabel(transaction.type)}
                    </span>
                  </p>
                  <p className="tx-sub">{transaction.description || "No description"}</p>
                  <p className="tx-time">{formatDateTime(transaction.created_at)}</p>
                </div>
                <p className={`tx-amount ${tone(impact)}`}>{INR.format(impact)}</p>
              </li>
            );
          })}
        </ul>
        <div className="pagination">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => movePage(-1)}
            disabled={filters.page <= 1}
          >
            Previous
          </button>
          <p>
            Page {filters.page} / {pagination.total_pages} ({pagination.total_count} rows)
          </p>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => movePage(1)}
            disabled={filters.page >= pagination.total_pages}
          >
            Next
          </button>
        </div>
      </section>

      <section className="panel two-col">
        <div>
          <h2>Analytics</h2>
          <div className="trend-list">
            {monthlyTrend.map((row) => {
              const value = toNumber(row.net_change);
              return (
                <article key={row.month} className="trend-row">
                  <p>{row.month}</p>
                  <div className="trend-track">
                    <div
                      className={`trend-bar ${tone(value)}`}
                      style={{ width: `${Math.max((Math.abs(value) / maxTrend) * 100, 2)}%` }}
                    />
                  </div>
                  <p className={tone(value)}>{INR.format(value)}</p>
                </article>
              );
            })}
          </div>
          <div className="activity-grid">
            {activityByType.map((row) => (
              <article className="activity-card" key={row.type}>
                <p className="kpi-label">{typeLabel(row.type)}</p>
                <p className="kpi-value">{row.tx_count}</p>
                <p className="kpi-foot">{INR.format(toNumber(row.total_amount))}</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h2>Top Exposure</h2>
          <ul className="friend-list">
            {topExposure.map((row) => (
              <li className="friend-row" key={row.friend_id}>
                <p className="friend-name">{row.friend_name}</p>
                <p className={`friend-amount ${tone(toNumber(row.balance))}`}>
                  {INR.format(toNumber(row.balance))}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recurring Rules</h2>
          <button
            type="button"
            className="primary-btn"
            onClick={runRules}
            disabled={busy.runRules}
          >
            {busy.runRules ? "Running..." : "Run Due Rules"}
          </button>
        </div>
        <form className="recurring-form" onSubmit={saveRule}>
          <label>
            Friend
            <select
              value={ruleForm.friend_id}
              onChange={(event) =>
                setRuleForm((prev) => ({ ...prev, friend_id: event.target.value }))
              }
            >
              {friends.length === 0 && <option value="">No friend found</option>}
              {friends.map((friend) => (
                <option value={friend.id} key={friend.id}>
                  {friend.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select
              value={ruleForm.type}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, type: event.target.value }))}
            >
              <option value="expense">Expense</option>
              <option value="lend">Lend</option>
              <option value="settlement">Settlement</option>
            </select>
          </label>
          <label>
            Frequency
            <select
              value={ruleForm.frequency}
              onChange={(event) =>
                setRuleForm((prev) => ({ ...prev, frequency: event.target.value }))
              }
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>
            Next Due Date
            <input
              type="date"
              value={ruleForm.next_due_date}
              onChange={(event) =>
                setRuleForm((prev) => ({ ...prev, next_due_date: event.target.value }))
              }
              required
            />
          </label>
          <label>
            Amount
            <input
              type="number"
              min="1"
              step="0.01"
              value={ruleForm.amount}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, amount: event.target.value }))}
              required
            />
          </label>
          <label>
            Description
            <input
              value={ruleForm.description}
              onChange={(event) =>
                setRuleForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </label>
          <button type="submit" className="primary-btn" disabled={busy.rule}>
            {busy.rule ? "Saving..." : "Create Rule"}
          </button>
        </form>
        <ul className="rule-list">
          {rules.map((rule) => (
            <li key={rule.id} className="rule-row">
              <div>
                <p className="friend-name">
                  {rule.friend_name} · {typeLabel(rule.type)} · {rule.frequency}
                </p>
                <p className="tx-sub">
                  {INR.format(toNumber(rule.amount))} · Next due {rule.next_due_date}
                </p>
                <p className="tx-time">{rule.description || "No description"}</p>
              </div>
              <button type="button" className="secondary-btn" onClick={() => toggleRule(rule)}>
                {rule.active ? "Pause" : "Activate"}
              </button>
            </li>
          ))}
          {rules.length === 0 && <p className="state-text">No recurring rules configured.</p>}
        </ul>
      </section>

      <footer className="footer-note">
        Active backend: <code>{API_BASE_URL}</code> · Current user: <code>{userId}</code>
      </footer>
    </main>
  );
}

export default App;
