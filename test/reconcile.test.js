// ============================================================
// Tests for the reconciliation core logic (v2: date tolerance).
// Built-in node:test runner + node:assert. No npm dependencies.
// Run with:  npm test   (or: node --test)
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { reconcile, _internals } = require('../src/reconcile');
const { parseCsv } = require('../src/csv');

const FIXTURES = path.join(__dirname, 'fixtures');
function loadRef(name) {
  return parseCsv(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}
function sampleResults() {
  return reconcile({
    bank_a: loadRef('bank_a.csv'),
    bank_b: loadRef('bank_b.csv'),
    ledger: loadRef('ledger.csv'),
  });
}

// The 9 planted problems from fixtures/answer_key.md (v2 rules).
// TXB-2003 is NO LONGER a problem: its 1-day lag is within the tolerance window.
const EXPECTED_PROBLEMS = {
  'TXA-1007': { severity: 'Error', match: /Missing in Ledger/ },
  'TXB-2012': { severity: 'Error', match: /Missing in Ledger/ },
  'TXL-9001': { severity: 'Error', match: /Missing in Bank/ },
  'TXL-9002': { severity: 'Error', match: /Missing in Bank/ },
  'TXA-1004': { severity: 'Error', match: /Amount Mismatch/ },
  'TXB-2009': { severity: 'Error', match: /Amount Mismatch/ },
  'TXA-1011': { severity: 'Error', match: /Duplicate in Bank A/ },
  'TXB-2005': { severity: 'Error', match: /Duplicate in Ledger/ },
  'TXA-1006': { severity: 'Warning', match: /Name Mismatch/ },
};

test('catches all 9 planted problems from the sample data', () => {
  const byId = Object.fromEntries(sampleResults().map(r => [r.tx_id, r]));

  for (const [id, expected] of Object.entries(EXPECTED_PROBLEMS)) {
    const row = byId[id];
    assert.ok(row, `expected a result row for ${id}`);
    assert.equal(row.severity, expected.severity, `${id} severity`);
    assert.match(row.status, expected.match, `${id} status "${row.status}"`);
  }
});

test('every other row comes out as Matched', () => {
  const problemIds = new Set(Object.keys(EXPECTED_PROBLEMS));
  for (const row of sampleResults()) {
    if (problemIds.has(row.tx_id)) continue;
    assert.equal(row.severity, 'OK', `${row.tx_id} should be OK but was ${row.severity}`);
    assert.equal(row.status, 'Matched', `${row.tx_id} should be Matched but was "${row.status}"`);
  }
});

test('TXB-2003 is now Matched with "posted 1 day late" and days_diff 1', () => {
  const row = sampleResults().find(r => r.tx_id === 'TXB-2003');
  assert.ok(row);
  assert.equal(row.severity, 'OK');
  assert.equal(row.status, 'Matched');
  assert.equal(row.note, 'posted 1 day late');
  assert.equal(row.days_diff, 1);
});

test('exactly 9 problems and 23 matched (32 unique ids)', () => {
  const results = sampleResults();
  const problems = results.filter(r => r.severity !== 'OK');
  const matched = results.filter(r => r.severity === 'OK');
  assert.equal(results.length, 32, 'total unique tx_ids');
  assert.equal(problems.length, 9, 'problem rows');
  assert.equal(problems.filter(r => r.severity === 'Error').length, 8, 'errors');
  assert.equal(problems.filter(r => r.severity === 'Warning').length, 1, 'warnings');
  assert.equal(matched.length, 23, 'matched rows');
});

test('every result row has days_diff and note fields', () => {
  for (const row of sampleResults()) {
    assert.ok('days_diff' in row, `${row.tx_id} missing days_diff`);
    assert.ok('note' in row, `${row.tx_id} missing note`);
  }
});

test('results are sorted problems-first then by tx_id', () => {
  const results = sampleResults();
  const rank = { Error: 0, Warning: 1, OK: 2 };
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1];
    const cur = results[i];
    const bySeverity = rank[prev.severity] - rank[cur.severity];
    assert.ok(bySeverity <= 0, `severity order broken at ${cur.tx_id}`);
    if (bySeverity === 0) {
      assert.ok(prev.tx_id.localeCompare(cur.tx_id) <= 0, `tx_id order broken at ${cur.tx_id}`);
    }
  }
});

test('throws a clear error when a required column is missing', () => {
  const goodRow = { tx_id: 'X1', date: '2026-09-01', party_name: 'ACME', amount: '10', description: 'test' };
  const badLedger = [{ tx_id: 'X1', date: '2026-09-01', party_name: 'ACME', description: 'test' }];

  assert.throws(
    () => reconcile({ bank_a: [goodRow], bank_b: [], ledger: badLedger }),
    /Ledger is missing required column\(s\) amount/,
  );
});

test('empty sources are allowed (no false missing-column error)', () => {
  const results = reconcile({ bank_a: [], bank_b: [], ledger: [] });
  assert.deepEqual(results, []);
});

// ---------- date tolerance behavior ----------
const base = { tx_id: 'D1', party_name: 'ACME', amount: '100', description: 'x' };
function withDates(bankDate, ledgerDate, settings) {
  return reconcile({
    bank_a: [{ ...base, date: bankDate }],
    bank_b: [],
    ledger: [{ ...base, date: ledgerDate }],
  }, settings)[0];
}

test('1-day lag within window is Matched with a note', () => {
  const r = withDates('2026-09-03', '2026-09-02'); // bank after ledger
  assert.equal(r.severity, 'OK');
  assert.equal(r.status, 'Matched');
  assert.equal(r.note, 'posted 1 day late');
  assert.equal(r.days_diff, 1);
});

test('2-day lag within default window (3) is Matched', () => {
  const r = withDates('2026-09-04', '2026-09-02');
  assert.equal(r.severity, 'OK');
  assert.equal(r.status, 'Matched');
  assert.equal(r.note, 'posted 2 days late');
  assert.equal(r.days_diff, 2);
});

test('bank date before ledger date reads as "early"', () => {
  const r = withDates('2026-09-02', '2026-09-04');
  assert.equal(r.severity, 'OK');
  assert.equal(r.note, 'posted 2 days early');
  assert.equal(r.days_diff, 2);
});

test('6-day gap is a Warning with days_diff 6', () => {
  const r = withDates('2026-09-08', '2026-09-02'); // 6 days, window 3
  assert.equal(r.severity, 'Warning');
  assert.match(r.status, /Date Mismatch \(6 days, window 3\)/);
  assert.equal(r.days_diff, 6);
  assert.equal(r.note, '');
});

test('per-bank window: Bank B window 5 makes a 5-day gap Matched', () => {
  const settings = { DATE_TOLERANCE_DAYS: 3, BANK_DATE_TOLERANCE: { 'Bank B': 5 } };
  const r = reconcile({
    bank_a: [],
    bank_b: [{ ...base, date: '2026-09-07' }], // 5 days after ledger
    ledger: [{ ...base, date: '2026-09-02' }],
  }, settings)[0];
  assert.equal(r.severity, 'OK');
  assert.equal(r.status, 'Matched');
  assert.equal(r.note, 'posted 5 days late');
  assert.equal(r.days_diff, 5);

  // Same 5-day gap with the default window (3) would instead be a Warning.
  const dflt = reconcile({
    bank_a: [],
    bank_b: [{ ...base, date: '2026-09-07' }],
    ledger: [{ ...base, date: '2026-09-02' }],
  }, { DATE_TOLERANCE_DAYS: 3, BANK_DATE_TOLERANCE: {} })[0];
  assert.equal(dflt.severity, 'Warning');
  assert.match(dflt.status, /Date Mismatch \(5 days, window 3\)/);
});

// ---------- unit tests for helpers ----------
const { normalizeName, toNumber, toDate, signedDays } = _internals;

test('normalizeName folds company suffixes and punctuation', () => {
  assert.equal(normalizeName('Nexa Retail Private Limited'), 'nexa retail pvt ltd');
  assert.equal(normalizeName('Nexa Retail Pvt Ltd'), 'nexa retail pvt ltd');
  assert.equal(normalizeName('Sharma & Associates'), 'sharma associates');
  assert.equal(normalizeName('  ACME   Corp. '), 'acme corp');
});

test('toNumber strips commas and handles blanks', () => {
  assert.equal(toNumber('1,234.50'), 1234.5);
  assert.equal(toNumber(-5000), -5000);
  assert.equal(toNumber(''), 0);
  assert.equal(toNumber('  -12,570.00 '), -12570);
});

test('toDate handles text and serial numbers', () => {
  assert.equal(toDate('2026-09-01'), '2026-09-01');
  assert.equal(toDate('2026-09-01T10:00:00Z'), '2026-09-01');
  assert.equal(toDate(46266), '2026-09-01'); // serial for 2026-09-01
});

test('signedDays is positive when the bank posts after the ledger', () => {
  assert.equal(signedDays('2026-09-05', '2026-09-02'), 3);   // bank later -> +
  assert.equal(signedDays('2026-09-02', '2026-09-05'), -3);  // bank earlier -> -
  assert.equal(signedDays('2026-09-02', '2026-09-02'), 0);
});
