// ============================================================
// Supabase persistence via its REST (PostgREST) API.
// Uses Node's built-in https module - NO npm dependencies, no SDK.
//
// Reads credentials from environment variables ONLY:
//   SUPABASE_URL          e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (server-side, bypasses RLS)
//
// Exposes:
//   saveIssues(issues, meta)  insert Error/Warning rows into reconciliation_issues
//   logError(record)          insert one row into reconciliation_errors
//
// Both reject (throw) on failure so the handler can decide what to do
// (respond with saved:false, log, etc.). Callers never pass Matched rows.
// ============================================================

const https = require('https');
const { URL } = require('url');

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }
  return { url, key };
}

// Build the auth headers for a given key.
//
// New-style keys (sb_secret_..., sb_publishable_...) are opaque strings,
// NOT JWTs. They must be sent in the `apikey` header ONLY. If they are also
// sent as `Authorization: Bearer`, PostgREST tries to verify them as a JWT
// and rejects the request with "Invalid JWT".
//
// Legacy keys (anon / service_role) ARE JWTs and use both headers.
function authHeaders(key) {
  const isNewStyle = /^sb_(secret|publishable)_/.test(key);
  const headers = { apikey: key };
  if (!isNewStyle) headers.Authorization = `Bearer ${key}`;
  return headers;
}

// POST a JSON array of rows to a PostgREST table endpoint.
function insert(table, rows) {
  return new Promise((resolve, reject) => {
    const { url, key } = config();
    const endpoint = new URL(`/rest/v1/${table}`, url);
    const payload = Buffer.from(JSON.stringify(rows));

    const req = https.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port || 443,
        path: endpoint.pathname + endpoint.search,
        method: 'POST',
        headers: {
          ...authHeaders(key),
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
          'Content-Length': payload.length,
        },
      },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Supabase insert into ${table} failed: ${res.statusCode} ${data}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Persist only the problem rows. `meta` carries run_id and summary.
async function saveIssues(issues, meta = {}) {
  if (!Array.isArray(issues) || issues.length === 0) return; // nothing to save
  const runId = meta.run_id || null;
  const rows = issues.map(r => ({
    run_id: runId,
    tx_id: r.tx_id,
    status: r.status,
    severity: r.severity,
    days_diff: r.days_diff === '' || r.days_diff === undefined ? null : r.days_diff,
    note: r.note || null,
    bank: r.bank,
    bank_date: r.bank_date || null,
    ledger_date: r.ledger_date || null,
    bank_party: r.bank_party,
    ledger_party: r.ledger_party,
    bank_amount: r.bank_amount === '' ? null : r.bank_amount,
    ledger_amount: r.ledger_amount === '' ? null : r.ledger_amount,
    description: r.description,
  }));
  await insert('reconciliation_issues', rows);
}

// Log a failed/near-failed request for auditing.
async function logError(record = {}) {
  const row = {
    run_id: record.run_id || null,
    message: record.message || 'unknown error',
    status_code: record.status_code || null,
    context: record.context || null,
  };
  await insert('reconciliation_errors', [row]);
}

module.exports = { saveIssues, logError, authHeaders };
