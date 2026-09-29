// ============================================================
// Framework-agnostic request handler for POST /api/reconcile.
//
// createReconcileHandler({ apiKey, saveIssues, logError }) returns an
// async function handle({ method, headers, body }) -> { status, body }.
//
// Keeping it framework-agnostic means the same logic is used by the
// Vercel serverless function (api/reconcile.js), the local dev server
// (server.js), and the tests - no HTTP mocking required.
//
// Status codes:
//   200  reconciliation succeeded (see body.saved for DB outcome)
//   400  bad input (not JSON, missing keys, or a missing column)
//   401  missing/invalid x-api-key
//   405  method other than POST
//   413  a source exceeds MAX_ROWS
//   500  unexpected server error (generic message; details logged)
// ============================================================

const crypto = require('crypto');
const { reconcile, buildNotes } = require('./reconcile');

const MAX_ROWS = 10000;
const SOURCE_KEYS = ['bank_a', 'bank_b', 'ledger'];

// Constant-time comparison. We hash both sides to a fixed length first so
// timingSafeEqual never throws on length mismatch and we do not leak the
// key length.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function json(status, body) {
  return { status, body };
}

function createReconcileHandler({ apiKey, saveIssues, logError } = {}) {
  // Best-effort error logging; never let logging break the response.
  async function safeLog(record) {
    if (typeof logError !== 'function') return;
    try {
      await logError(record);
    } catch (err) {
      console.error('[reconcile] failed to log error to database:', err.message);
    }
  }

  return async function handle({ method, headers = {}, body } = {}) {
    try {
      // ---- server misconfiguration ----
      if (!apiKey) {
        console.error('[reconcile] RECON_API_KEY is not configured');
        return json(500, { error: 'Internal server error' });
      }

      // ---- method ----
      if (method !== 'POST') {
        return { status: 405, body: { error: 'Method not allowed. Use POST.' }, headers: { Allow: 'POST' } };
      }

      // ---- authentication ----
      const provided = headers['x-api-key'];
      if (!provided || !safeEqual(provided, apiKey)) {
        return json(401, { error: 'Invalid or missing API key' });
      }

      // ---- parse body ----
      let payload = body;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (err) {
          return json(400, { error: 'Request body must be valid JSON' });
        }
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json(400, { error: 'Request body must be a JSON object with keys bank_a, bank_b, ledger' });
      }

      // ---- validate the three sources ----
      for (const key of SOURCE_KEYS) {
        if (!Array.isArray(payload[key])) {
          return json(400, { error: `"${key}" is required and must be an array of rows` });
        }
      }

      // ---- size limit ----
      for (const key of SOURCE_KEYS) {
        if (payload[key].length > MAX_ROWS) {
          return json(413, {
            error: `Each source is limited to ${MAX_ROWS} rows. "${key}" has ${payload[key].length}.`,
          });
        }
      }

      const sources = {
        bank_a: payload.bank_a,
        bank_b: payload.bank_b,
        ledger: payload.ledger,
      };

      // ---- run reconciliation ----
      let results;
      try {
        results = reconcile(sources);
      } catch (err) {
        // A thrown reconcile error means bad input (e.g. a missing column).
        // Safe to show the caller; also record it for auditing.
        await safeLog({ message: err.message, status_code: 400, context: 'reconcile' });
        return json(400, { error: err.message });
      }

      const notes = buildNotes(sources);
      const summary = {
        total: results.length,
        error: results.filter(r => r.severity === 'Error').length,
        warning: results.filter(r => r.severity === 'Warning').length,
        ok: results.filter(r => r.severity === 'OK').length,
      };

      // Only problem rows (Error/Warning) are ever persisted. Matched rows
      // are never saved to the database.
      const issues = results.filter(r => r.severity !== 'OK');

      const runId = crypto.randomUUID();
      let saved = false;
      let warning;
      if (typeof saveIssues === 'function') {
        try {
          await saveIssues(issues, { run_id: runId, summary });
          saved = true;
        } catch (err) {
          console.error('[reconcile] failed to save issues to database:', err.message);
          await safeLog({ message: err.message, status_code: 200, context: 'saveIssues', run_id: runId });
          warning = 'Reconciliation succeeded but results could not be saved to the database.';
        }
      }

      const responseBody = { run_id: runId, summary, notes, saved, results };
      if (warning) responseBody.warning = warning;
      return json(200, responseBody);
    } catch (err) {
      // Anything unexpected: generic message to the caller, details to the log.
      console.error('[reconcile] unexpected error:', err && err.stack ? err.stack : err);
      await safeLog({ message: err && err.message ? err.message : String(err), status_code: 500, context: 'handler' });
      return json(500, { error: 'Internal server error' });
    }
  };
}

module.exports = { createReconcileHandler, MAX_ROWS };
