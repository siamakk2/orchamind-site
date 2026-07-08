// QuickBooks disconnect: revokes the token with Intuit and removes the saved connection for the signed-in contractor.
var crypto = require('crypto');
var https = require('https');
function esc(s){ return String(s).replace(/[&<>]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]; }); }
function _sbSecret(){ return (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim(); }
function sessUser(req){
  try{
    var KEY=_sbSecret(); if(!KEY) return null;
    var c=(req.headers && req.headers.cookie) || '';
    var m=c.match(/(?:^|;\s*)orcha_sess=([^;]+)/); if(!m) return null;
    var p=decodeURIComponent(m[1]).split('|'); if(p.length!==4) return null;
    var sig=crypto.createHmac('sha256',KEY).update(p[0]+'|'+p[1]+'|'+p[2]).digest('hex');
    if(sig!==p[3]) return null;
    if(Date.now()>Number(p[2])) return null;
    if(p[1]==='demo') return null;
    return p[0];
  }catch(e){ return null; }
}
function httpReq(method, urlStr, headers, bodyStr){
  return new Promise(function(resolve, reject){
    var u; try { u = new URL(urlStr); } catch(e){ return reject(e); }
    var data = bodyStr || '';
    var opts = { method: method, hostname: u.hostname, port: 443, path: u.pathname + (u.search || ''),
      headers: Object.assign({}, headers, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) };
    var rq = https.request(opts, function(resp){ var buf=''; resp.on('data',function(c){buf+=c;}); resp.on('end',function(){ resolve({status:resp.statusCode,text:buf}); }); });
    rq.on('error', reject);
    rq.setTimeout(15000, function(){ rq.destroy(new Error('timeout')); });
    if (data) rq.write(data);
    rq.end();
  });
}
function page(title, bodyHtml){
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0A1628;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;}'
    + '.card{background:#13243d;border:1px solid #24395c;border-radius:16px;padding:32px;max-width:520px;}h2{margin:0 0 10px;}a{color:#2D7FF9;font-weight:700;text-decoration:none;}.ok{color:#34D399;}.bad{color:#F87171;}p{line-height:1.6;color:#c7d6ea;}</style>'
    + '<div class="card"><h2>' + title + '</h2>' + bodyHtml + '</div>';
}
module.exports = async (req, res) => {
  res.setHeader('Content-Type','text/html');
  res.setHeader('Cache-Control','no-store');
  try {
    var uname = sessUser(req);
    if (!uname) { res.statusCode = 200; return res.end(page('Please sign in first', '<p>Sign in to Orchamind to disconnect QuickBooks from your account.</p><p><a href="/app">Go to Orchamind &rarr;</a></p>')); }
    var SB_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
    var SB_KEY = _sbSecret();
    if (!SB_KEY) { res.statusCode = 200; return res.end(page('Cannot disconnect', '<p class="bad">Server is not configured.</p>')); }
    var SH = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Accept': 'application/json' };

    // read the saved token for this contractor
    var tok = null;
    try {
      var gr = await httpReq('GET', SB_URL + '/rest/v1/qbo_tokens?id=eq.' + encodeURIComponent(uname) + '&select=*', SH);
      var rows = JSON.parse(gr.text || '[]');
      if (Array.isArray(rows) && rows.length) tok = rows[0];
    } catch (e) {}

    if (!tok) { res.statusCode = 200; return res.end(page('Already disconnected', '<p>There is no QuickBooks connection saved for your account.</p><p><a href="/app">Back to Orchamind &rarr;</a></p>')); }

    // best-effort: revoke with Intuit
    var revoked = false;
    try {
      var CID = (process.env.QBO_CLIENT_ID || '').trim(), CS = (process.env.QBO_CLIENT_SECRET || '').trim();
      if (CID && CS) {
        var basic = Buffer.from(CID + ':' + CS).toString('base64');
        var rr = await httpReq('POST', 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
          { 'Authorization': 'Basic ' + basic, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          JSON.stringify({ token: tok.refresh_token || tok.access_token }));
        if (rr.status >= 200 && rr.status < 300) revoked = true;
      }
    } catch (e) {}

    // remove the stored connection
    var removed = false;
    try {
      var dr = await httpReq('DELETE', SB_URL + '/rest/v1/qbo_tokens?id=eq.' + encodeURIComponent(uname),
        { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' });
      if (dr.status >= 200 && dr.status < 300) removed = true;
    } catch (e) {}

    res.statusCode = 200;
    if (removed) {
      return res.end(page('\u2713 QuickBooks disconnected', '<p class="ok">Your QuickBooks connection has been removed' + (revoked ? ' and the access token was revoked with Intuit' : '') + '.</p><p>No further data will sync. You can reconnect any time.</p><p><a href="/api/qbo/connect">Reconnect QuickBooks</a> &nbsp;&middot;&nbsp; <a href="/app">Back to Orchamind &rarr;</a></p>'));
    }
    return res.end(page('Could not fully disconnect', '<p class="bad">We could not remove the saved connection. Please try again, or contact info@siamakkalhor.com.</p><p><a href="/app">Back to Orchamind &rarr;</a></p>'));
  } catch (e) {
    res.statusCode = 200;
    return res.end(page('Error', '<p class="bad">' + esc((e && e.message) || String(e)) + '</p>'));
  }
};
