// QuickBooks OAuth2 callback: exchanges the auth code for tokens and stores them in Supabase.
function esc(s){ return String(s).replace(/[&<>]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]; }); }
function page(title, bodyHtml){
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0A1628;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;}'
    + '.card{background:#13243d;border:1px solid #24395c;border-radius:16px;padding:32px;max-width:520px;}'
    + 'h2{margin:0 0 10px;}a{color:#2D7FF9;font-weight:700;text-decoration:none;}b{color:#F9A825;}pre{white-space:pre-wrap;word-break:break-word;background:#0a1628;padding:12px;border-radius:8px;color:#9bb8e0;font-size:12px;}</style>'
    + '<div class="card"><h2>' + title + '</h2>' + bodyHtml + '</div>';
}
module.exports = async (req, res) => {
  res.setHeader('Content-Type','text/html');
  try {
    var q = req.query || {};
    var url; try { url = new URL(req.url, 'https://orchamind.com'); } catch(e){ url = null; }
    function gp(k){ if (q && q[k] != null) return q[k]; return url ? url.searchParams.get(k) : null; }
    var code = gp('code');
    var realmId = gp('realmId') || '';
    var oerr = gp('error');
    var oerrd = gp('error_description');

    if (!code) {
      var detail;
      if (oerr) {
        detail = 'Intuit reported: <b>' + esc(oerr) + '</b>' + (oerrd ? (' &mdash; ' + esc(oerrd)) : '') + '.';
      } else {
        detail = 'Intuit returned to this page without an authorization code. With <b>Development</b> keys you must pick a <b>sandbox</b> company on the Intuit screen and click the blue <b>Connect</b> button.';
      }
      res.statusCode = 200;
      return res.end(page('Connection not completed',
        '<p>' + detail + '</p>'
        + '<p>Checklist: (1) use <b>Development</b> keys, (2) on the Intuit screen choose your <b>sandbox</b> company, (3) click <b>Connect</b> (not Cancel).</p>'
        + '<p><a href="/api/qbo/connect">Try connecting again &rarr;</a></p>'));
    }

    var CID = process.env.QBO_CLIENT_ID, CS = process.env.QBO_CLIENT_SECRET;
    var REDIRECT = process.env.QBO_REDIRECT_URI || 'https://orchamind.com/api/qbo/callback';
    if (!CID || !CS) { res.statusCode = 500; return res.end(page('Not configured','<p>QBO_CLIENT_ID / QBO_CLIENT_SECRET missing in Vercel.</p>')); }
    var basic = Buffer.from(CID + ':' + CS).toString('base64');
    var body = 'grant_type=authorization_code&code=' + encodeURIComponent(code) + '&redirect_uri=' + encodeURIComponent(REDIRECT);
    var tr = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body
    });
    var tok = await tr.json();
    if (!tok || !tok.access_token) {
      res.statusCode = 200;
      return res.end(page('Token exchange failed', '<p>Intuit accepted the login but the token exchange failed. Details:</p><pre>' + esc(JSON.stringify(tok)) + '</pre><p><a href="/api/qbo/connect">Try again</a></p>'));
    }
    var SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
    var stored = false, storeErr = '';
    if (SB_URL && SB_KEY) {
      var row = { id: 'default', realm_id: realmId, access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + ((tok.expires_in || 3600) * 1000), updated_at: new Date().toISOString() };
      var sr = await fetch(SB_URL + '/rest/v1/qbo_tokens?on_conflict=id', {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(row)
      });
      if (sr.ok) { stored = true; } else { storeErr = 'HTTP ' + sr.status + ' ' + (await sr.text()).slice(0,300); }
    } else { storeErr = 'Supabase env vars not found.'; }
    res.statusCode = 200;
    if (stored) {
      return res.end(page('\u2713 QuickBooks connected', '<p>Your QuickBooks company (realm <b>' + esc(realmId) + '</b>) is now linked to Orchamind.</p><p><a href="/app">Back to Orchamind &rarr;</a></p>'));
    }
    return res.end(page('Connected, but not saved', '<p>Intuit authorized successfully, but saving the token failed:</p><pre>' + esc(storeErr) + '</pre>'));
  } catch (e) {
    res.statusCode = 200;
    return res.end(page('QuickBooks error', '<pre>' + esc(e && e.message ? e.message : String(e)) + '</pre>'));
  }
};
