// ============================================================
// Vercel serverless function: GET /api/health (and / via vercel.json).
// Returns a static service description. No auth, no secrets, no data.
// ============================================================

const { healthBody } = require('../src/health');

module.exports = (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }
  res.status(200).json(healthBody());
};
