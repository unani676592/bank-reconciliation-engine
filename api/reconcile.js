// ============================================================
// Vercel serverless function: POST /api/reconcile
// Thin adapter around the framework-agnostic handler in src/handler.js.
// All logic (auth, validation, reconciliation, saving) lives there.
// ============================================================

const { createReconcileHandler } = require('../src/handler');
const db = require('../src/db');

const handler = createReconcileHandler({
  apiKey: process.env.RECON_API_KEY,
  saveIssues: db.saveIssues,
  logError: db.logError,
});

module.exports = async (req, res) => {
  // Vercel parses JSON bodies automatically; the handler also accepts a
  // raw string body just in case.
  const result = await handler({
    method: req.method,
    headers: req.headers,
    body: req.body,
  });

  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  }
  res.status(result.status).json(result.body);
};
