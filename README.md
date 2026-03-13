# LedgerForge

LedgerForge is a full-stack personal finance ledger for tracking money with friends:
- Expenses and lending
- Settlements and outstanding balances
- Transaction analytics
- Recurring transaction automation
- Smart natural-language quick entry
- CSV reporting
- Event-sourced transaction audit replay
- Statement reconciliation assistant
- Runtime observability + SLO status
- Splitwise-style group expense module (trips/restaurants)

## Tech Stack
- Backend: Node.js, Express, PostgreSQL, raw SQL
- Frontend: React, Vite
- Data access: `pg` (no ORM)

## Folder Structure
```text
LedgerForge
├─ backend
│  ├─ src
│  │  ├─ config
│  │  ├─ controllers
│  │  ├─ routes
│  │  └─ utils
│  ├─ sql
│  │  └─ 001_schema.sql
│  ├─ server.js
│  └─ package.json
└─ frontend
   └─ ledgerforge
      ├─ src
      ├─ .env.example
      └─ package.json
```

## Core Features
- User and friend management with UUID-based ownership checks
- Ledger transactions (`expense`, `lend`, `debt`, `settlement`)
- Safe transaction deletion for wrong entries
- Dedicated friend deletion flow (guarded: blocked if friend has transaction history)
- Derived balances (not stored) with SQL aggregation
- Dashboard KPIs: receivable, payable, net position, transaction count
- Debt reminder center with urgency scoring (`collect` / `pay`)
- Filtered and paginated transaction history
- Event log for immutable transaction lifecycle (`created`, `deleted`) and replay verification
- Analytics:
  - Monthly net trend
  - Top friend exposure
  - Activity by transaction type
- Recurring rules:
  - Weekly/monthly schedules
  - Auto-generation of overdue cycles
- Smart input parser:
  - Converts free-text like `gave vijay 2k for food` or `took 3k from sujith` into structured transaction intents
  - Supports ambiguity handling with multiple interpretations (auto-pick on high confidence, ask user on conflict)
  - Detects amount shorthands (`2k`, `1.5 lakh`, `₹3,200`) and settlement direction (`from_friend`, `to_friend`)
- Reconciliation assistant:
  - CSV preview suggestions for statement rows
  - Match existing transaction / create missing transaction decisions
  - Persistent import history
- Observability:
  - In-memory request metrics (latency, route volume, status classes)
  - SLO status endpoint (availability + p95 latency + DB ping)
- CSV report export with server-side filtering
- Splitwise-style group ledger:
  - Group creation + member management
  - Expense splits (`equal`, `exact`, `percentage`)
  - Inter-member settlements
  - Per-member net balance + debt simplification suggestions
  - Activity timeline + delete corrections for expenses/settlements
  - Invite-link onboarding with expiring/multi-use invite codes
  - Approval workflow (`pending`, `approved`, `rejected`) for expenses/settlements
  - Configurable reminder engine for follow-up nudges

### Dashboard UX Features
- Smart friend search in Friend Workspace (supports partials/subsequence matching)
- Smart friend search in Transaction Composer with suggestion chips
- Dedicated `Delete Friend` tab with safe-delete messaging
- Debt reminder cards with copy-ready reminder text

## Setup

### 1) Backend
```bash
cd backend
npm install
copy .env.example .env
```

Create schema:
```bash
psql -U postgres -d ledgerforge -f sql/001_schema.sql
```

Run API:
```bash
npm run dev
```

Backend URL: `http://localhost:5000`

Run migrations quickly:
```bash
npm run db:migrate
```

### 2) Frontend
```bash
cd frontend/ledgerforge
npm install
copy .env.example .env
npm run dev
```

Frontend URL: `http://localhost:5173`

## API Overview

### Users
- `POST /users`
- `GET /users`

### Friends
- `POST /friends`
- `GET /friends/:user_id`
- `PATCH /friends/:friend_id`
- `DELETE /friends/:friend_id?user_id=<uuid>`

### Transactions
- `POST /transactions` (supports `settlement_direction=from_friend|to_friend` when `type=settlement`)
- `POST /transactions/parse` (supports `user_id` for friend matching; returns interpretations + confidence)
- `DELETE /transactions/:transaction_id?user_id=<uuid>`
- `GET /transactions/user/:user_id` with query filters: `friend_id`, `type`, `from`, `to`, `page`, `limit`
- `GET /transactions/stats/:user_id`
- `GET /transactions/friend/:friend_id`
- Legacy compatibility: `GET /transactions/:friend_id`

### Settlements
- `POST /settlements`

### Balances
- `GET /balances/:user_id`
- `GET /balances/summary/:user_id`
- `GET /balances/reminders/:user_id?min_amount=1&direction=all|collect|pay&limit=8`

### Analytics
- `GET /analytics/:user_id?months=6`

### Recurring
- `POST /recurring`
- `GET /recurring/:user_id`
- `PATCH /recurring/:rule_id`
- `POST /recurring/run/:user_id`

### Reports
- `GET /reports/:user_id.csv`

### Ledger Replay / Event Audit
- `GET /ledger/events/:user_id`
- `GET /ledger/replay/:user_id`
- `POST /ledger/backfill/:user_id`

### Reconciliation
- `POST /reconciliation/preview`
- `POST /reconciliation/commit`
- `GET /reconciliation/imports/:user_id`

### Observability
- `GET /observability/metrics`
- `GET /observability/slo`

### Splitwise Groups
- `POST /groups`
- `GET /groups/user/:user_id`
- `GET /groups/:group_id?user_id=<uuid>`
- `PATCH /groups/:group_id`
- `DELETE /groups/:group_id?user_id=<uuid>`
- `PATCH /groups/:group_id/settings`
- `GET /groups/:group_id/members?user_id=<uuid>`
- `POST /groups/:group_id/members`
- `DELETE /groups/:group_id/members/:member_id?user_id=<uuid>`
- `GET /groups/:group_id/activity?user_id=<uuid>`
- `GET /groups/:group_id/approvals?user_id=<uuid>`
- `POST /groups/:group_id/approvals/:entity_type/:entity_id`
- `GET /groups/:group_id/reminders?user_id=<uuid>`

### Group Invites
- `POST /groups/:group_id/invites`
- `GET /groups/:group_id/invites?user_id=<uuid>`
- `DELETE /groups/:group_id/invites/:invite_id?user_id=<uuid>`
- `POST /groups/invites/:invite_code/accept`

### Group Expenses
- `POST /group-expenses`
- `GET /group-expenses/group/:group_id?user_id=<uuid>`
- `DELETE /group-expenses/:expense_id?user_id=<uuid>`

### Group Settlements
- `POST /group-settlements`
- `GET /group-settlements/group/:group_id?user_id=<uuid>`
- `DELETE /group-settlements/:settlement_id?user_id=<uuid>`

### Group Balances
- `GET /group-balances/:group_id?user_id=<uuid>`
- `GET /group-balances/:group_id/settlement-plan?user_id=<uuid>`

## Example SQL Logic (Balance Derivation)
```sql
SUM(
  CASE
    WHEN type IN ('expense', 'lend') THEN amount
    WHEN type = 'debt' THEN -amount
    WHEN type = 'settlement' AND settlement_direction = 'to_friend' THEN amount
    WHEN type = 'settlement' THEN -amount
    ELSE 0
  END
)
```

## Recruiter-Grade Highlights
Use these as resume bullets (customize with your own metrics):

1. Designed and implemented a production-style personal finance ledger with Node.js, Express, React, and PostgreSQL using raw SQL (no ORM).
2. Built analytical SQL endpoints (monthly trends, exposure ranking, type-wise activity) and optimized with targeted indexes.
3. Implemented recurring transaction automation with catch-up generation logic and transactional consistency.
4. Added smart natural-language parsing API for rapid transaction entry and improved UX velocity.
5. Developed filterable and paginated reporting APIs plus downloadable CSV export pipeline.
6. Added event-sourced transaction audit trail + replay engine to verify ledger correctness against live balances.
7. Built a reconciliation assistant that previews statement matches and commits create/match/ignore decisions.
8. Implemented observability layer with SLO endpoints (availability, latency, DB ping) for production-style monitoring.
9. Enforced data integrity through UUID validation, ownership checks, input normalization, and safe parameterized queries.
10. Built Splitwise-like group expense engine with exact/equal/percentage split computation, settlement planning, and correction-safe deletion endpoints.

## Notes
- Existing Postman flow remains compatible.
- If recurring endpoints fail on existing DB, re-run `sql/001_schema.sql` to create missing tables/indexes.
