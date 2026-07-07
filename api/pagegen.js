// AI page generator relay for the audit tool (used by audit.html).
// Mirrors claude.js: relays to Anthropic and returns the raw response.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { return res.status(200).json({ error: 'Page generator not configured.' }); }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};
    const maxTokens = Math.min(body.max_tokens || 4000, 8000);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = (body.system || '').toString().slice(0, 12000);
    const payload = { model: 'claude-sonnet-4-6', max_tokens: maxTokens, messages: messages };
    if (system) payload.system = system;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
};
