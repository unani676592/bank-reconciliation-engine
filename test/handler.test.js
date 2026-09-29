// ============================================================
// Tests for the API handler: status codes and behavior.
// The handler is framework-agnostic, so we call it directly with a
// fake { method, headers, body } and a fake DB - no HTTP or Supabase.
// Run with:  npm test
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createReconcileHandler, MAX_ROWS } = require('../src/handler');
const { parseCsv } = require('../src/csv');

const API_KEY = 'test-key-123';
const FIXTURES = path.join(__dirname, 'fixtures');
const loadRef = name => parseCsv(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

// Fake DB that records what it was asked to save and can be told to fail.
function makeDb({ failSave = false } = {}) {
  const calls = { saved: [], errors: [] };
  return {
    calls,
    saveIssues: async (issues, meta) => {
      if (failSave) throw new Error('simulated db outage');
      calls.saved.push({ issues, meta });
    },
    logError: async record => { calls.errors.push(record); },
  };
}

function fullPayload() {
  return {
    bank_a: loadRef('bank_a.csv'),
    bank_b: loadRef('bank_b.csv'),
    ledger: loadRef('ledger.csv'),
  };
}

function post(handler, { key = API_KEY, body } = {}) {
  return handler({
    method: 'POST',
    headers: key === null ? {} : { 'x-api-key': key },
    body,
  });
}

test('200: valid request returns summary, notes, results and saves issues', async () => {
  const db = makeDb();
  const handler = createReconcileHandler({ apiKey: API_KEY, ...db });

  const res = await post(handler, { body: fullPayload() });

  assert.equal(res.status, 200);
  assert.equal(res.body.summary.total, 32);
  assert.equal(res.body.summary.error, 8);
  assert.equal(res.body.summary.warning, 1);
  assert.equal(res.body.summary.ok, 23);
  assert.equal(res.body.saved, true);
  assert.equal(res.body.notes.length, 0);
  assert.ok(res.body.run_id, 'has a run_id');

  // Only Error/Warning rows saved - never Matched.
  const saved = db.calls.saved[0].issues;
  assert.equal(saved.length, 9);
  assert.ok(saved.every(r => r.severity !== 'OK'), 'no matched rows saved');
});

test('200: empty source is allowed and produces a note', async () => {
  const db = makeDb();
  const handler = createReconcileHandler({ apiKey: API_KEY, ...db });

  const payload = fullPayload();
  payload.bank_b = [];
  const res = await post(handler, { body: payload });

  assert.equal(res.status, 200);
  assert.ok(
    res.body.notes.includes('Bank B has 0 rows - check the file was loaded correctly'),
    `notes were: ${JSON.stringify(res.body.notes)}`,
  );
});

test('200: db failure returns saved:false with a warning', async () => {
  const db = makeDb({ failSave: true });
  const handler = createReconcileHandler({ apiKey: API_KEY, ...db });

  const res = await post(handler, { body: fullPayload() });

  assert.equal(res.status, 200);
  assert.equal(res.body.saved, false);
  assert.match(res.body.warning, /could not be saved/i);
  // The failure was logged.
  assert.ok(db.calls.errors.some(e => e.context === 'saveIssues'));
});

test('200: accepts a raw JSON string body', async () => {
  const db = makeDb();
  const handler = createReconcileHandler({ apiKey: API_KEY, ...db });

  const res = await post(handler, { body: JSON.stringify(fullPayload()) });
  assert.equal(res.status, 200);
});

test('400: missing column returns a clear error and is logged', async () => {
  const db = makeDb();
  const handler = createReconcileHandler({ apiKey: API_KEY, ...db });

  const payload = fullPayload();
  // Drop "amount" from every ledger row.
  payload.ledger = payload.ledger.map(({ amount, ...rest }) => rest);

  const res = await post(handler, { body: payload });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Ledger is missing required column\(s\) amount/);
  assert.ok(db.calls.errors.some(e => e.status_code === 400));
});

test('400: body is not a JSON object', async () => {
  const handler = createReconcileHandler({ apiKey: API_KEY, ...makeDb() });
  const res = await post(handler, { body: '[1,2,3]' });
  assert.equal(res.status, 400);
});

test('400: a source key is missing or not an array', async () => {
  const handler = createReconcileHandler({ apiKey: API_KEY, ...makeDb() });
  const res = await post(handler, { body: { bank_a: [], bank_b: [] } }); // no ledger
  assert.equal(res.status, 400);
  assert.match(res.body.error, /ledger/);
});

test('400: invalid JSON string body', async () => {
  const handler = createReconcileHandler({ apiKey: API_KEY, ...makeDb() });
  const res = await post(handler, { body: '{not json' });
  assert.equal(res.status, 400);
});

test('401: missing api key', async () => {
  const handler = createReconcileHandler({ apiKey: API_KEY, ...makeDb() });
  const res = await post(handler, { key: null, body: fullPayload() });
  assert.equal(res.status, 401);
});

test('401: wrong api key', async () => {
  const handler = createReconcileHandler({ apiKey: API_KEY, ...makeDb() });
  const res = await post(handler, { key: 'wrong-key', body: fullPayload() });
  assert.equal(res.status, 401);
});

test('405: non-POST method', async () => {
  const handler = createReconcileHandler({ apiKey: API_KEY, ...makeDb() });
  const res = await handler({ method: 'GET', headers: { 'x-api-key': API_KEY } });
  assert.equal(res.status, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('413: a source exceeds the row limit', async () => {
  const handler = createReconcileHandler({ apiKey: API_KEY, ...makeDb() });
  const oneRow = { tx_id: 'X', date: '2026-09-01', party_name: 'A', amount: '1', description: 'd' };
  const tooMany = new Array(MAX_ROWS + 1).fill(oneRow);
  const res = await post(handler, { body: { bank_a: tooMany, bank_b: [], ledger: [] } });
  assert.equal(res.status, 413);
  assert.match(res.body.error, /limited to 10000 rows/);
});

test('500: handler with no apiKey configured', async () => {
  const handler = createReconcileHandler({ apiKey: undefined, ...makeDb() });
  const res = await post(handler, { body: fullPayload() });
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'Internal server error'); // generic only
});
