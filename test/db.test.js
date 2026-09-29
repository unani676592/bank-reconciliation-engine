// ============================================================
// Tests for how db.js sends the Supabase API key.
// New-style keys (sb_secret_/sb_publishable_) must go in the apikey
// header ONLY; legacy JWT keys use both apikey and Authorization.
// No network calls - we only inspect the header builder.
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const { authHeaders } = require('../src/db');

test('new-style secret key goes in apikey only, never Authorization', () => {
  const h = authHeaders('sb_secret_abc123');
  assert.equal(h.apikey, 'sb_secret_abc123');
  assert.ok(!('Authorization' in h), 'must not send Authorization for sb_secret_ keys');
});

test('new-style publishable key goes in apikey only', () => {
  const h = authHeaders('sb_publishable_xyz');
  assert.equal(h.apikey, 'sb_publishable_xyz');
  assert.ok(!('Authorization' in h));
});

test('legacy JWT key uses both apikey and Authorization', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
  const h = authHeaders(jwt);
  assert.equal(h.apikey, jwt);
  assert.equal(h.Authorization, `Bearer ${jwt}`);
});
