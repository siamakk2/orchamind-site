// Claude relay for the Orchamind DEMO (used by demo.html). Cost-protected.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { return res.status(200).json({ error: 'Demo AI not configured.' }); }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};

    // Cap tokens hard for demo cost control
    const maxTokens = Math.min(body.max_tokens || 800, 8000);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = (body.system || '').toString().slice(0, 6000);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system: system, messages: messages })
    });
    const data = await r.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json({ error: 'Demo AI error: ' + err.message });
  }
};
