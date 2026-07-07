// Leads API — stores audit leads (Upstash). When the report is included, emails it
// with the generated website versions attached as HTML files (Resend).
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const lead = body.lead || {};
    if (!lead.email) return res.status(200).json({ ok: false, error: 'No email provided.' });

    // Path 1: no report -> just store the lead (fires immediately at gate submit).
    if (!lead.report) {
      let stored = null;
      try {
        const RURL = process.env.UPSTASH_REDIS_REST_URL, RTOK = process.env.UPSTASH_REDIS_REST_TOKEN;
        if (RURL && RTOK) {
          const entry = JSON.stringify({ name: lead.name || '', email: lead.email || '', url: lead.url || '', businessName: lead.businessName || '', version: lead.version || '', ts: lead.ts || new Date().toISOString() });
          const rr = await fetch(`${RURL}/rpush/orchamind_leads/${encodeURIComponent(entry)}`, { headers: { Authorization: `Bearer ${RTOK}` } });
          const dd = await rr.json(); stored = dd.result;
        }
      } catch (e) {}
      return res.status(200).json({ ok: true, stored: stored });
    }

    // Path 2: report present -> email the report with website versions attached.
    let emailed = false, emailErr = '', attached = 0;
    try {
      const RESEND = process.env.RESEND_API_KEY;
      const rep = lead.report || {};
      if (RESEND && lead.email) {
        const esc = function (x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
        const biz = esc(rep.business_name || lead.businessName || 'your business');
        const host = esc(rep.host || lead.url || '');
        const score = (rep.overall_score != null && !isNaN(rep.overall_score)) ? Math.round(rep.overall_score) : null;
        const grade = esc(rep.grade_label || '');
        const gcol = score == null ? '#2D7FF9' : (score >= 80 ? '#2E9B5B' : score >= 60 ? '#F9A825' : '#E0553B');
        const wins = Array.isArray(rep.quick_wins) ? rep.quick_wins.slice(0, 6) : [];
        const winsHtml = wins.length ? ('<ul style="margin:8px 0 0;padding-left:20px;">' + wins.map(function (w) { return '<li style="margin-bottom:7px;font-size:14px;color:#3a4a5a;">' + esc(w) + '</li>'; }).join('') + '</ul>') : '';
        let scoresHtml = '';
        if (rep.scores && typeof rep.scores === 'object') {
          const rows = Object.keys(rep.scores).map(function (k) {
            const o = rep.scores[k] || {}; const sc = (o.score != null) ? Math.round(o.score) : 0;
            const col = sc >= 80 ? '#2E9B5B' : sc >= 60 ? '#F9A825' : '#E0553B';
            return '<tr><td style="padding:7px 0;font-size:14px;color:#0A1628;text-transform:capitalize;">' + esc(k.replace(/_/g, ' ')) + '</td><td style="padding:7px 0;text-align:right;"><b style="color:' + col + ';font-size:14px;">' + sc + '/100</b></td></tr>' + (o.summary ? ('<tr><td colspan="2" style="padding:0 0 9px;font-size:12.5px;color:#66748a;">' + esc(o.summary) + '</td></tr>') : '');
          }).join('');
          scoresHtml = '<table style="width:100%;border-collapse:collapse;margin-top:4px;">' + rows + '</table>';
        }
        const pages = Array.isArray(lead.pages) ? lead.pages.filter(function (p) { return p && p.html; }) : [];
        const attachments = pages.map(function (p, i) { return { filename: 'website-version-' + (i + 1) + '.html', content: Buffer.from(String(p.html), 'utf8').toString('base64') }; });
        attached = attachments.length;
        const versionsLine = attached
          ? ('<p style="font-size:13px;color:#3a4a5a;margin:0;background:#eef6ff;border:1px solid #cfe3fb;border-radius:9px;padding:12px 14px;">\uD83D\uDCCE <b>Your ' + attached + ' custom website version' + (attached > 1 ? 's are' : ' is') + ' attached</b> to this email as ready-to-use HTML file' + (attached > 1 ? 's' : '') + ' \u2014 just open them in any browser to preview.</p>')
          : ('<p style="font-size:13px;color:#66748a;margin:0;">Want your custom website versions built? Reply to this email or call <a href="tel:13236577752" style="color:#2D7FF9;">(323) 657-7752</a>.</p>');
        const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0A1628;">'
          + '<div style="background:#0A1628;padding:26px;border-radius:12px 12px 0 0;text-align:center;"><div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:1px;">ORCHAMIND</div><div style="color:#9fb2cc;font-size:13px;margin-top:4px;">Your Online Presence Report</div></div>'
          + '<div style="border:1px solid #e6ebf2;border-top:none;border-radius:0 0 12px 12px;padding:26px;">'
          + '<p style="font-size:15px;margin:0 0 4px;">Hi ' + esc(lead.name || 'there') + ',</p>'
          + '<p style="font-size:14.5px;color:#3a4a5a;margin:0 0 18px;">Here is your full report for <b>' + biz + '</b>' + (host ? (' (' + host + ')') : '') + '.</p>'
          + (score != null ? ('<div style="text-align:center;background:#f5f8fc;border-radius:12px;padding:20px;margin-bottom:18px;"><div style="font-size:44px;font-weight:800;color:' + gcol + ';line-height:1;">' + score + '<span style="font-size:20px;color:#9aa7b6;">/100</span></div>' + (grade ? ('<div style="font-size:14px;font-weight:700;color:' + gcol + ';margin-top:4px;">' + grade + '</div>') : '') + '</div>') : '')
          + (rep.headline ? ('<p style="font-size:15px;font-weight:700;color:#0A1628;margin:0 0 14px;">' + esc(rep.headline) + '</p>') : '')
          + (winsHtml ? ('<div style="margin-bottom:18px;"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#2D7FF9;">Top quick wins</div>' + winsHtml + '</div>') : '')
          + (scoresHtml ? ('<div style="margin-bottom:20px;"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#2D7FF9;margin-bottom:2px;">Score breakdown</div>' + scoresHtml + '</div>') : '')
          + '<div style="margin-bottom:16px;">' + versionsLine + '</div>'
          + '<div style="background:#0A1628;border-radius:12px;padding:20px;text-align:center;margin-bottom:6px;"><div style="color:#fff;font-size:16px;font-weight:700;margin-bottom:6px;">Run the whole business, not just the website.</div><div style="color:#b9c6d8;font-size:13px;margin-bottom:14px;">Orchamind is the AI app that writes your estimates, dispatches your crew, and captures leads &mdash; first month free, then $500/month.</div><a href="https://orchamind.com/app?signup=1" style="display:inline-block;background:#2D7FF9;color:#fff;text-decoration:none;font-weight:700;padding:12px 26px;border-radius:9px;font-size:14px;">Start free &rarr;</a></div>'
          + '</div><p style="text-align:center;font-size:11px;color:#9aa7b6;margin-top:14px;">Orchamind &middot; orchamind.com</p></div>';
        const subj = 'Your Online Presence Report' + (rep.business_name ? (' \u2014 ' + rep.business_name) : '');
        const payload = { from: 'Orchamind <welcome@orchamind.com>', to: [lead.email], subject: subj, html: html };
        if (attachments.length) payload.attachments = attachments;
        const er = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (er.ok) emailed = true; else emailErr = (await er.text()).slice(0, 160);
      } else if (!RESEND) { emailErr = 'RESEND_API_KEY not set'; }
    } catch (e) { emailErr = String((e && e.message) || e); }

    return res.status(200).json({ ok: true, emailed: emailed, attached: attached, emailErr: emailErr });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
};
