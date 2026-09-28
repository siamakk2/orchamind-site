var crypto = require('crypto');
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

// QuickBooks connection status check: reads saved token, refreshes if needed, pings QBO CompanyInfo.
var https = require('https');
function esc(s){ return String(s).replace(/[&<>]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]; }); }
// Same resolver as sync.js — the status page MUST ping the company syncs actually write to,
// otherwise "Live connection confirmed" confirms a company nobody is posting bills into.
function qboBase(){ return (process.env.QBO_API_BASE || '').trim().replace(/\/$/,''); }
function qboMode(base){ return /(^|\/\/)sandbox-/i.test(String(base||'')) ? 'SANDBOX' : 'PRODUCTION'; }
function httpReq(method, urlStr, headers, bodyStr){
  return new Promise(function(resolve, reject){
    var u; try { u = new URL(urlStr); } catch(e){ return reject(e); }
    var data = bodyStr || '';
    var opts = { method: method, hostname: u.hostname, port: 443, path: u.pathname + (u.search || ''),
      headers: Object.assign({}, headers, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) };
    var rq = https.request(opts, function(resp){
      var buf = ''; resp.on('data', function(c){ buf += c; }); resp.on('end', function(){ resolve({ status: resp.statusCode, text: buf }); });
    });
    rq.on('error', function(err){ reject(err); });
    rq.setTimeout(15000, function(){ rq.destroy(new Error('timeout')); });
    if (data) rq.write(data); rq.end();
  });
}
function page(title, bodyHtml){
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0A1628;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;}'
    + '.card{background:#13243d;border:1px solid #24395c;border-radius:16px;padding:32px;max-width:560px;}h2{margin:0 0 10px;}a{color:#2D7FF9;font-weight:700;text-decoration:none;}b{color:#F9A825;}pre{white-space:pre-wrap;word-break:break-word;background:#0a1628;padding:12px;border-radius:8px;color:#9bb8e0;font-size:12px;}.ok{color:#34D399;}.bad{color:#F87171;}</style>'
    + '<div class="card"><h2>' + title + '</h2>' + bodyHtml + '</div>';
}
module.exports = async (req, res) => {
  res.setHeader('Content-Type','text/html');
  res.setHeader('Cache-Control','no-store');
  try {
    var SB_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
    var SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    if (!SB_KEY) { res.statusCode=200; return res.end(page('Can\u2019t check', '<p class="bad">No Supabase key in env.</p>')); }
    // 1) read saved token
    var _u = sessUser(req);
    if (!_u) { res.statusCode=200; return res.end(page('Please sign in first', '<p>Log in to Orchamind to see <b>your</b> QuickBooks connection.</p><p><a href="/app">Go to Orchamind &rarr;</a></p>')); }
    var gr = await httpReq('GET', SB_URL + '/rest/v1/qbo_tokens?id=eq.' + encodeURIComponent(_u) + '&select=*',
      { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Accept':'application/json' });
    var rows; try { rows = JSON.parse(gr.text||'[]'); } catch(e){ rows = []; }
    if (gr.status<200 || gr.status>=300) { res.statusCode=200; return res.end(page('Can\u2019t read token', '<pre>HTTP '+esc(String(gr.status))+' '+esc(String(gr.text).slice(0,300))+'</pre>')); }
    if (!rows || !rows.length) { res.statusCode=200; return res.end(page('Not connected yet', '<p class="bad">No saved QuickBooks token found.</p><p><a href="/api/qbo/connect">Connect QuickBooks \u2192</a></p>')); }
    var t = rows[0];
    var realm = t.realm_id || '';
    var access = t.access_token || '';
    var expEpoch = Number(t.expires_at||0);
    var expired = !expEpoch || Date.now() > (expEpoch - 60000);
    var refreshed = false, refreshNote = '';
    // 2) refresh if expired
    if (expired && t.refresh_token) {
      var CID=(process.env.QBO_CLIENT_ID||'').trim(), CS=(process.env.QBO_CLIENT_SECRET||'').trim();
      var basic = Buffer.from(CID+':'+CS).toString('base64');
      var rbody = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(t.refresh_token);
      try {
        var rr = await httpReq('POST','https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
          { 'Authorization':'Basic '+basic, 'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json' }, rbody);
        var nt; try { nt = JSON.parse(rr.text||'{}'); } catch(e){ nt={}; }
        if (nt.access_token) {
          access = nt.access_token; refreshed = true;
          var row = JSON.stringify({ id:_u, realm_id: realm, access_token: nt.access_token, refresh_token: nt.refresh_token||t.refresh_token, expires_at: Date.now()+((nt.expires_in||3600)*1000), updated_at:new Date().toISOString() });
          await httpReq('POST', SB_URL + '/rest/v1/qbo_tokens?on_conflict=id',
            { 'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates' }, row);
        } else { refreshNote = 'Refresh returned HTTP '+rr.status+' '+String(rr.text).slice(0,200); }
      } catch(re){ refreshNote = 'Refresh error: '+((re&&re.message)||String(re)); }
    }
    // 3) ping QBO CompanyInfo on the SAME host sync.js writes to
    var qbHost = qboBase();
    var qbModeLabel = qboMode(qbHost);
    if (!qbHost) {
      res.statusCode = 200;
      return res.end(page('QuickBooks not configured',
        '<p class="bad">A token is saved, but <b>QBO_API_BASE</b> is not set on the server.</p>'
        + '<p>Without it there is no way to tell which QuickBooks company to read or write &mdash; so this check will not guess, and syncing is blocked until it is set.</p>'
        + '<p>Set it in Vercel &rarr; Project &rarr; Settings &rarr; Environment Variables to one of:</p>'
        + '<pre>https://quickbooks.api.intuit.com            (real books)\nhttps://sandbox-quickbooks.api.intuit.com    (sandbox)</pre>'
        + '<p>Then redeploy and reload this page.</p>'));
    }
    var pingUrl = qbHost + '/v3/company/' + encodeURIComponent(realm) + '/companyinfo/' + encodeURIComponent(realm) + '?minorversion=70';
    var company = '', live = false, pingNote = '';
    try {
      var pr = await httpReq('GET', pingUrl, { 'Authorization':'Bearer '+access, 'Accept':'application/json' });
      if (pr.status>=200 && pr.status<300) {
        live = true;
        try { var pj = JSON.parse(pr.text||'{}'); company = (pj.CompanyInfo && pj.CompanyInfo.CompanyName) || ''; } catch(e){}
      } else { pingNote = 'HTTP '+pr.status+' '+String(pr.text).slice(0,240); }
    } catch(pe){ pingNote = (pe&&pe.message)||String(pe); }

    var saved = new Date(t.updated_at||Date.now()).toString();
    var modeBanner = (qbModeLabel === 'SANDBOX')
      ? '<p style="background:#4a2c00;border:1px solid #b45309;border-radius:8px;padding:10px 12px"><b style="color:#fbbf24">⚠ SANDBOX</b> &mdash; bills sync to an Intuit test company, <b>not</b> your real books. Nothing here reaches your accountant.</p>'
      : '<p style="background:#06301f;border:1px solid #15803d;border-radius:8px;padding:10px 12px"><b style="color:#34D399">PRODUCTION</b> &mdash; bills sync to your real QuickBooks company.</p>';
    var body = modeBanner
      + '<p>API host: <code>'+esc(qbHost)+'</code></p>'
      + '<p>Realm (company id): <b>'+esc(realm)+'</b></p>'
      + '<p>Token saved: '+esc(saved)+'</p>'
      + '<p>Token state: '+(expired? (refreshed?'<span class="ok">was expired \u2014 auto-refreshed \u2713</span>':'<span class="bad">expired</span>') : '<span class="ok">valid</span>')+'</p>'
      + (refreshNote? '<pre>'+esc(refreshNote)+'</pre>' : '')
      + '<hr style="border-color:#24395c">'
      + (live
          ? '<p class="ok"><b style="color:#34D399">\u2713 Live connection confirmed.</b></p><p>QuickBooks answered as company: <b>'+esc(company||'(name hidden)')+'</b>. The link is real and working.</p>'
          : '<p class="bad">Token is stored, but the live ping didn\u2019t succeed:</p><pre>'+esc(pingNote)+'</pre><p>(If this says HTTP 401, the token just needs a reconnect at <a href="/api/qbo/connect">/api/qbo/connect</a>.)</p>');
    res.statusCode=200; return res.end(page(live?('\u2713 QuickBooks is connected \u2014 '+qbModeLabel):'QuickBooks status', body));
  } catch(e){
    res.statusCode=200; return res.end(page('Status check error','<pre>'+esc((e&&e.message)||String(e))+'</pre>'));
  }
};
