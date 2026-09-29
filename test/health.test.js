// ============================================================
// Tests for the health/info endpoint.
// Covers the shared payload and the Vercel handler (GET -> 200,
// other methods -> 405), and confirms no secrets/data leak.
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const { healthBody } = require('../src/health');
const healthHandler = require('../api/health');

// Minimal res mock matching the bits the Vercel handler uses.
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('healthBody returns the expected static description', () => {
  assert.deepEqual(healthBody(), {
    service: 'Bank Reconciliation Engine',
    status: 'ok',
    usage: 'POST /api/reconcile with x-api-key header',
    docs: 'see README on GitHub',
  });
});

test('healthBody leaks no secret values or Supabase details', () => {
  // Set fake secrets, then confirm none of them appear in the payload.
  process.env.RECON_API_KEY = 'super-secret-api-key-value';
  process.env.SUPABASE_SERVICE_KEY = 'sb_secret_should_not_leak';
  process.env.SUPABASE_URL = 'https://leaky.supabase.co';

  const json = JSON.stringify(healthBody());
  for (const secret of [
    process.env.RECON_API_KEY,
    process.env.SUPABASE_SERVICE_KEY,
    process.env.SUPABASE_URL,
    'sb_secret_',
    'supabase',
  ]) {
    assert.ok(!json.includes(secret), `health payload must not contain "${secret}"`);
  }
});

test('GET /api/health returns 200 with the health body', () => {
  const res = mockRes();
  healthHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, healthBody());
});

test('non-GET /api/health returns 405 with Allow: GET', () => {
  const res = mockRes();
  healthHandler({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});
