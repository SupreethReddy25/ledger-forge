# LedgerForge

LedgerForge is a full-stack personal finance ledger for tracking money with friends:
- Expenses and lending
- Settlements and outstanding balances
- Transaction analytics
- Recurring transaction automation
- Smart natural-language quick entry
- CSV reporting

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
- Ledger transactions (`expense`, `lend`, `settlement`)
- Derived balances (not stored) with SQL aggregation
- Dashboard KPIs: receivable, payable, net position, transaction count
- Filtered and paginated transaction history
- Analytics:
  - Monthly net trend
  - Top friend exposure
  - Activity by transaction type
- Recurring rules:
  - Weekly/monthly schedules
  - Auto-generation of overdue cycles
- Smart input parser:
  - Converts natural language like `paid 650 to Rahul for dinner` into structured transaction hints
- CSV report export with server-side filtering

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
- `POST /transactions`
- `POST /transactions/parse`
- `GET /transactions/user/:user_id` with query filters: `friend_id`, `type`, `from`, `to`, `page`, `limit`
- `GET /transactions/stats/:user_id`
- `GET /transactions/friend/:friend_id`
- Legacy compatibility: `GET /transactions/:friend_id`

### Settlements
- `POST /settlements`

### Balances
- `GET /balances/:user_id`
- `GET /balances/summary/:user_id`

### Analytics
- `GET /analytics/:user_id?months=6`

### Recurring
- `POST /recurring`
- `GET /recurring/:user_id`
- `PATCH /recurring/:rule_id`
- `POST /recurring/run/:user_id`

### Reports
- `GET /reports/:user_id.csv`

## Example SQL Logic (Balance Derivation)
```sql
SUM(
  CASE
    WHEN type IN ('expense', 'lend') THEN amount
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
6. Enforced data integrity through UUID validation, ownership checks, input normalization, and safe parameterized queries.

## Notes
- Existing Postman flow remains compatible.
- If recurring endpoints fail on existing DB, re-run `sql/001_schema.sql` to create missing tables/indexes.
