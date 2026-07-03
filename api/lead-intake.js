module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  if (!KEY) return res.status(200).json({ ok: false, error: 'Server not configured.' });
  var rest = SUPABASE_URL + '/rest/v1';
  var H = { apikey: KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }

  try {
    if (req.method === 'GET') {
      var c = clip((req.query && req.query.c) || '', 80).trim();
      if (!c) return res.status(200).json({ ok: false, error: 'Missing link id.' });
      var company = '';
      try {
        var cr = await fetch(rest + '/accounts?username=eq.' + encodeURIComponent(c) + '&select=company,name', { headers: H });
        var ca = await cr.json();
        if (Array.isArray(ca) && ca[0]) company = ca[0].company || ca[0].name || '';
      } catch (e) {}
      return res.status(200).json({ ok: true, company: company });
    }

    if (req.method === 'POST') {
      var body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};
      if (clip(body.hp || '', 5)) return res.status(200).json({ ok: true }); // honeypot
      var c2 = clip(body.c || '', 80).trim();
      var name = clip(body.name || '', 120).trim();
      if (!c2) return res.status(200).json({ ok: false, error: 'Invalid link.' });
      if (!name) return res.status(200).json({ ok: false, error: 'Please enter your name.' });

      var lead = {
        id: 'ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: name, company: clip(body.company || '', 120).trim(),
        phone: clip(body.phone || '', 40).trim(), email: clip(body.email || '', 120).trim(),
        service: clip(body.service || '', 200).trim(), value: 0, source: 'Website',
        stage: 'new', notes: clip(body.notes || '', 1500).trim(),
        date: new Date().toISOString().split('T')[0]
      };

      var dr = await fetch(rest + '/app_data?username=eq.' + encodeURIComponent(c2) + '&select=data', { headers: H });
      var da = await dr.json();
      if (Array.isArray(da) && da[0]) {
        var data = da[0].data || {};
        if (!Array.isArray(data.leads)) data.leads = [];
        data.leads.unshift(lead);
        var up = await fetch(rest + '/app_data?username=eq.' + encodeURIComponent(c2), { method: 'PATCH', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify({ data: data, updated_at: new Date().toISOString() }) });
        if (!up.ok) return res.status(200).json({ ok: false, error: 'Could not submit. Please try again.' });
      } else {
        var ins = await fetch(rest + '/app_data', { method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify({ username: c2, data: { leads: [lead] }, updated_at: new Date().toISOString() }) });
        if (!ins.ok) return res.status(200).json({ ok: false, error: 'Could not submit. Please try again.' });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error.' });
  }
};
