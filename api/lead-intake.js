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
      var company = ''; var logo = '';
      try {
        var cr = await fetch(rest + '/accounts?username=eq.' + encodeURIComponent(c) + '&select=company,name,profile', { headers: H });
        var ca = await cr.json();
        if (Array.isArray(ca) && ca[0]) { company = ca[0].company || ca[0].name || ''; logo = (ca[0].profile && ca[0].profile.logo) || ''; }
      } catch (e) {}
      return res.status(200).json({ ok: true, company: company, logo: logo });
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
      try { await fetch(rest + '/activity_log', { method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify({ type: 'lead', username: c2, detail: name + ' requested a quote' }) }); } catch (e) {}

      // Instant notification to the contractor — speed-to-lead matters. Never blocks the visitor.
      try {
        var RESEND = process.env.RESEND_API_KEY;
        if (RESEND) {
          var pr = await fetch(rest + '/accounts?username=eq.' + encodeURIComponent(c2) + '&select=company,name,profile', { headers: H });
          var pa = await pr.json();
          var acct = (Array.isArray(pa) && pa[0]) ? pa[0] : null;
          var toEmail = (acct && acct.profile && acct.profile.email) || '';
          if (toEmail) {
            var esc2 = function (x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
            var isBooking = (lead.service || '').indexOf('[Booking]') >= 0;
            var svc = (lead.service || '').replace('[Booking]', '').trim();
            var label = isBooking ? 'booking request' : 'lead';
            var row = function (k, v) { return v ? ('<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#66748a;white-space:nowrap;">' + k + '</td><td style="padding:6px 0;font-size:14px;color:#0A1628;font-weight:600;">' + v + '</td></tr>') : ''; };
            var phoneCell = lead.phone ? ('<a href="tel:' + encodeURIComponent(lead.phone) + '" style="color:#2D7FF9;text-decoration:none;">' + esc2(lead.phone) + '</a>') : '';
            var mailCell = lead.email ? ('<a href="mailto:' + encodeURIComponent(lead.email) + '" style="color:#2D7FF9;text-decoration:none;">' + esc2(lead.email) + '</a>') : '';
            var html2 = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0A1628;">'
              + '<div style="background:#0A1628;padding:22px;border-radius:12px 12px 0 0;text-align:center;"><div style="color:#F9A825;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">New ' + label + '</div><div style="color:#fff;font-size:22px;font-weight:800;margin-top:4px;">' + esc2(lead.name) + '</div></div>'
              + '<div style="border:1px solid #e6ebf2;border-top:none;border-radius:0 0 12px 12px;padding:22px;">'
              + '<p style="margin:0 0 14px;font-size:14.5px;color:#3a4a5a;">Someone just ' + (isBooking ? 'requested an appointment' : 'asked for a quote') + ' from your website. Reach out fast — the first contractor to respond usually wins the job.</p>'
              + '<table style="width:100%;border-collapse:collapse;margin-bottom:18px;">'
              + row('Name', esc2(lead.name)) + row('Phone', phoneCell) + row('Email', mailCell)
              + row(isBooking ? 'Requested' : 'Service', esc2(svc)) + row('Notes', esc2(lead.notes)) + '</table>'
              + (lead.phone ? ('<a href="tel:' + encodeURIComponent(lead.phone) + '" style="display:inline-block;background:#2E9B5B;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9px;font-size:14px;margin-right:8px;">Call ' + esc2(lead.name.split(' ')[0]) + '</a>') : '')
              + '<a href="https://orchamind.com/app" style="display:inline-block;background:#2D7FF9;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9px;font-size:14px;">Open in Orchamind</a>'
              + '</div><p style="text-align:center;font-size:11px;color:#9aa7b6;margin-top:12px;">Orchamind &middot; orchamind.com</p></div>';
            await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Orchamind <welcome@orchamind.com>', to: [toEmail], reply_to: (lead.email || undefined), subject: (isBooking ? '\uD83D\uDCC5 New booking request: ' : '\uD83D\uDD14 New lead: ') + lead.name + (svc ? (' \u2014 ' + svc) : ''), html: html2 }) });
          }
        }
      } catch (eNotify) {}

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error.' });
  }
};
