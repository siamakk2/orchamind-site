// QuickBooks connection status check: reads saved token, refreshes if needed, pings QBO CompanyInfo.
var https = require('https');
function esc(s){ return String(s).replace(/[&<>]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]; }); }
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
    var gr = await httpReq('GET', SB_URL + '/rest/v1/qbo_tokens?id=eq.default&select=*',
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
          var row = JSON.stringify({ id:'default', realm_id: realm, access_token: nt.access_token, refresh_token: nt.refresh_token||t.refresh_token, expires_at: Date.now()+((nt.expires_in||3600)*1000), updated_at:new Date().toISOString() });
          await httpReq('POST', SB_URL + '/rest/v1/qbo_tokens?on_conflict=id',
            { 'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates' }, row);
        } else { refreshNote = 'Refresh returned HTTP '+rr.status+' '+String(rr.text).slice(0,200); }
      } catch(re){ refreshNote = 'Refresh error: '+((re&&re.message)||String(re)); }
    }
    // 3) ping QBO CompanyInfo (sandbox endpoint for Development keys)
    var qbHost = 'https://sandbox-quickbooks.api.intuit.com';
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
    var body = '<p>Realm (company id): <b>'+esc(realm)+'</b></p>'
      + '<p>Token saved: '+esc(saved)+'</p>'
      + '<p>Token state: '+(expired? (refreshed?'<span class="ok">was expired \u2014 auto-refreshed \u2713</span>':'<span class="bad">expired</span>') : '<span class="ok">valid</span>')+'</p>'
      + (refreshNote? '<pre>'+esc(refreshNote)+'</pre>' : '')
      + '<hr style="border-color:#24395c">'
      + (live
          ? '<p class="ok"><b style="color:#34D399">\u2713 Live connection confirmed.</b></p><p>QuickBooks answered as company: <b>'+esc(company||'(name hidden)')+'</b>. The link is real and working.</p>'
          : '<p class="bad">Token is stored, but the live ping didn\u2019t succeed:</p><pre>'+esc(pingNote)+'</pre><p>(If this says HTTP 401, the token just needs a reconnect at <a href="/api/qbo/connect">/api/qbo/connect</a>.)</p>');
    res.statusCode=200; return res.end(page(live?'\u2713 QuickBooks is connected':'QuickBooks status', body));
  } catch(e){
    res.statusCode=200; return res.end(page('Status check error','<pre>'+esc((e&&e.message)||String(e))+'</pre>'));
  }
};
