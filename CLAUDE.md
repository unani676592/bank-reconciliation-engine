# Bank Reconciliation Engine (Phase 3)

## What this is
A serverless API that compares transactions from Bank A, Bank B and a company ledger and flags mismatches. Phases 1 and 2 were built in n8n. This phase moves the logic into Node.js code with tests, a database and a GitHub repo.

## Sample data (in test/fixtures/)
- bank_a.csv, bank_b.csv, ledger.csv: sample data used by the tests.
- answer_key.md: the 10 planted problems. Tests must find all 10.
- The original n8n code (reconcile.js) and its copies live in /reference, which
  is git-ignored and not part of the published repo. Keep the same behavior as
  reconcile.js.

## Rules
- Node.js 18+, CommonJS, no npm dependencies unless I approve.
- Only use fields tx_id, date, party_name, amount, description. Drop all others (account numbers, IFSC, balances).
- If a required column is missing, stop with a clear error. Never guess.
- Column renames go in config/column-aliases.json only.
- Never put secrets in code. Use environment variables and a git-ignored .env file.
- Hosting: Vercel serverless function at api/reconcile.js. Database: Supabase (PostgreSQL) via its REST API.
- Explain changes to me in plain English. Ask before running git push or deploy commands.