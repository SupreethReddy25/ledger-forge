import { useCallback, useEffect, useMemo, useState } from "react";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

const todayString = () => new Date().toISOString().slice(0, 10);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toCents = (value) => Math.round(toNumber(value) * 100);
const fromCents = (value) => (value / 100).toFixed(2);
const netTone = (value) => (value > 0 ? "positive" : value < 0 ? "negative" : "neutral");

const formatDate = (value) => {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

function buildInitialSplitRows(members, method, amount) {
  if (!members.length) return [];

  if (method === "exact") {
    const totalCents = toCents(amount);
    const base = Math.floor(totalCents / members.length);
    let remaining = totalCents - base * members.length;
    return members.map((member) => {
      const cents = base + (remaining > 0 ? 1 : 0);
      remaining -= remaining > 0 ? 1 : 0;
      return {
        member_id: member.id,
        included: true,
        share_amount: totalCents > 0 ? fromCents(cents) : "",
        share_percent: ""
      };
    });
  }

  if (method === "percentage") {
    const rowCount = members.length;
    const basePercent = rowCount ? Number((100 / rowCount).toFixed(2)) : 0;
    let running = 0;

    return members.map((member, index) => {
      const percent =
        index === rowCount - 1 ? Number((100 - running).toFixed(2)) : basePercent;
      running += percent;
      return {
        member_id: member.id,
        included: true,
        share_amount: "",
        share_percent: String(percent)
      };
    });
  }

  return members.map((member) => ({
    member_id: member.id,
    included: true,
    share_amount: "",
    share_percent: ""
  }));
}

function SplitwiseTab({ userId, apiFetch, setNotice }) {
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupDetail, setGroupDetail] = useState(null);
  const [members, setMembers] = useState([]);
  const [balances, setBalances] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [activity, setActivity] = useState([]);
  const [invites, setInvites] = useState([]);
  const [approvalQueue, setApprovalQueue] = useState([]);
  const [reminders, setReminders] = useState([]);

  const [groupForm, setGroupForm] = useState({
    name: "",
    description: ""
  });
  const [settingsForm, setSettingsForm] = useState({
    require_approval: false,
    reminder_interval_days: 3
  });
  const [inviteForm, setInviteForm] = useState({
    expires_in_hours: "72",
    max_uses: "25"
  });
  const [joinInviteCode, setJoinInviteCode] = useState("");
  const [memberForm, setMemberForm] = useState({
    member_type: "friend",
    friend_id: "",
    member_user_id: userId,
    display_name: ""
  });
  const [expenseForm, setExpenseForm] = useState({
    paid_by_member_id: "",
    title: "",
    notes: "",
    amount: "",
    split_method: "equal",
    expense_date: todayString()
  });
  const [splitRows, setSplitRows] = useState([]);
  const [settlementForm, setSettlementForm] = useState({
    from_member_id: "",
    to_member_id: "",
    amount: "",
    notes: "",
    settled_at: todayString()
  });

  const [busy, setBusy] = useState({
    workspace: false,
    createGroup: false,
    deleteGroup: false,
    addMember: false,
    removeMemberId: "",
    createExpense: false,
    deleteExpenseId: "",
    createSettlement: false,
    deleteSettlementId: "",
    saveSettings: false,
    createInvite: false,
    revokeInviteId: "",
    decideApprovalId: "",
    joinInvite: false
  });

  const refreshGroups = useCallback(async () => {
    const payload = await apiFetch(`/groups/user/${userId}`);
    setGroups(payload);
    setSelectedGroupId((prev) => {
      if (prev && payload.some((item) => item.id === prev)) return prev;
      return payload[0]?.id || "";
    });
    return payload;
  }, [apiFetch, userId]);

  const refreshFriends = useCallback(async () => {
    const payload = await apiFetch(`/friends/${userId}`);
    setFriends(payload);
    return payload;
  }, [apiFetch, userId]);

  const refreshGroupWorkspace = useCallback(
    async (groupId) => {
      if (!groupId) {
        setGroupDetail(null);
        setMembers([]);
        setBalances(null);
        setExpenses([]);
        setSettlements([]);
        setActivity([]);
        setInvites([]);
        setApprovalQueue([]);
        setReminders([]);
        return;
      }

      setBusy((prev) => ({ ...prev, workspace: true }));
      try {
        const detailPayload = await apiFetch(`/groups/${groupId}?user_id=${userId}`);
        const isOwner = detailPayload.owner_user_id === userId;

        const [
          membersPayload,
          balancesPayload,
          expensesPayload,
          settlementsPayload,
          activityPayload,
          approvalsPayload,
          remindersPayload
        ] = await Promise.all([
          apiFetch(`/groups/${groupId}/members?user_id=${userId}`),
          apiFetch(`/group-balances/${groupId}?user_id=${userId}`),
          apiFetch(`/group-expenses/group/${groupId}?user_id=${userId}`),
          apiFetch(`/group-settlements/group/${groupId}?user_id=${userId}`),
          apiFetch(`/groups/${groupId}/activity?user_id=${userId}&limit=40`),
          apiFetch(`/groups/${groupId}/approvals?user_id=${userId}`),
          apiFetch(`/groups/${groupId}/reminders?user_id=${userId}`)
        ]);

        setGroupDetail(detailPayload);
        setMembers(membersPayload);
        setBalances(balancesPayload);
        setExpenses(expensesPayload);
        setSettlements(settlementsPayload);
        setActivity(activityPayload);
        setApprovalQueue(approvalsPayload.pending_items || []);
        setReminders(remindersPayload.reminders || []);
        setSettingsForm({
          require_approval: Boolean(detailPayload.require_approval),
          reminder_interval_days: Number(detailPayload.reminder_interval_days || 3)
        });

        if (isOwner) {
          try {
            const invitePayload = await apiFetch(`/groups/${groupId}/invites?user_id=${userId}`);
            setInvites(invitePayload);
          } catch {
            setInvites([]);
          }
        } else {
          setInvites([]);
        }

        setExpenseForm((prev) => ({
          ...prev,
          paid_by_member_id:
            membersPayload.some((member) => member.id === prev.paid_by_member_id)
              ? prev.paid_by_member_id
              : membersPayload[0]?.id || ""
        }));

        setSettlementForm((prev) => {
          const fromId = membersPayload.some((member) => member.id === prev.from_member_id)
            ? prev.from_member_id
            : membersPayload[0]?.id || "";
          const toId = membersPayload.some((member) => member.id === prev.to_member_id)
            ? prev.to_member_id
            : membersPayload.find((member) => member.id !== fromId)?.id || "";
          return {
            ...prev,
            from_member_id: fromId,
            to_member_id: toId
          };
        });

        setSplitRows((prev) => {
          const memberSet = new Set(membersPayload.map((member) => member.id));
          const stillValid = prev.filter((row) => memberSet.has(row.member_id));
          if (!stillValid.length) {
            return buildInitialSplitRows(membersPayload, "equal", "");
          }
          const knownIds = new Set(stillValid.map((row) => row.member_id));
          const append = membersPayload
            .filter((member) => !knownIds.has(member.id))
            .map((member) => ({
              member_id: member.id,
              included: true,
              share_amount: "",
              share_percent: ""
            }));
          return [...stillValid, ...append];
        });
      } catch (err) {
        setNotice("error", err.message || "Unable to load splitwise workspace");
      } finally {
        setBusy((prev) => ({ ...prev, workspace: false }));
      }
    },
    [apiFetch, setNotice, userId]
  );

  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([refreshFriends(), refreshGroups()]);
      } catch (err) {
        setNotice("error", err.message || "Unable to load splitwise setup");
      }
    };
    init();
  }, [refreshFriends, refreshGroups, setNotice]);

  useEffect(() => {
    refreshGroupWorkspace(selectedGroupId);
  }, [selectedGroupId, refreshGroupWorkspace]);

  useEffect(() => {
    setMemberForm((prev) => ({
      ...prev,
      member_user_id: userId
    }));
  }, [userId]);

  const memberNameById = useMemo(
    () =>
      members.reduce((acc, member) => {
        acc[member.id] = member.display_name;
        return acc;
      }, {}),
    [members]
  );

  const availableFriends = useMemo(() => {
    const existingFriendIds = new Set(
      members.filter((member) => member.friend_id).map((member) => member.friend_id)
    );
    return friends.filter((friend) => !existingFriendIds.has(friend.id));
  }, [friends, members]);

  const isOwner = useMemo(
    () => Boolean(groupDetail && groupDetail.owner_user_id === userId),
    [groupDetail, userId]
  );

  const upsertSplitRowsForMethod = (method, amount) => {
    setSplitRows(buildInitialSplitRows(members, method, amount));
  };

  const createGroup = async (event) => {
    event.preventDefault();
    if (!groupForm.name.trim()) return;

    setBusy((prev) => ({ ...prev, createGroup: true }));
    try {
      const created = await apiFetch("/groups", {
        method: "POST",
        body: {
          owner_user_id: userId,
          name: groupForm.name.trim(),
          description: groupForm.description.trim()
        }
      });
      setGroupForm({ name: "", description: "" });
      await refreshGroups();
      setSelectedGroupId(created.id);
      setNotice("success", "Group created.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, createGroup: false }));
    }
  };

  const deleteGroup = async () => {
    if (!selectedGroupId) return;
    if (!window.confirm("Delete this group and all its records?")) return;

    setBusy((prev) => ({ ...prev, deleteGroup: true }));
    try {
      await apiFetch(`/groups/${selectedGroupId}?user_id=${userId}`, {
        method: "DELETE"
      });
      await refreshGroups();
      setNotice("success", "Group deleted.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, deleteGroup: false }));
    }
  };

  const addMember = async (event) => {
    event.preventDefault();
    if (!selectedGroupId) return;

    const payload = {
      user_id: userId,
      member_type: memberForm.member_type,
      display_name: memberForm.display_name.trim() || undefined
    };

    if (memberForm.member_type === "friend") {
      if (!memberForm.friend_id) {
        setNotice("error", "Select a friend to add.");
        return;
      }
      payload.friend_id = memberForm.friend_id;
    } else {
      if (!memberForm.member_user_id.trim()) {
        setNotice("error", "member_user_id is required.");
        return;
      }
      payload.member_user_id = memberForm.member_user_id.trim();
    }

    setBusy((prev) => ({ ...prev, addMember: true }));
    try {
      await apiFetch(`/groups/${selectedGroupId}/members`, {
        method: "POST",
        body: payload
      });
      setMemberForm((prev) => ({ ...prev, friend_id: "", display_name: "" }));
      await Promise.all([refreshGroups(), refreshGroupWorkspace(selectedGroupId)]);
      setNotice("success", "Member added.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, addMember: false }));
    }
  };

  const removeMember = async (memberId) => {
    if (!selectedGroupId) return;
    if (!window.confirm("Remove this member?")) return;

    setBusy((prev) => ({ ...prev, removeMemberId: memberId }));
    try {
      await apiFetch(`/groups/${selectedGroupId}/members/${memberId}?user_id=${userId}`, {
        method: "DELETE"
      });
      await Promise.all([refreshGroups(), refreshGroupWorkspace(selectedGroupId)]);
      setNotice("success", "Member removed.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, removeMemberId: "" }));
    }
  };

  const autoFillSplits = () => {
    upsertSplitRowsForMethod(expenseForm.split_method, expenseForm.amount);
  };

  const createExpense = async (event) => {
    event.preventDefault();
    if (!selectedGroupId) return;

    const activeRows = splitRows.filter((row) => row.included);
    if (!activeRows.length) {
      setNotice("error", "Select at least one participant.");
      return;
    }

    let requestSplits = activeRows.map((row) => ({ member_id: row.member_id }));

    if (expenseForm.split_method === "exact") {
      requestSplits = activeRows.map((row) => ({
        member_id: row.member_id,
        share_amount: toNumber(row.share_amount)
      }));
    }

    if (expenseForm.split_method === "percentage") {
      requestSplits = activeRows.map((row) => ({
        member_id: row.member_id,
        share_percent: toNumber(row.share_percent)
      }));
    }

    setBusy((prev) => ({ ...prev, createExpense: true }));
    try {
      const payload = await apiFetch("/group-expenses", {
        method: "POST",
        body: {
          group_id: selectedGroupId,
          user_id: userId,
          paid_by_member_id: expenseForm.paid_by_member_id,
          title: expenseForm.title.trim(),
          notes: expenseForm.notes.trim(),
          amount: toNumber(expenseForm.amount),
          split_method: expenseForm.split_method,
          splits: requestSplits,
          expense_date: expenseForm.expense_date
        }
      });
      setExpenseForm((prev) => ({
        ...prev,
        title: "",
        notes: "",
        amount: ""
      }));
      upsertSplitRowsForMethod(expenseForm.split_method, "");
      await Promise.all([refreshGroups(), refreshGroupWorkspace(selectedGroupId)]);
      setNotice(
        "success",
        payload.workflow_status === "submitted_for_approval"
          ? "Expense submitted for owner approval."
          : "Expense added."
      );
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, createExpense: false }));
    }
  };

  const deleteExpense = async (expenseId) => {
    if (!window.confirm("Delete this expense?")) return;
    setBusy((prev) => ({ ...prev, deleteExpenseId: expenseId }));
    try {
      await apiFetch(`/group-expenses/${expenseId}?user_id=${userId}`, {
        method: "DELETE"
      });
      await Promise.all([refreshGroups(), refreshGroupWorkspace(selectedGroupId)]);
      setNotice("success", "Expense deleted.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, deleteExpenseId: "" }));
    }
  };

  const createSettlement = async (event) => {
    event.preventDefault();
    if (!selectedGroupId) return;

    setBusy((prev) => ({ ...prev, createSettlement: true }));
    try {
      const payload = await apiFetch("/group-settlements", {
        method: "POST",
        body: {
          group_id: selectedGroupId,
          user_id: userId,
          from_member_id: settlementForm.from_member_id,
          to_member_id: settlementForm.to_member_id,
          amount: toNumber(settlementForm.amount),
          notes: settlementForm.notes.trim(),
          settled_at: settlementForm.settled_at
        }
      });
      setSettlementForm((prev) => ({
        ...prev,
        amount: "",
        notes: ""
      }));
      await Promise.all([refreshGroups(), refreshGroupWorkspace(selectedGroupId)]);
      setNotice(
        "success",
        payload.workflow_status === "submitted_for_approval"
          ? "Settlement submitted for owner approval."
          : "Settlement recorded."
      );
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, createSettlement: false }));
    }
  };

  const deleteSettlement = async (settlementId) => {
    if (!window.confirm("Delete this settlement?")) return;
    setBusy((prev) => ({ ...prev, deleteSettlementId: settlementId }));
    try {
      await apiFetch(`/group-settlements/${settlementId}?user_id=${userId}`, {
        method: "DELETE"
      });
      await Promise.all([refreshGroups(), refreshGroupWorkspace(selectedGroupId)]);
      setNotice("success", "Settlement deleted.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, deleteSettlementId: "" }));
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    if (!selectedGroupId || !isOwner) return;

    setBusy((prev) => ({ ...prev, saveSettings: true }));
    try {
      await apiFetch(`/groups/${selectedGroupId}/settings`, {
        method: "PATCH",
        body: {
          user_id: userId,
          require_approval: Boolean(settingsForm.require_approval),
          reminder_interval_days: toNumber(settingsForm.reminder_interval_days)
        }
      });
      await Promise.all([refreshGroups(), refreshGroupWorkspace(selectedGroupId)]);
      setNotice("success", "Governance settings updated.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, saveSettings: false }));
    }
  };

  const createInvite = async (event) => {
    event.preventDefault();
    if (!selectedGroupId || !isOwner) return;

    setBusy((prev) => ({ ...prev, createInvite: true }));
    try {
      await apiFetch(`/groups/${selectedGroupId}/invites`, {
        method: "POST",
        body: {
          user_id: userId,
          expires_in_hours: toNumber(inviteForm.expires_in_hours),
          max_uses: toNumber(inviteForm.max_uses)
        }
      });
      await refreshGroupWorkspace(selectedGroupId);
      setNotice("success", "Invite link generated.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, createInvite: false }));
    }
  };

  const revokeInvite = async (inviteId) => {
    if (!selectedGroupId || !isOwner) return;
    setBusy((prev) => ({ ...prev, revokeInviteId: inviteId }));
    try {
      await apiFetch(`/groups/${selectedGroupId}/invites/${inviteId}?user_id=${userId}`, {
        method: "DELETE"
      });
      await refreshGroupWorkspace(selectedGroupId);
      setNotice("success", "Invite revoked.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, revokeInviteId: "" }));
    }
  };

  const joinByInviteCode = async (event) => {
    event.preventDefault();
    const code = joinInviteCode.trim();
    if (!code) return;

    setBusy((prev) => ({ ...prev, joinInvite: true }));
    try {
      await apiFetch(`/groups/invites/${code}/accept`, {
        method: "POST",
        body: {
          user_id: userId
        }
      });
      setJoinInviteCode("");
      await refreshGroups();
      setNotice("success", "Joined group using invite code.");
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, joinInvite: false }));
    }
  };

  const decideApproval = async (item, decision) => {
    if (!selectedGroupId || !isOwner) return;

    const key = `${item.entity_type}-${item.entity_id}`;
    setBusy((prev) => ({ ...prev, decideApprovalId: key }));
    try {
      await apiFetch(
        `/groups/${selectedGroupId}/approvals/${item.entity_type}/${item.entity_id}`,
        {
          method: "POST",
          body: {
            user_id: userId,
            decision
          }
        }
      );
      await Promise.all([refreshGroups(), refreshGroupWorkspace(selectedGroupId)]);
      setNotice("success", `Request ${decision}.`);
    } catch (err) {
      setNotice("error", err.message);
    } finally {
      setBusy((prev) => ({ ...prev, decideApprovalId: "" }));
    }
  };

  return (
    <section className="splitwise-shell">
      <aside className="splitwise-rail">
        <div className="splitwise-rail-head">
          <p className="eyebrow">Trip Ledger</p>
          <h2>Groups</h2>
        </div>
        <ul className="group-list">
          {groups.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className={`group-chip ${selectedGroupId === group.id ? "active" : ""}`}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <span>{group.name}</span>
                <small>
                  {group.member_count} members · {INR.format(toNumber(group.total_expense))} ·{" "}
                  {toNumber(group.pending_expense_approvals) +
                    toNumber(group.pending_settlement_approvals)}{" "}
                  pending
                </small>
              </button>
            </li>
          ))}
          {groups.length === 0 && <li className="muted">No groups yet.</li>}
        </ul>

        <form className="stack-form split-form" onSubmit={createGroup}>
          <h3>Create Group</h3>
          <input
            placeholder="Goa Trip"
            value={groupForm.name}
            onChange={(event) =>
              setGroupForm((prev) => ({
                ...prev,
                name: event.target.value
              }))
            }
          />
          <textarea
            rows="2"
            placeholder="Beach stay, food, travel"
            value={groupForm.description}
            onChange={(event) =>
              setGroupForm((prev) => ({
                ...prev,
                description: event.target.value
              }))
            }
          />
          <button type="submit" className="solid-btn" disabled={busy.createGroup}>
            {busy.createGroup ? "Creating..." : "Create Group"}
          </button>
        </form>

        <form className="stack-form split-form" onSubmit={joinByInviteCode}>
          <h3>Join with Invite</h3>
          <input
            placeholder="lf_abc123..."
            value={joinInviteCode}
            onChange={(event) => setJoinInviteCode(event.target.value)}
          />
          <button type="submit" className="ghost-btn" disabled={busy.joinInvite}>
            {busy.joinInvite ? "Joining..." : "Join Group"}
          </button>
        </form>
      </aside>

      <div className="splitwise-main">
        {!selectedGroupId && (
          <article className="split-empty">
            <h3>Start your first split</h3>
            <p>Create a trip, add friends, and log expenses with exact/equal/percentage splits.</p>
          </article>
        )}

        {selectedGroupId && (
          <>
            <header className="split-header">
              <div>
                <p className="eyebrow">Selected Group</p>
                <h2>{groupDetail?.name || "Group"}</h2>
                <p className="muted">{groupDetail?.description || "No description added yet."}</p>
              </div>
              <div className="split-header-actions">
                <button
                  type="button"
                  className="danger-btn"
                  onClick={deleteGroup}
                  disabled={busy.deleteGroup}
                >
                  {busy.deleteGroup ? "Deleting..." : "Delete Group"}
                </button>
              </div>
            </header>

            <section className="split-metrics">
              <article>
                <p>Total Expense</p>
                <h3>{INR.format(toNumber(balances?.summary?.total_expense))}</h3>
              </article>
              <article>
                <p>Total Settled</p>
                <h3>{INR.format(toNumber(balances?.summary?.total_settled))}</h3>
              </article>
              <article>
                <p>Members</p>
                <h3>{balances?.summary?.member_count ?? 0}</h3>
              </article>
              <article>
                <p>Settlement Steps</p>
                <h3>{balances?.simplified_settlements?.length ?? 0}</h3>
              </article>
              <article>
                <p>Pending Requests</p>
                <h3>
                  {toNumber(balances?.summary?.pending_expense_approvals) +
                    toNumber(balances?.summary?.pending_settlement_approvals)}
                </h3>
              </article>
              <article>
                <p>Approval Mode</p>
                <h3>{groupDetail?.require_approval ? "Enabled" : "Off"}</h3>
              </article>
            </section>

            <section className="split-grid">
              <article className="split-card">
                <h3>Members</h3>
                <ul className="member-list">
                  {members.map((member) => (
                    <li key={member.id}>
                      <span>
                        {member.display_name}
                        <small>{member.member_type}</small>
                      </span>
                      <button
                        type="button"
                        className="danger-btn"
                        disabled={busy.removeMemberId === member.id}
                        onClick={() => removeMember(member.id)}
                      >
                        {busy.removeMemberId === member.id ? "Removing..." : "Remove"}
                      </button>
                    </li>
                  ))}
                </ul>
                <form className="stack-form split-form" onSubmit={addMember}>
                  <label>
                    Member Type
                    <select
                      value={memberForm.member_type}
                      onChange={(event) =>
                        setMemberForm((prev) => ({
                          ...prev,
                          member_type: event.target.value
                        }))
                      }
                    >
                      <option value="friend">Friend</option>
                      <option value="user">User</option>
                    </select>
                  </label>
                  {memberForm.member_type === "friend" ? (
                    <label>
                      Friend
                      <select
                        value={memberForm.friend_id}
                        onChange={(event) =>
                          setMemberForm((prev) => ({
                            ...prev,
                            friend_id: event.target.value
                          }))
                        }
                      >
                        <option value="">Select friend</option>
                        {availableFriends.map((friend) => (
                          <option key={friend.id} value={friend.id}>
                            {friend.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      Member User ID
                      <input
                        value={memberForm.member_user_id}
                        onChange={(event) =>
                          setMemberForm((prev) => ({
                            ...prev,
                            member_user_id: event.target.value
                          }))
                        }
                      />
                    </label>
                  )}
                  <label>
                    Display Name (optional)
                    <input
                      value={memberForm.display_name}
                      onChange={(event) =>
                        setMemberForm((prev) => ({
                          ...prev,
                          display_name: event.target.value
                        }))
                      }
                    />
                  </label>
                  <button type="submit" className="ghost-btn" disabled={busy.addMember}>
                    {busy.addMember ? "Adding..." : "Add Member"}
                  </button>
                </form>
              </article>

              <article className="split-card">
                <h3>Add Expense</h3>
                <form className="stack-form split-form" onSubmit={createExpense}>
                  <label>
                    Title
                    <input
                      value={expenseForm.title}
                      onChange={(event) =>
                        setExpenseForm((prev) => ({
                          ...prev,
                          title: event.target.value
                        }))
                      }
                    />
                  </label>
                  <div className="mini-grid">
                    <label>
                      Amount
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={expenseForm.amount}
                        onChange={(event) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            amount: event.target.value
                          }))
                        }
                      />
                    </label>
                    <label>
                      Paid By
                      <select
                        value={expenseForm.paid_by_member_id}
                        onChange={(event) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            paid_by_member_id: event.target.value
                          }))
                        }
                      >
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.display_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mini-grid">
                    <label>
                      Split Method
                      <select
                        value={expenseForm.split_method}
                        onChange={(event) => {
                          const nextMethod = event.target.value;
                          setExpenseForm((prev) => ({
                            ...prev,
                            split_method: nextMethod
                          }));
                          upsertSplitRowsForMethod(nextMethod, expenseForm.amount);
                        }}
                      >
                        <option value="equal">Equal</option>
                        <option value="exact">Exact</option>
                        <option value="percentage">Percentage</option>
                      </select>
                    </label>
                    <label>
                      Date
                      <input
                        type="date"
                        value={expenseForm.expense_date}
                        onChange={(event) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            expense_date: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Notes
                    <textarea
                      rows="2"
                      value={expenseForm.notes}
                      onChange={(event) =>
                        setExpenseForm((prev) => ({
                          ...prev,
                          notes: event.target.value
                        }))
                      }
                    />
                  </label>
                  <div className="split-row-head">
                    <h4>Participants</h4>
                    <button type="button" className="ghost-btn" onClick={autoFillSplits}>
                      Auto Split
                    </button>
                  </div>
                  <ul className="split-row-list">
                    {splitRows.map((row) => (
                      <li key={row.member_id}>
                        <label className="participant-checkbox">
                          <input
                            type="checkbox"
                            checked={row.included}
                            onChange={(event) =>
                              setSplitRows((prev) =>
                                prev.map((item) =>
                                  item.member_id === row.member_id
                                    ? { ...item, included: event.target.checked }
                                    : item
                                )
                              )
                            }
                          />
                          <span>{memberNameById[row.member_id] || "Member"}</span>
                        </label>
                        {expenseForm.split_method === "exact" && (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.share_amount}
                            onChange={(event) =>
                              setSplitRows((prev) =>
                                prev.map((item) =>
                                  item.member_id === row.member_id
                                    ? { ...item, share_amount: event.target.value }
                                    : item
                                )
                              )
                            }
                          />
                        )}
                        {expenseForm.split_method === "percentage" && (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={row.share_percent}
                            onChange={(event) =>
                              setSplitRows((prev) =>
                                prev.map((item) =>
                                  item.member_id === row.member_id
                                    ? { ...item, share_percent: event.target.value }
                                    : item
                                )
                              )
                            }
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                  <button type="submit" className="solid-btn" disabled={busy.createExpense}>
                    {busy.createExpense ? "Saving..." : "Add Expense"}
                  </button>
                </form>
              </article>

              <article className="split-card">
                <h3>Record Settlement</h3>
                <form className="stack-form split-form" onSubmit={createSettlement}>
                  <div className="mini-grid">
                    <label>
                      From
                      <select
                        value={settlementForm.from_member_id}
                        onChange={(event) =>
                          setSettlementForm((prev) => ({
                            ...prev,
                            from_member_id: event.target.value
                          }))
                        }
                      >
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.display_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      To
                      <select
                        value={settlementForm.to_member_id}
                        onChange={(event) =>
                          setSettlementForm((prev) => ({
                            ...prev,
                            to_member_id: event.target.value
                          }))
                        }
                      >
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.display_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mini-grid">
                    <label>
                      Amount
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={settlementForm.amount}
                        onChange={(event) =>
                          setSettlementForm((prev) => ({
                            ...prev,
                            amount: event.target.value
                          }))
                        }
                      />
                    </label>
                    <label>
                      Date
                      <input
                        type="date"
                        value={settlementForm.settled_at}
                        onChange={(event) =>
                          setSettlementForm((prev) => ({
                            ...prev,
                            settled_at: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Notes
                    <textarea
                      rows="2"
                      value={settlementForm.notes}
                      onChange={(event) =>
                        setSettlementForm((prev) => ({
                          ...prev,
                          notes: event.target.value
                        }))
                      }
                    />
                  </label>
                  <button type="submit" className="solid-btn" disabled={busy.createSettlement}>
                    {busy.createSettlement ? "Saving..." : "Record Settlement"}
                  </button>
                </form>
              </article>

              <article className="split-card">
                <h3>Governance</h3>
                {isOwner ? (
                  <>
                    <form className="stack-form split-form" onSubmit={saveSettings}>
                      <label className="toggle-row">
                        <span>Require owner approval for new entries</span>
                        <input
                          type="checkbox"
                          checked={settingsForm.require_approval}
                          onChange={(event) =>
                            setSettingsForm((prev) => ({
                              ...prev,
                              require_approval: event.target.checked
                            }))
                          }
                        />
                      </label>
                      <label>
                        Reminder Interval (days)
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={settingsForm.reminder_interval_days}
                          onChange={(event) =>
                            setSettingsForm((prev) => ({
                              ...prev,
                              reminder_interval_days: event.target.value
                            }))
                          }
                        />
                      </label>
                      <button type="submit" className="ghost-btn" disabled={busy.saveSettings}>
                        {busy.saveSettings ? "Saving..." : "Save Governance"}
                      </button>
                    </form>

                    <h4>Invite Studio</h4>
                    <form className="stack-form split-form" onSubmit={createInvite}>
                      <div className="mini-grid">
                        <label>
                          Expires In (hours)
                          <input
                            type="number"
                            min="1"
                            max="720"
                            value={inviteForm.expires_in_hours}
                            onChange={(event) =>
                              setInviteForm((prev) => ({
                                ...prev,
                                expires_in_hours: event.target.value
                              }))
                            }
                          />
                        </label>
                        <label>
                          Max Uses
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            value={inviteForm.max_uses}
                            onChange={(event) =>
                              setInviteForm((prev) => ({
                                ...prev,
                                max_uses: event.target.value
                              }))
                            }
                          />
                        </label>
                      </div>
                      <button type="submit" className="solid-btn" disabled={busy.createInvite}>
                        {busy.createInvite ? "Generating..." : "Generate Invite"}
                      </button>
                    </form>

                    <ul className="invite-list">
                      {invites.slice(0, 6).map((invite) => (
                        <li key={invite.id}>
                          <div>
                            <p>{invite.invite_code}</p>
                            <small>
                              Uses {invite.used_count}/{invite.max_uses} · Expires{" "}
                              {formatDate(invite.expires_at)}
                            </small>
                          </div>
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => revokeInvite(invite.id)}
                            disabled={busy.revokeInviteId === invite.id || !invite.is_active}
                          >
                            {busy.revokeInviteId === invite.id
                              ? "Revoking..."
                              : invite.is_active
                                ? "Revoke"
                                : "Closed"}
                          </button>
                        </li>
                      ))}
                      {invites.length === 0 && <li className="muted">No invites generated yet.</li>}
                    </ul>
                  </>
                ) : (
                  <p className="muted">Only group owner can configure approvals and invite links.</p>
                )}
              </article>

              <article className="split-card">
                <h3>Approval Queue</h3>
                <ul className="approval-list">
                  {approvalQueue.slice(0, 12).map((item) => {
                    const actionKey = `${item.entity_type}-${item.entity_id}`;
                    return (
                      <li key={actionKey}>
                        <div>
                          <p>
                            <span className={`pill ${item.entity_type}`}>{item.entity_type}</span>{" "}
                            {item.headline}
                          </p>
                          <small>
                            {item.created_by_name || "Unknown"} · {formatDate(item.activity_date)}
                          </small>
                        </div>
                        <div className="approval-actions">
                          <strong>{INR.format(toNumber(item.amount))}</strong>
                          {isOwner && (
                            <div className="inline-actions">
                              <button
                                type="button"
                                className="ghost-btn"
                                onClick={() => decideApproval(item, "approved")}
                                disabled={busy.decideApprovalId === actionKey}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="danger-btn"
                                onClick={() => decideApproval(item, "rejected")}
                                disabled={busy.decideApprovalId === actionKey}
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {approvalQueue.length === 0 && <li className="muted">No pending approvals.</li>}
                </ul>
              </article>

              <article className="split-card">
                <h3>Reminder Engine</h3>
                <ul className="reminder-list">
                  {reminders.slice(0, 12).map((item, index) => (
                    <li key={`${item.from_member_id}-${item.to_member_id}-${index}`}>
                      <div>
                        <p>{item.message}</p>
                        <small>Schedule: {item.schedule_date || "--"}</small>
                      </div>
                      <span className={`status-chip ${item.urgency}`}>{item.urgency}</span>
                    </li>
                  ))}
                  {reminders.length === 0 && <li className="muted">No reminders needed.</li>}
                </ul>
              </article>

              <article className="split-card">
                <h3>Balance Board</h3>
                <ul className="balance-board">
                  {(balances?.members || []).map((member) => (
                    <li key={member.member_id}>
                      <div>
                        <p>{member.display_name}</p>
                        <small>
                          Paid {INR.format(toNumber(member.paid_total))} · Share{" "}
                          {INR.format(toNumber(member.owe_total))}
                        </small>
                      </div>
                      <strong className={netTone(toNumber(member.net_balance))}>
                        {INR.format(toNumber(member.net_balance))}
                      </strong>
                    </li>
                  ))}
                </ul>
                <h4>Optimal Settlement Plan</h4>
                <ul className="plan-list">
                  {(balances?.simplified_settlements || []).map((item, index) => (
                    <li key={`${item.from_member_id}-${item.to_member_id}-${index}`}>
                      <span>{item.from_name}</span>
                      <span>pays</span>
                      <span>{item.to_name}</span>
                      <strong>{INR.format(toNumber(item.amount))}</strong>
                    </li>
                  ))}
                  {(balances?.simplified_settlements || []).length === 0 && (
                    <li className="muted">Group is already settled.</li>
                  )}
                </ul>
              </article>

              <article className="split-card">
                <h3>Activity Timeline</h3>
                <ul className="timeline-list">
                  {activity.map((item) => (
                    <li key={`${item.activity_type}-${item.id}`}>
                      <div>
                        <p>
                          <span className={`pill ${item.activity_type}`}>
                            {item.activity_type}
                          </span>{" "}
                          {item.headline}
                        </p>
                        <small>
                          {item.actor_name}
                          {item.counterparty_name ? ` -> ${item.counterparty_name}` : ""} ·{" "}
                          {formatDate(item.activity_date)}
                        </small>
                      </div>
                      <strong>{INR.format(toNumber(item.amount))}</strong>
                    </li>
                  ))}
                  {!activity.length && <li className="muted">No group activity yet.</li>}
                </ul>
              </article>

              <article className="split-card">
                <h3>Correction Zone</h3>
                <div className="history-columns">
                  <div>
                    <h4>Expenses</h4>
                    <ul className="history-list">
                      {expenses.slice(0, 12).map((item) => (
                        <li key={item.id}>
                          <div>
                            <p>{item.title}</p>
                            <small>
                              {item.paid_by_name} · {formatDate(item.expense_date)} ·{" "}
                              <span className={`status-chip ${item.approval_status || "approved"}`}>
                                {item.approval_status || "approved"}
                              </span>
                            </small>
                          </div>
                          <div className="history-actions">
                            <strong>{INR.format(toNumber(item.amount))}</strong>
                            <button
                              type="button"
                              className="danger-btn"
                              onClick={() => deleteExpense(item.id)}
                              disabled={busy.deleteExpenseId === item.id}
                            >
                              {busy.deleteExpenseId === item.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4>Settlements</h4>
                    <ul className="history-list">
                      {settlements.slice(0, 12).map((item) => (
                        <li key={item.id}>
                          <div>
                            <p>{`${item.from_name} -> ${item.to_name}`}</p>
                            <small>
                              {formatDate(item.settled_at)} ·{" "}
                              <span className={`status-chip ${item.approval_status || "approved"}`}>
                                {item.approval_status || "approved"}
                              </span>
                            </small>
                          </div>
                          <div className="history-actions">
                            <strong>{INR.format(toNumber(item.amount))}</strong>
                            <button
                              type="button"
                              className="danger-btn"
                              onClick={() => deleteSettlement(item.id)}
                              disabled={busy.deleteSettlementId === item.id}
                            >
                              {busy.deleteSettlementId === item.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            </section>
          </>
        )}

        {busy.workspace && <p className="muted">Refreshing group workspace...</p>}
      </div>
    </section>
  );
}

export default SplitwiseTab;
