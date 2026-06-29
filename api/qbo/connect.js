// QuickBooks OAuth2 connect. Append ?debug=1 to inspect what is sent. Redirect URI follows the real host (www-safe).
function esc(s){ return String(s).replace(/[&<>]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]; }); }
function calcRedirect(req){
  var host = (req.headers && req.headers.host) || '';
  if (host && host.indexOf('.') >= 0) return 'https://' + host + '/api/qbo/callback';
  return (process.env.QBO_REDIRECT_URI || 'https://orchamind.com/api/qbo/callback').trim();
}
module.exports = async (req, res) => {
  var CID = (process.env.QBO_CLIENT_ID || '').trim();
  var CS  = (process.env.QBO_CLIENT_SECRET || '').trim();
  var REDIRECT = calcRedirect(req);
  var host = (req.headers && req.headers.host) || '';
  var url; try { url = new URL(req.url, 'https://orchamind.com'); } catch(e){ url = null; }
  var debug = url && url.searchParams.get('debug');
  var state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var authUrl = 'https://appcenter.intuit.com/connect/oauth2'
    + '?client_id=' + encodeURIComponent(CID)
    + '&response_type=code&scope=' + encodeURIComponent('com.intuit.quickbooks.accounting')
    + '&redirect_uri=' + encodeURIComponent(REDIRECT)
    + '&state=' + encodeURIComponent(state);

  if (!CID) { res.statusCode = 500; res.setHeader('Content-Type','text/html'); return res.end('<h2>QBO_CLIENT_ID is missing in Vercel.</h2>'); }

  if (debug) {
    res.statusCode = 200; res.setHeader('Content-Type','text/html');
    var secNote = CS.length === 0 ? ' <b>&larr; MISSING! Add QBO_CLIENT_SECRET in Vercel and redeploy.</b>' : '';
    return res.end(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0A1628;color:#fff;padding:28px;line-height:1.7;}'
      + 'b{color:#F9A825;}code{background:#13243d;padding:3px 7px;border-radius:5px;word-break:break-all;display:inline-block;}a{color:#2D7FF9;font-weight:700;}.row{margin:14px 0;}</style>'
      + '<h2>QuickBooks connect &mdash; debug</h2>'
      + '<div class="row">Request host: <code>' + esc(host) + '</code></div>'
      + '<div class="row">client_id length: <b>' + CID.length + '</b></div>'
      + '<div class="row">client_secret length: <b>' + CS.length + '</b>' + secNote + '</div>'
      + '<div class="row">redirect_uri being sent: <code>' + esc(REDIRECT) + '</code><br><span style="color:#9bb8e0">This must be registered in Intuit (Development tab), same as the client_id.</span></div>'
      + '<div class="row">Full authorize URL:<br><code>' + esc(authUrl) + '</code></div>'
      + '<div class="row"><a href="' + esc(authUrl) + '">&rarr; Proceed to Intuit now</a></div>'
    );
  }
  res.setHeader('Set-Cookie', 'qbo_state=' + state + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
  res.statusCode = 302; res.setHeader('Location', authUrl); res.end();
};
