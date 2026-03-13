-- LedgerForge schema bootstrap
-- Safe to run multiple times (uses IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('expense', 'lend', 'debt', 'settlement')),
  settlement_direction VARCHAR(20) NOT NULL DEFAULT 'from_friend'
    CHECK (settlement_direction IN ('from_friend', 'to_friend')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS settlement_direction VARCHAR(20) NOT NULL DEFAULT 'from_friend';

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_transactions_type;

ALTER TABLE transactions
  ADD CONSTRAINT chk_transactions_type
  CHECK (type IN ('expense', 'lend', 'debt', 'settlement'));

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_settlement_direction_check;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_transactions_settlement_direction;

ALTER TABLE transactions
  ADD CONSTRAINT chk_transactions_settlement_direction
  CHECK (settlement_direction IN ('from_friend', 'to_friend'));

CREATE TABLE IF NOT EXISTS recurring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('expense', 'lend', 'debt', 'settlement')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  description TEXT,
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  next_due_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE recurring_rules
  DROP CONSTRAINT IF EXISTS recurring_rules_type_check;

ALTER TABLE recurring_rules
  DROP CONSTRAINT IF EXISTS chk_recurring_rules_type;

ALTER TABLE recurring_rules
  ADD CONSTRAINT chk_recurring_rules_type
  CHECK (type IN ('expense', 'lend', 'debt', 'settlement'));

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  require_approval BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_interval_days INTEGER NOT NULL DEFAULT 3 CHECK (reminder_interval_days BETWEEN 1 AND 30),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS require_approval BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS reminder_interval_days INTEGER NOT NULL DEFAULT 3;

ALTER TABLE groups
  DROP CONSTRAINT IF EXISTS chk_groups_reminder_interval_days;

ALTER TABLE groups
  ADD CONSTRAINT chk_groups_reminder_interval_days
  CHECK (reminder_interval_days BETWEEN 1 AND 30);

CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_type VARCHAR(20) NOT NULL CHECK (member_type IN ('user', 'friend')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES friends(id) ON DELETE CASCADE,
  display_name VARCHAR(160) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_group_member_identity CHECK (
    (member_type = 'user' AND user_id IS NOT NULL AND friend_id IS NULL)
    OR
    (member_type = 'friend' AND friend_id IS NOT NULL AND user_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_members_user
  ON group_members(group_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_members_friend
  ON group_members(group_id, friend_id)
  WHERE friend_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS group_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  paid_by_member_id UUID NOT NULL REFERENCES group_members(id) ON DELETE RESTRICT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(220) NOT NULL,
  notes TEXT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  split_method VARCHAR(20) NOT NULL CHECK (split_method IN ('equal', 'exact', 'percentage')),
  approval_status VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approval_note TEXT,
  approved_by_member_id UUID REFERENCES group_members(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE group_expenses
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE group_expenses
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved';

ALTER TABLE group_expenses
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

ALTER TABLE group_expenses
  ADD COLUMN IF NOT EXISTS approved_by_member_id UUID REFERENCES group_members(id) ON DELETE SET NULL;

ALTER TABLE group_expenses
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

ALTER TABLE group_expenses
  DROP CONSTRAINT IF EXISTS chk_group_expenses_approval_status;

ALTER TABLE group_expenses
  ADD CONSTRAINT chk_group_expenses_approval_status
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));

CREATE TABLE IF NOT EXISTS group_expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES group_members(id) ON DELETE RESTRICT,
  share_amount NUMERIC(12, 2) NOT NULL CHECK (share_amount >= 0),
  share_percent NUMERIC(6, 2) CHECK (share_percent IS NULL OR (share_percent >= 0 AND share_percent <= 100))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_expense_member
  ON group_expense_splits(expense_id, member_id);

CREATE TABLE IF NOT EXISTS group_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_member_id UUID NOT NULL REFERENCES group_members(id) ON DELETE RESTRICT,
  to_member_id UUID NOT NULL REFERENCES group_members(id) ON DELETE RESTRICT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  notes TEXT,
  approval_status VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approval_note TEXT,
  approved_by_member_id UUID REFERENCES group_members(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  settled_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_group_settlement_distinct CHECK (from_member_id <> to_member_id)
);

ALTER TABLE group_settlements
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE group_settlements
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved';

ALTER TABLE group_settlements
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

ALTER TABLE group_settlements
  ADD COLUMN IF NOT EXISTS approved_by_member_id UUID REFERENCES group_members(id) ON DELETE SET NULL;

ALTER TABLE group_settlements
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

ALTER TABLE group_settlements
  DROP CONSTRAINT IF EXISTS chk_group_settlements_approval_status;

ALTER TABLE group_settlements
  ADD CONSTRAINT chk_group_settlements_approval_status
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));

CREATE TABLE IF NOT EXISTS group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code VARCHAR(80) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 20 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  aggregate_type VARCHAR(40) NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor VARCHAR(80) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_name VARCHAR(180) NOT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT NOW(),
  total_rows INTEGER NOT NULL DEFAULT 0,
  matched_rows INTEGER NOT NULL DEFAULT 0,
  created_rows INTEGER NOT NULL DEFAULT 0,
  ignored_rows INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS statement_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES statement_imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  entry_date DATE,
  amount NUMERIC(12, 2) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  suggested_friend_id UUID REFERENCES friends(id) ON DELETE SET NULL,
  suggested_type VARCHAR(20) CHECK (suggested_type IN ('expense', 'lend', 'debt', 'settlement')),
  matched_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  confidence_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  resolution_action VARCHAR(20) NOT NULL DEFAULT 'pending',
  resolution_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP
);

ALTER TABLE statement_entries
  DROP CONSTRAINT IF EXISTS statement_entries_suggested_type_check;

ALTER TABLE statement_entries
  DROP CONSTRAINT IF EXISTS chk_statement_entries_suggested_type;

ALTER TABLE statement_entries
  ADD CONSTRAINT chk_statement_entries_suggested_type
  CHECK (
    suggested_type IS NULL
    OR suggested_type IN ('expense', 'lend', 'debt', 'settlement')
  );

CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_friend_id ON transactions(friend_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recurring_user_active_due
  ON recurring_rules(user_id, active, next_due_date);
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_expenses_group_date
  ON group_expenses(group_id, expense_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_settlements_group_date
  ON group_settlements(group_id, settled_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_expenses_group_approval
  ON group_expenses(group_id, approval_status, expense_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_settlements_group_approval
  ON group_settlements(group_id, approval_status, settled_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_invites_group_created
  ON group_invites(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_invites_active
  ON group_invites(group_id, expires_at, used_count)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_events_user_time
  ON ledger_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_statement_imports_user_time
  ON statement_imports(user_id, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_statement_entries_import
  ON statement_entries(import_id, row_number);
