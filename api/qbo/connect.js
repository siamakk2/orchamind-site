// Starts the QuickBooks Online OAuth2 handshake -> redirects the owner to Intuit to authorize.
module.exports = async (req, res) => {
  var CID = process.env.QBO_CLIENT_ID;
  var REDIRECT = process.env.QBO_REDIRECT_URI || 'https://orchamind.com/api/qbo/callback';
  if (!CID) { res.statusCode = 500; res.setHeader('Content-Type','text/html'); return res.end('<h2>QuickBooks is not configured.</h2><p>Add QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI in Vercel, then redeploy.</p>'); }
  var state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var scope = 'com.intuit.quickbooks.accounting';
  var url = 'https://appcenter.intuit.com/connect/oauth2'
    + '?client_id=' + encodeURIComponent(CID)
    + '&response_type=code'
    + '&scope=' + encodeURIComponent(scope)
    + '&redirect_uri=' + encodeURIComponent(REDIRECT)
    + '&state=' + encodeURIComponent(state);
  res.setHeader('Set-Cookie', 'qbo_state=' + state + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
};
