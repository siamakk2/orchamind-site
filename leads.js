// Leads API — saves audit leads (name, email, business URL) to Upstash.
// Stored under key: orchamind_leads (a JSON array, appended to).
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  try {
    const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
    const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!REDIS_URL || !REDIS_TOKEN) {
      return res.status(200).json({ ok: false, error: 'Storage not configured.' });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e){ body={}; } }

    const lead = body.lead || {};
    if (!lead.email) { return res.status(200).json({ ok: false, error: 'No email provided.' }); }

    // Append to the leads list using Upstash RPUSH
    const entry = JSON.stringify({
      name: lead.name || '',
      email: lead.email || '',
      url: lead.url || '',
      businessName: lead.businessName || '',
      version: lead.version || '',
      ts: lead.ts || new Date().toISOString()
    });

    const r = await fetch(`${REDIS_URL}/rpush/orchamind_leads/${encodeURIComponent(entry)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const data = await r.json();
    return res.status(200).json({ ok: true, count: data.result });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
};
