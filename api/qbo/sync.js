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

// Orchamind -> QuickBooks manual sync: turn a job's logged materials into QuickBooks Bills.
// Idempotent: every synced material is recorded in qbo_synced so re-clicking never double-posts.
var https = require('https');
function httpReq(method, urlStr, headers, bodyStr){
  return new Promise(function(resolve, reject){
    var u; try { u = new URL(urlStr); } catch(e){ return reject(e); }
    var data = bodyStr || '';
    var opts = { method: method, hostname: u.hostname, port: 443, path: u.pathname + (u.search || ''),
      headers: Object.assign({}, headers, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) };
    var rq = https.request(opts, function(resp){ var b=''; resp.on('data',function(c){b+=c;}); resp.on('end',function(){ resolve({status:resp.statusCode,text:b}); }); });
    rq.on('error', reject);
    rq.setTimeout(20000, function(){ rq.destroy(new Error('timeout')); });
    if (data) rq.write(data); rq.end();
  });
}
function jparse(s){ try{ return JSON.parse(s||'{}'); }catch(e){ return {}; } }

var SB_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
function sbKey(){ return (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim(); }
function qboBase(){ return (process.env.QBO_API_BASE || 'https://sandbox-quickbooks.api.intuit.com').trim().replace(/\/$/,''); }

async function getToken(SB_KEY, owner){
  var gr = await httpReq('GET', SB_URL + '/rest/v1/qbo_tokens?id=eq.' + encodeURIComponent(owner) + '&select=*',
    { 'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Accept':'application/json' });
  var rows = jparse(gr.text); if(!Array.isArray(rows)||!rows.length) return null;
  var t = rows[0];
  var expired = !t.expires_at || Date.now() > (Number(t.expires_at)-60000);
  if (expired && t.refresh_token){
    var CID=(process.env.QBO_CLIENT_ID||'').trim(), CS=(process.env.QBO_CLIENT_SECRET||'').trim();
    var basic = Buffer.from(CID+':'+CS).toString('base64');
    var rr = await httpReq('POST','https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      {'Authorization':'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
      'grant_type=refresh_token&refresh_token='+encodeURIComponent(t.refresh_token));
    // one retry on transient (5xx / network) failures
    if (!rr || rr.status >= 500) {
      await new Promise(function(r){ setTimeout(r, 800); });
      try {
        rr = await httpReq('POST','https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
          {'Authorization':'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
          'grant_type=refresh_token&refresh_token='+encodeURIComponent(t.refresh_token));
      } catch(e2){}
    }
    var nt = jparse(rr.text);
    // refresh token expired or revoked -> user must reconnect
    if (!nt.access_token && (String(rr.text||'').indexOf('invalid_grant') >= 0 || rr.status === 400)) { return { _reauth: true }; }
    if(nt.access_token){
      t.access_token = nt.access_token;
      var row = JSON.stringify({ id:owner, realm_id:t.realm_id, access_token:nt.access_token, refresh_token:nt.refresh_token||t.refresh_token, expires_at:Date.now()+((nt.expires_in||3600)*1000), updated_at:new Date().toISOString() });
      await httpReq('POST', SB_URL+'/rest/v1/qbo_tokens?on_conflict=id',
        {'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'}, row);
    }
  }
  return t;
}
async function qboQuery(base, realm, token, sql){
  var r = await httpReq('GET', base+'/v3/company/'+encodeURIComponent(realm)+'/query?minorversion=70&query='+encodeURIComponent(sql),
    {'Authorization':'Bearer '+token,'Accept':'application/json'});
  return { status:r.status, body:jparse(r.text), raw:r.text };
}
async function ensureVendor(base, realm, token, name, cache){
  var key=(name||'Job Materials').toLowerCase();
  if(cache[key]) return cache[key];
  var safe=String(name||'Job Materials').replace(/'/g,"\\'");
  var q = await qboQuery(base, realm, token, "select Id, DisplayName from Vendor where DisplayName = '"+safe+"'");
  var v = q.body && q.body.QueryResponse && q.body.QueryResponse.Vendor;
  if(v && v.length){ cache[key]=v[0].Id; return v[0].Id; }
  var cr = await httpReq('POST', base+'/v3/company/'+encodeURIComponent(realm)+'/vendor?minorversion=70',
    {'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json'},
    JSON.stringify({DisplayName:String(name||'Job Materials').slice(0,100)}));
  var cj=jparse(cr.text);
  if(cj.Vendor && cj.Vendor.Id){ cache[key]=cj.Vendor.Id; return cj.Vendor.Id; }
  throw new Error('Could not find or create vendor "'+(name||'Job Materials')+'": '+String(cr.text).slice(0,200));
}
async function expenseAccount(base, realm, token, cacheObj){
  if(cacheObj.id) return cacheObj.id;
  var tries=["select Id, Name from Account where AccountType = 'Cost of Goods Sold' maxresults 1",
             "select Id, Name from Account where AccountType = 'Expense' maxresults 1"];
  for(var i=0;i<tries.length;i++){
    var q=await qboQuery(base, realm, token, tries[i]);
    var a=q.body && q.body.QueryResponse && q.body.QueryResponse.Account;
    if(a && a.length){ cacheObj.id=a[0].Id; cacheObj.name=a[0].Name; return a[0].Id; }
  }
  throw new Error('No expense or cost-of-goods-sold account found in QuickBooks.');
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type','application/json');
  res.setHeader('Cache-Control','no-store');
  function send(obj, code){ res.statusCode=code||200; res.end(JSON.stringify(obj)); }
  try{
    if(req.method!=='POST') return send({ok:false,error:'POST only'},405);
    var body=''; await new Promise(function(r){ req.on('data',function(c){body+=c;}); req.on('end',r); });
    var inp=jparse(body);
    var owner = sessUser(req);
    if(!owner) return send({ok:false,error:'Please log in again.'},401);
    var jobId=String(inp.jobId||''), jobName=String(inp.jobName||'Job'), uname=owner;
    var mats=Array.isArray(inp.materials)?inp.materials:[];
    if(!mats.length) return send({ok:false,error:'No materials to sync.'});
    var SB_KEY=sbKey();
    if(!SB_KEY) return send({ok:false,error:'Server not configured (Supabase key missing).'},500);
    var t=await getToken(SB_KEY, owner);
    if(t && t._reauth) return send({ok:false,notConnected:true,error:'Your QuickBooks connection has expired. Please reconnect.'});
    if(!t || !t.access_token) return send({ok:false,notConnected:true,error:'QuickBooks is not connected yet.'});
    var base=qboBase(), realm=t.realm_id, token=t.access_token;
    var vcache={}, acache={};
    var results=[], synced=0, skipped=0, errors=0;
    for(var i=0;i<mats.length;i++){
      var m=mats[i]||{};
      var mid=String(m.id||('m'+i));
      var key=uname+':'+jobId+':'+mid;
      try{
        // idempotency: already synced?
        var chk=await httpReq('GET', SB_URL+'/rest/v1/qbo_synced?id=eq.'+encodeURIComponent(key)+'&select=id,bill_id',
          {'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Accept':'application/json'});
        var existing=jparse(chk.text);
        if(Array.isArray(existing)&&existing.length){ results.push({id:mid,status:'skipped',billId:existing[0].bill_id}); skipped++; continue; }
        var cost=parseFloat(m.cost)||0;
        if(cost<=0){ results.push({id:mid,status:'error',error:'no cost'}); errors++; continue; }
        var vendorId=await ensureVendor(base, realm, token, m.vendor, vcache);
        var acctId=await expenseAccount(base, realm, token, acache);
        var desc=String((m.qty?m.qty+' ':'')+(m.item||'Materials')).slice(0,200);
        var bill={ VendorRef:{value:vendorId}, PrivateNote:('Orchamind sync · '+jobName+' · key:'+key),
          Line:[{ DetailType:'AccountBasedExpenseLineDetail', Amount:cost, Description:desc,
            AccountBasedExpenseLineDetail:{ AccountRef:{value:acctId} } }] };
        var br=await httpReq('POST', base+'/v3/company/'+encodeURIComponent(realm)+'/bill?minorversion=70',
          {'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json'}, JSON.stringify(bill));
        var bj=jparse(br.text);
        if(bj.Bill && bj.Bill.Id){
          var billId=bj.Bill.Id;
          await httpReq('POST', SB_URL+'/rest/v1/qbo_synced',
            {'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},
            JSON.stringify({id:key, bill_id:billId, realm_id:realm, job_id:jobId, created_at:new Date().toISOString()}));
          results.push({id:mid,status:'synced',billId:billId}); synced++;
        } else {
          var fault=(bj.Fault&&bj.Fault.Error&&bj.Fault.Error[0]&&(bj.Fault.Error[0].Message+' '+(bj.Fault.Error[0].Detail||'')))||String(br.text).slice(0,200);
          results.push({id:mid,status:'error',error:fault}); errors++;
        }
      }catch(ie){ results.push({id:mid,status:'error',error:(ie&&ie.message)||String(ie)}); errors++; }
    }
    return send({ok:true, realm:realm, account:acache.name||null, summary:{synced:synced,skipped:skipped,errors:errors}, results:results});
  }catch(e){ return send({ok:false,error:(e&&e.message)||String(e)},200); }
};
