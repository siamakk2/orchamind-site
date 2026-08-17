// AI page generator relay for the audit tool (used by audit.html).
//
// Generating a full HTML landing page runs 30-90s. This function had no
// maxDuration in vercel.json (api/claude.js has 300s, api/render.js 120s,
// this one had nothing) so it inherited Vercel's short default and was
// killed mid-generation. The browser saw a dead connection and the spinner
// ran forever. maxDuration is now set; this adds a server-side abort and a
// real error body so a failure surfaces instead of hanging.
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
    // Abort before the platform kills us, so the client gets a real error.
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 240000);
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      clearTimeout(timer);
      return res.status(200).json({
        error: e.name === 'AbortError'
          ? 'The page builder took too long. Please try again.'
          : 'Could not reach the page builder: ' + e.message
      });
    }
    clearTimeout(timer);

    const data = await r.json();
    if (!r.ok || (data && data.error)) {
      return res.status(200).json({
        error: (data && data.error && data.error.message) || ('Page builder error (status ' + r.status + ').')
      });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
};
