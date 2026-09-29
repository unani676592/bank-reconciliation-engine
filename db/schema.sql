-- ============================================================
-- Supabase schema for the Bank Reconciliation Engine.
-- Run this in the Supabase SQL editor (or psql) once.
--
-- Two tables:
--   reconciliation_issues  - one row per Error/Warning result (never Matched)
--   reconciliation_errors  - one row per failed/near-failed request
--
-- Row Level Security is ENABLED on both tables and NO policies are
-- created. With RLS on and no policy, the anon/public role cannot read
-- or write. The server uses the service_role key, which BYPASSES RLS,
-- so inserts from the API still work while the tables stay private.
-- ============================================================

-- ---------- reconciliation_issues ----------
create table if not exists public.reconciliation_issues (
    id            bigint generated always as identity primary key,
    run_id        uuid,
    tx_id         text not null,
    status        text not null,
    severity      text not null check (severity in ('Error', 'Warning')),
    days_diff     integer,
    note          text,
    bank          text,
    bank_date     date,
    ledger_date   date,
    bank_party    text,
    ledger_party  text,
    bank_amount   numeric,
    ledger_amount numeric,
    description   text,
    created_at    timestamptz not null default now()
);

create index if not exists idx_recon_issues_run_id on public.reconciliation_issues (run_id);
create index if not exists idx_recon_issues_tx_id  on public.reconciliation_issues (tx_id);

alter table public.reconciliation_issues enable row level security;

-- ---------- reconciliation_errors ----------
create table if not exists public.reconciliation_errors (
    id           bigint generated always as identity primary key,
    run_id       uuid,
    message      text not null,
    status_code  integer,
    context      text,
    created_at   timestamptz not null default now()
);

create index if not exists idx_recon_errors_created_at on public.reconciliation_errors (created_at);

alter table public.reconciliation_errors enable row level security;

-- No policies are defined on purpose: only the service_role key (used by
-- the server) can read/write. To let a dashboard read these tables, add a
-- SELECT policy for the appropriate role after review.
