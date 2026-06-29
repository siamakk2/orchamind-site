// QuickBooks OAuth2 callback: exchange code for tokens (via Node https), store in Supabase.
var https = require('https');
function esc(s){ return String(s).replace(/[&<>]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]; }); }
function calcRedirect(req){ return (process.env.QBO_REDIRECT_URI || 'https://orchamind.com/api/qbo/callback').trim(); }
function page(title, bodyHtml){
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0A1628;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;}'
    + '.card{background:#13243d;border:1px solid #24395c;border-radius:16px;padding:32px;max-width:540px;}h2{margin:0 0 10px;}a{color:#2D7FF9;font-weight:700;text-decoration:none;}b{color:#F9A825;}pre{white-space:pre-wrap;word-break:break-word;background:#0a1628;padding:12px;border-radius:8px;color:#9bb8e0;font-size:12px;}</style>'
    + '<div class="card"><h2>' + title + '</h2>' + bodyHtml + '</div>';
}
function httpReq(method, urlStr, headers, bodyStr){
  return new Promise(function(resolve, reject){
    var u; try { u = new URL(urlStr); } catch(e){ return reject(e); }
    var data = bodyStr || '';
    var opts = { method: method, hostname: u.hostname, port: 443, path: u.pathname + (u.search || ''),
      headers: Object.assign({}, headers, { 'Content-Length': Buffer.byteLength(data) }) };
    var rq = https.request(opts, function(resp){
      var buf = '';
      resp.on('data', function(c){ buf += c; });
      resp.on('end', function(){ resolve({ status: resp.statusCode, text: buf }); });
    });
    rq.on('error', function(err){ reject(err); });
    rq.setTimeout(15000, function(){ rq.destroy(new Error('Request timed out after 15s')); });
    if (data) rq.write(data);
    rq.end();
  });
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
      var dump = 'Raw path:\n' + esc(String(req.url)) + '\n\nParams:\n' + esc(JSON.stringify(allp, null, 2));
      var detail = oerr ? ('Intuit reported: <b>' + esc(oerr) + '</b>' + (oerrd ? (' &mdash; ' + esc(oerrd)) : '') + '.')
                        : 'No authorization code came back. The code is single-use \u2014 always start fresh at <b>/api/qbo/connect</b>, pick a <b>sandbox</b> company, and click Connect.';
      res.statusCode = 200; return res.end(page('Connection not completed', '<p>' + detail + '</p><pre>' + dump + '</pre><p><a href="https://orchamind.com/api/qbo/connect">Try again &rarr;</a></p>'));
    }
    var CID = (process.env.QBO_CLIENT_ID||'').trim(), CS = (process.env.QBO_CLIENT_SECRET||'').trim();
    if (!CID || !CS) { res.statusCode = 500; return res.end(page('Not configured', '<p>Missing in Vercel: ' + (!CID?'<b>QBO_CLIENT_ID</b> ':'') + (!CS?'<b>QBO_CLIENT_SECRET</b>':'') + '. Add it and redeploy.</p>')); }
    var REDIRECT = calcRedirect(req);
    var basic = Buffer.from(CID + ':' + CS).toString('base64');
    var body = 'grant_type=authorization_code&code=' + encodeURIComponent(code) + '&redirect_uri=' + encodeURIComponent(REDIRECT);

    var tok;
    try {
      var tr = await httpReq('POST', 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        { 'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body);
      try { tok = JSON.parse(tr.text || '{}'); } catch(pe){ tok = { _raw: tr.text, _status: tr.status }; }
      if (!tok || !tok.access_token) {
        res.statusCode = 200;
        return res.end(page('Token exchange rejected', '<p>Intuit replied (HTTP ' + esc(String(tr.status)) + '):</p><pre>' + esc(JSON.stringify(tok)) + '</pre><p>redirect_uri used: <b>' + esc(REDIRECT) + '</b></p><p><a href="https://orchamind.com/api/qbo/connect">Try again</a></p>'));
      }
    } catch (te) {
      var reason = (te && te.cause && te.cause.message) || (te && te.message) || String(te);
      res.statusCode = 200;
      return res.end(page('Could not reach Intuit', '<p>The token request failed at the network level:</p><pre>' + esc(reason) + '</pre><p><a href="https://orchamind.com/api/qbo/connect">Try again</a></p>'));
    }

    var SB_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
    var keyName = '(none)', SB_KEY = '';
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) { SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; keyName = 'SUPABASE_SERVICE_ROLE_KEY'; }
    else if (process.env.SUPABASE_SECRET_KEY) { SB_KEY = process.env.SUPABASE_SECRET_KEY; keyName = 'SUPABASE_SECRET_KEY'; }
    else if (process.env.SUPABASE_SERVICE_KEY) { SB_KEY = process.env.SUPABASE_SERVICE_KEY; keyName = 'SUPABASE_SERVICE_KEY'; }
    SB_KEY = (SB_KEY || '').trim();
    function keyKind(k){ if(k.indexOf('sb_secret_')===0) return 'secret (correct type)'; if(k.indexOf('sb_publishable_')===0) return 'PUBLISHABLE \u2014 wrong, needs the secret key'; if(k.indexOf('eyJ')===0) return 'legacy JWT'; return 'unknown / empty'; }
    var keyDiag = 'env var read: ' + keyName + '  |  length: ' + SB_KEY.length + '  |  starts: ' + SB_KEY.slice(0,12) + '\u2026  |  ends: \u2026' + SB_KEY.slice(-4) + '  |  type: ' + keyKind(SB_KEY);
    var stored = false, storeErr = '';
    if (SB_URL && SB_KEY) {
      try {
        var row = JSON.stringify({ id: 'default', realm_id: realmId, access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + ((tok.expires_in || 3600) * 1000), updated_at: new Date().toISOString() });
        var sr = await httpReq('POST', SB_URL.replace(/\/$/,'') + '/rest/v1/qbo_tokens?on_conflict=id',
          { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }, row);
        if (sr.status >= 200 && sr.status < 300) { stored = true; } else { storeErr = 'HTTP ' + sr.status + ' ' + String(sr.text).slice(0,300) + '\n\nKey in use → ' + keyDiag; }
      } catch (se) { storeErr = ((se && se.message) || String(se)) + '\n\nKey in use → ' + keyDiag; }
    } else { storeErr = 'No Supabase secret key found in env. Checked SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_SERVICE_KEY.'; }

    res.statusCode = 200;
    if (stored) return res.end(page('\u2713 QuickBooks connected', '<p>Your QuickBooks company (realm <b>' + esc(realmId) + '</b>) is now linked to Orchamind. You can close this tab.</p><p><a href="/app">Back to Orchamind &rarr;</a></p>'));
    return res.end(page('Connected, but not saved', '<p>QuickBooks authorized successfully, but saving the token failed:</p><pre>' + esc(storeErr) + '</pre><p>The connection works \u2014 we just need to store it. Send me this message.</p>'));
  } catch (e) {
    res.statusCode = 200;
    return res.end(page('QuickBooks error', '<pre>' + esc((e && e.cause && e.cause.message) || (e && e.message) || String(e)) + '</pre>'));
  }
};
