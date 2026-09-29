// ============================================================
// Multi-Bank Reconciliation - core logic (Phase 3, v2: date tolerance)
// Ported from the n8n Code node in /reference/reconcile_v2.js.
//
// This module exports a PURE function:
//   reconcile({ bank_a, bank_b, ledger }, settingsOverride?) -> results[]
// Each source argument is an array of raw row objects (parsed from JSON
// or CSV). No I/O happens beyond reading the config files.
//
// WHAT COUNTS AS A PROBLEM ROW
//   Error    amount mismatch, missing in ledger, missing in bank, duplicate
//   Warning  date gap bigger than the bank's window, name mismatch
//   Matched  everything agrees, or the date gap is within the window
//            (a note like "posted 2 days late" is added)
// A row with several issues gets the most serious severity.
// ============================================================

const fs = require('fs');
const path = require('path');

// SECURITY: only these fields are ever used. Anything else
// (account numbers, IFSC, balances) is dropped right here.
const ALLOWED = ['tx_id', 'date', 'party_name', 'amount', 'description'];
const REQUIRED = ['tx_id', 'date', 'party_name', 'amount', 'description'];

// Fallback if config/reconciliation.json is missing or invalid.
const DEFAULT_DATE_TOLERANCE_DAYS = 3;

// ---------- config loading ----------
function readJsonObject(relPath) {
  const file = path.join(__dirname, '..', relPath);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    throw new Error(`${relPath} must be a JSON object`);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Could not read ${relPath}: ${err.message}`);
  }
}

// COLUMN ALIASES live in config/column-aliases.json ONLY.
function loadAliases() {
  return readJsonObject(path.join('config', 'column-aliases.json')) || {};
}

// Date-tolerance settings live in config/reconciliation.json.
//   DATE_TOLERANCE_DAYS  normal posting lag treated as Matched (with a note)
//   BANK_DATE_TOLERANCE  optional per-bank windows, e.g. { "Bank B": 5 }
function loadSettings() {
  const s = readJsonObject(path.join('config', 'reconciliation.json')) || {};
  const days = Number(s.DATE_TOLERANCE_DAYS);
  return {
    DATE_TOLERANCE_DAYS: Number.isFinite(days) && days >= 0 ? days : DEFAULT_DATE_TOLERANCE_DAYS,
    BANK_DATE_TOLERANCE:
      s.BANK_DATE_TOLERANCE && typeof s.BANK_DATE_TOLERANCE === 'object' && !Array.isArray(s.BANK_DATE_TOLERANCE)
        ? s.BANK_DATE_TOLERANCE
        : {},
  };
}

function applyAliases(row, aliases) {
  const out = { ...row };
  for (const [from, to] of Object.entries(aliases)) {
    if (from in out && !(to in out)) out[to] = out[from];
  }
  return out;
}

// ---------- helpers ----------
function clean(row) {
  const out = {};
  for (const key of ALLOWED) out[key] = row[key];
  out.tx_id = String(out.tx_id || '').trim();
  out.amount = toNumber(out.amount);
  out.date = toDate(out.date);
  out.party_name = String(out.party_name || '').trim();
  out.description = String(out.description || '').trim();
  return out;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  return parseFloat(String(v || '0').replace(/,/g, '').trim());
}

function toDate(v) {
  // A date can arrive as text ("2026-09-01") or as a serial number (46266).
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return String(v || '').trim().slice(0, 10);
}

function normalizeName(n) {
  return String(n || '').toLowerCase()
    .replace(/private limited/g, 'pvt ltd')
    .replace(/limited/g, 'ltd')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Signed gap in whole days: positive when the bank posted AFTER the ledger.
function signedDays(bankDate, ledgerDate) {
  return Math.round((new Date(bankDate) - new Date(ledgerDate)) / 86400000);
}

// The tolerance window for a given bank (falls back to the global default).
function toleranceFor(bankName, settings) {
  const t = settings.BANK_DATE_TOLERANCE[bankName];
  return typeof t === 'number' && t >= 0 ? t : settings.DATE_TOLERANCE_DAYS;
}

function groupById(rows) {
  const map = {};
  for (const r of rows) {
    if (!r.tx_id) continue;
    (map[r.tx_id] = map[r.tx_id] || []).push(r);
  }
  return map;
}

// ---------- safety check: stop if a source is missing columns ----------
// Empty sources are allowed (a bank can legitimately have no transactions).
function checkColumns(sourceName, rows, aliases) {
  if (!Array.isArray(rows)) {
    throw new Error(`${sourceName} must be an array of rows`);
  }
  if (rows.length === 0) return;
  const firstRow = applyAliases(rows[0] || {}, aliases);
  const missing = REQUIRED.filter(col => !(col in firstRow));
  if (missing.length > 0) {
    throw new Error(
      `${sourceName} is missing required column(s) ${missing.join(', ')} - ` +
      `columns found are ${Object.keys(firstRow).join(', ')}`
    );
  }
}

// ---------- main entry point ----------
// `settingsOverride` (optional) lets callers/tests supply date-tolerance
// settings directly; when omitted they are read from config/reconciliation.json.
const RANK = { OK: 0, Warning: 1, Error: 2 };

function reconcile({ bank_a = [], bank_b = [], ledger = [] } = {}, settingsOverride) {
  const aliases = loadAliases();
  const settings = settingsOverride ? normalizeSettings(settingsOverride) : loadSettings();

  checkColumns('Bank A', bank_a, aliases);
  checkColumns('Bank B', bank_b, aliases);
  checkColumns('Ledger', ledger, aliases);

  const bankA = bank_a.map(r => ({ ...clean(applyAliases(r, aliases)), source: 'Bank A' }));
  const bankB = bank_b.map(r => ({ ...clean(applyAliases(r, aliases)), source: 'Bank B' }));
  const led = ledger.map(r => clean(applyAliases(r, aliases)));

  const bankById = groupById([...bankA, ...bankB]);
  const ledgerById = groupById(led);
  const allIds = [...new Set([...Object.keys(bankById), ...Object.keys(ledgerById)])].sort();

  const results = [];

  for (const id of allIds) {
    const bankRows = bankById[id] || [];
    const ledgerRows = ledgerById[id] || [];
    const bank = bankRows[0];
    const ledRow = ledgerRows[0];
    const issues = [];
    let severity = 'OK';
    let note = '';
    let daysDiff = '';
    const raise = level => { if (RANK[level] > RANK[severity]) severity = level; };

    // Errors
    if (bankRows.length > 1) { issues.push(`Duplicate in ${bank.source} (x${bankRows.length})`); raise('Error'); }
    if (ledgerRows.length > 1) { issues.push(`Duplicate in Ledger (x${ledgerRows.length})`); raise('Error'); }

    if (bank && !ledRow) { issues.push('Missing in Ledger'); raise('Error'); }
    else if (!bank && ledRow) { issues.push('Missing in Bank'); raise('Error'); }
    else {
      if (bank.amount !== ledRow.amount) {
        issues.push(`Amount Mismatch (diff ${(bank.amount - ledRow.amount).toFixed(2)})`);
        raise('Error');
      }

      // Warnings
      if (normalizeName(bank.party_name) !== normalizeName(ledRow.party_name)) {
        issues.push('Name Mismatch');
        raise('Warning');
      }

      // Date: within the bank's window is fine (Matched + note), outside is a Warning.
      if (bank.date !== ledRow.date) {
        const gap = signedDays(bank.date, ledRow.date);
        const abs = Math.abs(gap);
        const window = toleranceFor(bank.source, settings);
        daysDiff = abs;
        const plural = abs === 1 ? 'day' : 'days';
        const direction = gap > 0 ? 'late' : 'early';
        if (abs <= window) {
          note = `posted ${abs} ${plural} ${direction}`;
        } else {
          issues.push(`Date Mismatch (${abs} ${plural}, window ${window})`);
          raise('Warning');
        }
      } else {
        daysDiff = 0;
      }
    }

    results.push({
      tx_id: id,
      status: issues.length ? issues.join(' + ') : 'Matched',
      severity,
      days_diff: daysDiff,
      note,
      bank: bank ? bank.source : '',
      bank_date: bank ? bank.date : '',
      ledger_date: ledRow ? ledRow.date : '',
      bank_party: bank ? bank.party_name : '',
      ledger_party: ledRow ? ledRow.party_name : '',
      bank_amount: bank ? bank.amount : '',
      ledger_amount: ledRow ? ledRow.amount : '',
      description: (bank || ledRow).description,
    });
  }

  // Problems first (Error, then Warning, then Matched), ties broken by tx_id.
  results.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.tx_id.localeCompare(b.tx_id));

  return results;
}

// Normalize a caller-supplied settings object the same way loadSettings does.
function normalizeSettings(s) {
  const days = Number(s.DATE_TOLERANCE_DAYS);
  return {
    DATE_TOLERANCE_DAYS: Number.isFinite(days) && days >= 0 ? days : DEFAULT_DATE_TOLERANCE_DAYS,
    BANK_DATE_TOLERANCE:
      s.BANK_DATE_TOLERANCE && typeof s.BANK_DATE_TOLERANCE === 'object' && !Array.isArray(s.BANK_DATE_TOLERANCE)
        ? s.BANK_DATE_TOLERANCE
        : {},
  };
}

// ---------- operator notes ----------
// Non-fatal hints for the caller. An empty source is allowed, but it is
// usually a sign the file was not loaded, so we say so explicitly.
function buildNotes({ bank_a = [], bank_b = [], ledger = [] } = {}) {
  const notes = [];
  const check = (name, arr) => {
    if (!Array.isArray(arr) || arr.length === 0) {
      notes.push(`${name} has 0 rows - check the file was loaded correctly`);
    }
  };
  check('Bank A', bank_a);
  check('Bank B', bank_b);
  check('Ledger', ledger);
  return notes;
}

module.exports = {
  reconcile,
  buildNotes,
  loadSettings,
  // exported for unit tests
  _internals: { clean, toNumber, toDate, normalizeName, signedDays, toleranceFor, groupById, applyAliases, checkColumns, loadAliases },
  ALLOWED,
  REQUIRED,
  DEFAULT_DATE_TOLERANCE_DAYS,
};
