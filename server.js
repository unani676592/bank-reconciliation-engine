// ============================================================
// Local development server - built-in http module, NO npm deps.
// Mimics the Vercel function so you can test end-to-end on Windows
// without deploying. Start with:  npm run dev
//
// Reads config from a .env file (see .env.example). If SUPABASE_*
// vars are absent, reconciliation still works and the response will
// show "saved": false with a warning.
// ============================================================

const http = require('http');
const { loadEnv } = require('./src/load-env');
loadEnv();

const { createReconcileHandler } = require('./src/handler');
const { healthBody } = require('./src/health');
const db = require('./src/db');

const PORT = process.env.PORT || 3000;

const handle = createReconcileHandler({
  apiKey: process.env.RECON_API_KEY,
  saveIssues: db.saveIssues,
  logError: db.logError,
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const LIMIT = 20 * 1024 * 1024; // 20 MB hard cap on raw bytes
    req.on('data', chunk => {
      size += chunk.length;
      if (size > LIMIT) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health/info: GET / and GET /api/health. No auth, no secrets, no data.
  if (url.pathname === '/' || url.pathname === '/api/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthBody()));
    return;
  }

  // Everything else must be the reconcile endpoint.
  if (url.pathname !== '/api/reconcile') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let rawBody = '';
  try {
    rawBody = await readBody(req);
  } catch (err) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Payload too large' }));
    return;
  }

  const result = await handle({
    method: req.method,
    headers: req.headers,
    body: rawBody, // handler parses the JSON string
  });

  const headers = { 'Content-Type': 'application/json', ...(result.headers || {}) };
  res.writeHead(result.status, headers);
  res.end(JSON.stringify(result.body));
});

server.listen(PORT, () => {
  console.log(`Reconciliation dev server listening on http://localhost:${PORT}`);
  console.log(`POST reconciliation requests to http://localhost:${PORT}/api/reconcile`);
  if (!process.env.RECON_API_KEY) {
    console.warn('WARNING: RECON_API_KEY is not set - all requests will get 500. Copy .env.example to .env.');
  } else {
    // Print ONLY the length so it can be compared with the client, never the key.
    console.log(`RECON_API_KEY loaded (length: ${process.env.RECON_API_KEY.length})`);
  }
});
