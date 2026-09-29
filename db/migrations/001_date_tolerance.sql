-- ============================================================
-- Migration 001: date tolerance (v2)
-- Run this ONCE on an existing Supabase database that was created with
-- the original schema (before days_diff / note existed).
--
-- New setups do NOT need this - db/schema.sql already includes both
-- columns. Safe to run more than once thanks to "if not exists".
-- ============================================================

alter table public.reconciliation_issues
    add column if not exists days_diff integer;

alter table public.reconciliation_issues
    add column if not exists note text;
