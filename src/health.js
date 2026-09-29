// ============================================================
// Health/info payload for GET / and GET /api/health.
// A single source of truth so the local server and the Vercel
// function return exactly the same body. Contains NO secrets and
// NO reconciliation data - just a static service description.
// ============================================================

function healthBody() {
  return {
    service: 'Bank Reconciliation Engine',
    status: 'ok',
    usage: 'POST /api/reconcile with x-api-key header',
    docs: 'see README on GitHub',
  };
}

module.exports = { healthBody };
