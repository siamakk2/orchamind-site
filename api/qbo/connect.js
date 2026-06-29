// Starts the QuickBooks Online OAuth2 handshake. Append ?debug=1 to inspect exactly what is sent.
function esc(s){ return String(s).replace(/[&<>]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]; }); }
module.exports = async (req, res) => {
  var CID = process.env.QBO_CLIENT_ID || '';
  var REDIRECT = process.env.QBO_REDIRECT_URI || 'https://orchamind.com/api/qbo/callback';
  var url; try { url = new URL(req.url, 'https://orchamind.com'); } catch(e){ url = null; }
  var debug = url && url.searchParams.get('debug');
  var host = (req.headers && req.headers.host) || '';
  var state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var scope = 'com.intuit.quickbooks.accounting';
  var authUrl = 'https://appcenter.intuit.com/connect/oauth2'
    + '?client_id=' + encodeURIComponent(CID)
    + '&response_type=code'
    + '&scope=' + encodeURIComponent(scope)
    + '&redirect_uri=' + encodeURIComponent(REDIRECT)
    + '&state=' + encodeURIComponent(state);

  if (!CID) {
    res.statusCode = 500; res.setHeader('Content-Type','text/html');
    return res.end('<h2>QBO_CLIENT_ID is missing in Vercel.</h2><p>Add it (and QBO_CLIENT_SECRET, QBO_REDIRECT_URI), then redeploy.</p>');
  }

  if (debug) {
    res.statusCode = 200; res.setHeader('Content-Type','text/html');
    var cidShown = CID.length > 16 ? (CID.slice(0,8) + '\u2026' + CID.slice(-6)) : CID;
    var trimmedNote = (CID !== CID.trim()) ? ' <b>WARNING: client_id has leading/trailing whitespace!</b>' : '';
    return res.end(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0A1628;color:#fff;padding:28px;line-height:1.7;}'
      + 'b{color:#F9A825;}code{background:#13243d;padding:3px 7px;border-radius:5px;word-break:break-all;display:inline-block;}'
      + 'a{color:#2D7FF9;font-weight:700;} .row{margin:14px 0;}</style>'
      + '<h2>QuickBooks connect &mdash; debug</h2>'
      + '<div class="row">Request host: <code>' + esc(host) + '</code></div>'
      + '<div class="row">client_id length: <b>' + CID.length + '</b>' + trimmedNote + '<br>client_id: <code>' + esc(cidShown) + '</code></div>'
      + '<div class="row">redirect_uri being sent: <code>' + esc(REDIRECT) + '</code></div>'
      + '<div class="row"><b>That redirect_uri must be registered in Intuit EXACTLY, in the SAME Development/Production tab as this client_id.</b> If your site is on <code>www.orchamind.com</code>, register both the www and non-www versions.</div>'
      + '<div class="row">Full authorize URL:<br><code>' + esc(authUrl) + '</code></div>'
      + '<div class="row"><a href="' + esc(authUrl) + '">&rarr; Proceed to Intuit now</a></div>'
    );
  }

  res.setHeader('Set-Cookie', 'qbo_state=' + state + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
  res.statusCode = 302;
  res.setHeader('Location', authUrl);
  res.end();
};
