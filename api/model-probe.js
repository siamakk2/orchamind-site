// Model probe — OPERATOR ONLY, diagnostic, touches nothing the app uses.
//
// This exists because I upgraded the estimator's model without ever once
// looking at what the new model actually returns, and broke plan reading in
// production. The lesson is not "be more careful"; it is "have an instrument".
//
// Point it at a model and it reports the RAW response shape: every content
// block's type and size, the stop reason, token usage, and whether the text
// parses as the JSON the estimator expects. It writes each result to Supabase
// so a run can be read back later instead of screenshotted.
//
// Nothing here is wired into demo.html. Breaking this file cannot break the app.

var crypto = require('crypto');

var OPERATOR = 'siamakk2';
var SB_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}

// The estimator's parser, reproduced here so the probe reports what the APP
// would do with this text, not what a lenient JSON.parse would do.
function estParseJSON(txt) {
  if (!txt) return null;
  var s = String(txt);
  var best = null, bestScore = -1;
  for (var i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    var depth = 0, inStr = false, escp = false;
    for (var j = i; j < s.length; j++) {
      var c = s[j];
      if (inStr) {
        if (escp) escp = false;
        else if (c === '\\') escp = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          var cand = s.slice(i, j + 1);
          try {
            var o = JSON.parse(cand.replace(/,\s*([}\]])/g, '$1'));
            var score = Object.keys(o || {}).length + cand.length / 1000;
            if (score > bestScore) { bestScore = score; best = o; }
          } catch (e) {}
          break;
        }
      }
    }
  }
  return best;
}

module.exports = async function handler(req, res) {
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var APIKEY = process.env.ANTHROPIC_API_KEY;

  function page(body) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Model probe</title><style>body{background:#0b1220;color:#dce6f5;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;'
      + 'margin:0;padding:24px 18px;max-width:900px}h1{font-size:18px;color:#fff;margin:0 0 4px}'
      + 'h2{font-size:15px;color:#7fb4ff;margin:24px 0 6px}.sub{color:#8da2bf;margin:0 0 18px}'
      + 'pre{background:#121b2b;border:1px solid #223247;border-radius:8px;padding:11px 13px;white-space:pre-wrap;word-break:break-word;overflow-x:auto}'
      + '.ok{color:#5fd39a}.bad{color:#ff8b7d}.warn{color:#ffc46b}table{border-collapse:collapse;width:100%}'
      + 'td,th{border-bottom:1px solid #223247;padding:5px 8px;text-align:left;font-size:13px}</style>' + body);
  }

  if (!KEY) return page('<h1>Not configured</h1><p>Supabase key missing.</p>');

  // Same signed-cookie gate as the support view.
  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  var c = req.headers.cookie || '';
  var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/);
  var sess = null;
  if (m) {
    var parts = decodeURIComponent(m[1]).split('|');
    if (parts.length === 4 && sign(parts[0] + '|' + parts[1] + '|' + parts[2]) === parts[3] && Date.now() <= Number(parts[2])) {
      sess = { username: parts[0] };
    }
  }
  if (!sess || sess.username !== OPERATOR) {
    res.statusCode = 403;
    return page('<h1>Not authorised</h1><p>Sign in as the operator account, then reload.</p>');
  }
  if (!APIKEY) return page('<h1>Not configured</h1><p>ANTHROPIC_API_KEY missing.</p>');

  var models = (req.query && req.query.model)
    ? [].concat(req.query.model)
    : ['claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-5-5'];
  var withEffort = !!(req.query && req.query.effort);

  // A prompt shaped like the estimator's: asks for JSON only, nothing else.
  var SYSTEM = 'You are a construction plan TRANSCRIBER. Return ONLY one JSON object, '
    + 'no markdown fences, no commentary before or after it.';
  var USER = 'Return this exact shape with plausible sample values: '
    + '{"totalPrintedSqft":number,"stories":number,"areaSchedule":[{"label":string,"sqft":number}],'
    + '"windows":[{"elevation":string,"count":number}],"roof":{"form":string}}';

  var out = [];
  for (var i = 0; i < models.length; i++) {
    var model = String(models[i]);
    var payload = { model: model, max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: USER }] };
    if (withEffort) payload.effort = 'medium';
    var started = Date.now();
    var row = { model: model, ms: 0 };
    try {
      var r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': APIKEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(payload)
      });
      var data = await r.json();
      row.ms = Date.now() - started;
      row.http = r.status;
      if (data && data.error) {
        row.error = (data.error.message || JSON.stringify(data.error)).slice(0, 400);
      } else {
        var blocks = Array.isArray(data.content) ? data.content : [];
        // THE question this probe exists to answer: what block types come back,
        // and is there any text in them?
        row.blockTypes = blocks.map(function (b) { return b && b.type; });
        row.blockSizes = blocks.map(function (b) {
          return b && b.type === 'text' ? String(b.text || '').length
               : JSON.stringify(b || {}).length;
        });
        row.stop = data.stop_reason;
        row.usage = data.usage || null;
        var text = blocks.filter(function (b) { return b && b.type === 'text'; })
                         .map(function (b) { return b.text; }).join('\n');
        row.textLen = text.length;
        row.textHead = text.slice(0, 700);
        var parsed = estParseJSON(text);
        row.parsed = !!parsed;
        row.parsedKeys = parsed ? Object.keys(parsed) : [];
      }
    } catch (e) {
      row.ms = Date.now() - started;
      row.error = (e && e.message) || String(e);
    }
    out.push(row);
    console.log('[probe] ' + model + ' ' + JSON.stringify({
      http: row.http, stop: row.stop, blocks: row.blockTypes, textLen: row.textLen, parsed: row.parsed, error: row.error
    }));
  }

  // Persist so a run can be read back from the database instead of a screenshot.
  try {
    await fetch(SB_URL + '/rest/v1/diag_runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY, Prefer: 'return=minimal' },
      body: JSON.stringify({ id: 'probe_' + Date.now().toString(36), kind: 'model-probe', result: out })
    });
  } catch (e) {}

  var rows = out.map(function (o) {
    if (o.error) {
      return '<h2>' + esc(o.model) + ' <span class="bad">FAILED</span></h2>'
        + '<pre class="bad">HTTP ' + esc(o.http || '-') + '\n' + esc(o.error) + '</pre>';
    }
    return '<h2>' + esc(o.model) + ' <span class="' + (o.parsed ? 'ok">PARSES' : 'bad">DOES NOT PARSE') + '</span></h2>'
      + '<table>'
      + '<tr><th>block types</th><td>' + esc(JSON.stringify(o.blockTypes)) + '</td></tr>'
      + '<tr><th>block sizes</th><td>' + esc(JSON.stringify(o.blockSizes)) + '</td></tr>'
      + '<tr><th>stop_reason</th><td>' + esc(o.stop) + '</td></tr>'
      + '<tr><th>text length</th><td class="' + (o.textLen ? 'ok' : 'bad') + '">' + o.textLen + '</td></tr>'
      + '<tr><th>estimator parses it</th><td class="' + (o.parsed ? 'ok">yes' : 'bad">NO') + '</td></tr>'
      + '<tr><th>keys found</th><td>' + esc(JSON.stringify(o.parsedKeys)) + '</td></tr>'
      + '<tr><th>usage</th><td>' + esc(JSON.stringify(o.usage)) + '</td></tr>'
      + '<tr><th>ms</th><td>' + o.ms + '</td></tr>'
      + '</table><pre>' + esc(o.textHead || '(no text returned)') + '</pre>';
  }).join('');

  return page('<h1>Model probe</h1>'
    + '<p class="sub">Asks each model for the estimator\'s JSON shape and reports the RAW response. '
    + 'Add <code>?effort=1</code> to also send the effort parameter. '
    + 'Nothing here is wired into the app.</p>' + rows);
};
