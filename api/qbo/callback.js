// QuickBooks OAuth2 callback: exchange code for tokens, store in Supabase. Redirect URI follows the real host (www-safe).
function esc(s){ return String(s).replace(/[&<>]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]; }); }
function calcRedirect(req){
  var host = (req.headers && req.headers.host) || '';
  if (host && host.indexOf('.') >= 0) return 'https://' + host + '/api/qbo/callback';
  return (process.env.QBO_REDIRECT_URI || 'https://orchamind.com/api/qbo/callback').trim();
}
function page(title, bodyHtml){
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0A1628;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;}'
    + '.card{background:#13243d;border:1px solid #24395c;border-radius:16px;padding:32px;max-width:520px;}h2{margin:0 0 10px;}a{color:#2D7FF9;font-weight:700;text-decoration:none;}b{color:#F9A825;}pre{white-space:pre-wrap;word-break:break-word;background:#0a1628;padding:12px;border-radius:8px;color:#9bb8e0;font-size:12px;}</style>'
    + '<div class="card"><h2>' + title + '</h2>' + bodyHtml + '</div>';
}
module.exports = async (req, res) => {
  res.setHeader('Content-Type','text/html');
  try {
    var q = req.query || {};
    var url; try { url = new URL(req.url, 'https://orchamind.com'); } catch(e){ url = null; }
    function gp(k){ if (q && q[k] != null) return q[k]; return url ? url.searchParams.get(k) : null; }
    var code = gp('code'); var realmId = gp('realmId') || ''; var oerr = gp('error'); var oerrd = gp('error_description');
    if (!code) {
      var allp = {};
      if (url) { url.searchParams.forEach(function(v,k){ allp[k] = v; }); }
      if (q) { Object.keys(q).forEach(function(k){ if (allp[k] == null) allp[k] = q[k]; }); }
      var dump = 'Raw path Intuit hit:\n' + esc(String(req.url)) + '\n\nParams received:\n' + esc(JSON.stringify(allp, null, 2));
      var detail = oerr ? ('Intuit reported: <b>' + esc(oerr) + '</b>' + (oerrd ? (' &mdash; ' + esc(oerrd)) : '') + '.')
                        : 'No authorization code came back from Intuit \u2014 the authorization did not complete. The usual cause with Development keys is that there is <b>no sandbox company</b> to connect to (or Cancel/back was used).';
      res.statusCode = 200; return res.end(page('Connection not completed',
        '<p>' + detail + '</p>'
        + '<pre>' + dump + '</pre>'
        + '<p><b>Fix:</b> create a sandbox company at <a href="https://developer.intuit.com/app/developer/sandbox">developer.intuit.com/app/developer/sandbox</a>, then <a href="https://www.orchamind.com/api/qbo/connect">try again &rarr;</a></p>'));
    }
    var CID = (process.env.QBO_CLIENT_ID||'').trim(), CS = (process.env.QBO_CLIENT_SECRET||'').trim();
    if (!CID || !CS) { res.statusCode = 500; return res.end(page('Not configured', '<p>Missing in Vercel: ' + (!CID?'<b>QBO_CLIENT_ID</b> ':'') + (!CS?'<b>QBO_CLIENT_SECRET</b>':'') + '. Add it and redeploy.</p>')); }
    var REDIRECT = calcRedirect(req);
    var basic = Buffer.from(CID + ':' + CS).toString('base64');
    var body = 'grant_type=authorization_code&code=' + encodeURIComponent(code) + '&redirect_uri=' + encodeURIComponent(REDIRECT);
    var tr = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', { method: 'POST', headers: { 'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: body });
    var tok = await tr.json();
    if (!tok || !tok.access_token) { res.statusCode = 200; return res.end(page('Token exchange failed', '<p>Intuit response:</p><pre>' + esc(JSON.stringify(tok)) + '</pre><p>(redirect_uri used: <b>' + esc(REDIRECT) + '</b> &mdash; it must be registered in Intuit.)</p><p><a href="https://www.orchamind.com/api/qbo/connect">Try again</a></p>')); }
    var SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
    var stored = false, storeErr = '';
    if (SB_URL && SB_KEY) {
      var row = { id: 'default', realm_id: realmId, access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + ((tok.expires_in || 3600) * 1000), updated_at: new Date().toISOString() };
      var sr = await fetch(SB_URL + '/rest/v1/qbo_tokens?on_conflict=id', { method: 'POST', headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
      if (sr.ok) { stored = true; } else { storeErr = 'HTTP ' + sr.status + ' ' + (await sr.text()).slice(0,300); }
    } else { storeErr = 'Supabase env vars not found.'; }
    res.statusCode = 200;
    if (stored) return res.end(page('\u2713 QuickBooks connected', '<p>Your QuickBooks company (realm <b>' + esc(realmId) + '</b>) is now linked to Orchamind.</p><p><a href="/app">Back to Orchamind &rarr;</a></p>'));
    return res.end(page('Connected, but not saved', '<p>Authorized, but saving the token failed:</p><pre>' + esc(storeErr) + '</pre>'));
  } catch (e) { res.statusCode = 200; return res.end(page('QuickBooks error', '<pre>' + esc(e && e.message ? e.message : String(e)) + '</pre>')); }
};
