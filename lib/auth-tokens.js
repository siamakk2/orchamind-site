// Small signed tokens shared by api/oauth.js and api/accounts.js.
// HMAC-SHA256 with the server's Supabase key (the same secret that signs the
// session cookie), so nothing new has to be configured.

var crypto = require('crypto');

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64url'); }
function unb64(s) { try { return Buffer.from(String(s), 'base64url').toString('utf8'); } catch (e) { return ''; } }
function hmac(secret, s) { return crypto.createHmac('sha256', secret).update(s).digest('base64url'); }
function same(a, b) {
  a = Buffer.from(String(a)); b = Buffer.from(String(b));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// kind keeps one token type from ever being accepted as another.
function make(secret, kind, data, ttlMs) {
  var body = b64(JSON.stringify({ k: kind, d: data, x: Date.now() + ttlMs }));
  return body + '.' + hmac(secret, kind + '.' + body);
}
function read(secret, kind, tok) {
  if (!secret || !tok || typeof tok !== 'string') return null;
  var i = tok.lastIndexOf('.');
  if (i < 1) return null;
  var body = tok.slice(0, i), sig = tok.slice(i + 1);
  if (!same(sig, hmac(secret, kind + '.' + body))) return null;
  var o; try { o = JSON.parse(unb64(body)); } catch (e) { return null; }
  if (!o || o.k !== kind || !(Date.now() < o.x)) return null;
  return o.d;
}

module.exports = { make: make, read: read };
