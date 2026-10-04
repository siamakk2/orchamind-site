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
  // Second door: a single-use token. The cookie gate means the probe can only be
  // run from a browser, which made verification depend on someone clicking --
  // and "I could not test it myself" is exactly how a broken estimator reached
  // production. A token unlocks THIS diagnostic and nothing else: no customer
  // data, no writes, one use, two hours.
  var tokenOk = false, tokenNote = '';
  var tok = (req.query && req.query.token) ? String(req.query.token) : '';
  if (!sess && tok && /^[a-f0-9]{32,64}$/.test(tok)) {
    try {
      var tr = await fetch(SB_URL + '/rest/v1/probe_tokens?token=eq.' + encodeURIComponent(tok) + '&select=*', {
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Accept: 'application/json' }
      });
      var rowsT = await tr.json();
      var trow = Array.isArray(rowsT) && rowsT[0];
      if (trow && !trow.used_at && new Date(trow.expires_at).getTime() > Date.now()) {
        tokenOk = true;
        tokenNote = trow.note || '';
        // Burn it immediately, before doing any work, so a retry cannot reuse it.
        await fetch(SB_URL + '/rest/v1/probe_tokens?token=eq.' + encodeURIComponent(tok), {
          method: 'PATCH',
          headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ used_at: new Date().toISOString() })
        });
      }
    } catch (e) {}
  }

  if (!(sess && sess.username === OPERATOR) && !tokenOk) {
    res.statusCode = 403;
    return page('<h1>Not authorised</h1><p>Sign in as the operator account, or supply a valid single-use token.</p>');
  }
  if (!APIKEY) return page('<h1>Not configured</h1><p>ANTHROPIC_API_KEY missing.</p>');

  var models = (req.query && req.query.model)
    ? [].concat(req.query.model)
    : ['claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-5-5'];
  var withEffort = !!(req.query && req.query.effort);
  var planMode = !!(req.query && req.query.plan);
  var maxTok = Math.min(parseInt((req.query && req.query.max) || '0', 10) || (planMode ? 10000 : 2000), 32000);
  // Production sends a tiled plan set, not one sheet. The easy single-sheet
  // case passed on every model and still did not reproduce the failure, so the
  // probe can repeat the sheet to recreate that pressure.
  var blocks = Math.min(Math.max(parseInt((req.query && req.query.blocks) || '1', 10) || 1, 1), 16);

  // ---- PLAN MODE: the real thing ------------------------------------------
  // Reads a synthetic sheet whose numbers we wrote ourselves, using the REAL
  // extraction prompt out of demo.html, at the REAL token budget. A probe that
  // uses a toy prompt proves nothing about the estimator.
  var TRUTH = {
    totalPrintedSqft: 2486, stories: 2,
    areaSchedule: { 'MAIN FLOOR': 1312, 'UPPER FLOOR': 1174, 'GARAGE': 484, 'COVERED PORCH': 168 },
    windowsTotal: 20, roof: 'gable'
  };
  async function realExtractSys() {
    // The serverless bundle does not contain demo.html, so reading it off disk
    // never worked -- the first run of this probe silently used the fallback and
    // said so, which is the only reason that was caught. Fetch the deployed page
    // instead: that is the prompt customers actually run.
    try {
      var dr = await fetch('https://orchamind.com/demo');
      if (dr.ok) {
        var src = await dr.text();
        var m2 = src.match(/function _planExtractSys\(\)\{([\s\S]*?)\n\}/);
        if (m2) {
          var fn = new Function('return (function(){' + m2[1] + '})()');
          var out2 = fn();
          if (typeof out2 === 'string' && out2.length > 500) {
            return { text: out2, source: 'live demo.html (' + out2.length + ' chars)' };
          }
        }
      }
    } catch (e) {}
    return { source: 'FALLBACK', text:
      'You are a construction plan TRANSCRIBER. Read what is PRINTED on these sheets and transcribe it exactly. '
      + 'Do NOT compute, estimate, price or infer. Find the printed AREA SCHEDULE and transcribe every row exactly '
      + '(label + square footage). totalPrintedSqft must be the CONDITIONED total only, never including garage, '
      + 'porch, patio or deck rows. READ NUMBERS DIGIT BY DIGIT: "1,312" is easily misread as "312" - re-read every '
      + 'area figure twice. Also transcribe: number of stories, per-elevation window counts, roof form, and every '
      + 'room name with its printed dimensions. Return ONLY one JSON object: '
      + '{"totalPrintedSqft":number|null,"stories":number|null,"areaSchedule":[{"label":string,"sqft":number}],'
      + '"windows":[{"elevation":string,"count":number}],"roof":{"form":string},"rooms":[{"name":string,"dims":string}]}' };
  }

  // A prompt shaped like the estimator's: asks for JSON only, nothing else.
  var SYSTEM = 'You are a construction plan TRANSCRIBER. Return ONLY one JSON object, '
    + 'no markdown fences, no commentary before or after it.';
  var USER = 'Return this exact shape with plausible sample values: '
    + '{"totalPrintedSqft":number,"stories":number,"areaSchedule":[{"label":string,"sqft":number}],'
    + '"windows":[{"elevation":string,"count":number}],"roof":{"form":string}}';

  var planImg = null, promptSource = '';
  if (planMode) {
    var ex = await realExtractSys();
    SYSTEM = ex.text; promptSource = ex.source;
    try {
      var ir = await fetch('https://orchamind.com/media/test-plan.png');
      if (!ir.ok) throw new Error('fixture HTTP ' + ir.status);
      var ab = await ir.arrayBuffer();
      planImg = Buffer.from(ab).toString('base64');
    } catch (e) {
      return page('<h1>Fixture unavailable</h1><pre class="bad">' + esc(e.message) + '</pre>'
        + '<p>/media/test-plan.png must be deployed before plan mode can run.</p>');
    }
  }

  function near(a, b, tol) {
    if (a == null || b == null) return false;
    return Math.abs(a - b) / Math.abs(b || 1) <= (tol == null ? 0.01 : tol);
  }
  function gradePlan(o) {
    if (!o) return { score: 0, of: 7, rows: [['parsed', false, '-', '-']] };
    var rows = [], hit = 0;
    function add(label, got, want, ok) { rows.push([label, ok, got, want]); if (ok) hit++; }
    add('totalPrintedSqft', o.totalPrintedSqft, TRUTH.totalPrintedSqft, near(o.totalPrintedSqft, TRUTH.totalPrintedSqft, 0.005));
    add('stories', o.stories, TRUTH.stories, Number(o.stories) === TRUTH.stories);
    var sched = {};
    (Array.isArray(o.areaSchedule) ? o.areaSchedule : []).forEach(function (r) {
      var k = String(r && (r.label || r.name) || '').toUpperCase().replace(/[^A-Z ]/g, '').trim();
      var v = Number(r && (r.sqft != null ? r.sqft : r.value));
      if (k) sched[k] = v;
    });
    ['MAIN FLOOR', 'UPPER FLOOR', 'GARAGE', 'COVERED PORCH'].forEach(function (k) {
      add('area: ' + k, sched[k], TRUTH.areaSchedule[k], near(sched[k], TRUTH.areaSchedule[k], 0.005));
    });
    var wt = null;
    if (Array.isArray(o.windows)) wt = o.windows.reduce(function (s2, w) { return s2 + (Number(w && (w.count != null ? w.count : w.qty)) || 0); }, 0);
    else if (typeof o.windows === 'number') wt = o.windows;
    add('windows total', wt, TRUTH.windowsTotal, Number(wt) === TRUTH.windowsTotal);
    return { score: hit, of: rows.length, rows: rows };
  }

  var out = [];
  for (var i = 0; i < models.length; i++) {
    var model = String(models[i]);
    var content = USER;
    if (planMode) {
      content = [];
      for (var b = 0; b < blocks; b++) {
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: planImg } });
      }
      content.push({ type: 'text', text: 'Transcribe ' + (blocks > 1 ? ('these ' + blocks + ' plan sheets') : 'this plan sheet')
        + ' per your instructions. JSON only.' });
    }
    var payload = { model: model, max_tokens: maxTok, system: SYSTEM, messages: [{ role: 'user', content: content }] };
    if (withEffort) payload.effort = 'medium';
    var started = Date.now();
    var row = { model: model, ms: 0, blocks: planMode ? blocks : 0 };
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
        if (planMode) row.grade = gradePlan(parsed);
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

  if (req.query && req.query.json) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({
      ok: true, planMode: planMode, blocks: planMode ? blocks : 0,
      maxTokens: maxTok, promptSource: promptSource, note: tokenNote, results: out
    }, null, 2));
  }

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
      + (o.blocks ? '<tr><th>image blocks sent</th><td>' + o.blocks + '</td></tr>' : '')
      + '</table>'
      + (o.grade ? ('<table><tr><th>field</th><th>got</th><th>should be</th></tr>'
          + o.grade.rows.map(function (r2) {
              return '<tr><td class="' + (r2[1] ? 'ok' : 'bad') + '">' + (r2[1] ? '\u2713 ' : '\u2717 ') + esc(r2[0]) + '</td>'
                   + '<td>' + esc(r2[2]) + '</td><td>' + esc(r2[3]) + '</td></tr>'; }).join('')
          + '</table><p class="' + (o.grade.score === o.grade.of ? 'ok' : 'bad') + '">'
          + o.grade.score + ' of ' + o.grade.of + ' printed values read correctly</p>') : '')
      + '<pre>' + esc(o.textHead || '(no text returned)') + '</pre>';
  }).join('');

  var srcNote = planMode
    ? ('<p class="' + (promptSource.indexOf('live') === 0 ? 'ok' : 'warn') + '">Extraction prompt source: <b>'
       + esc(promptSource) + '</b>' + (promptSource.indexOf('live') === 0 ? ' \u2014 the prompt the app actually ships'
       : ' \u2014 could not read the live demo.html, so this used the probe\u2019s own copy and may have drifted. Do not act on this run.') + '</p>')
    : '';
  return page('<h1>Model probe</h1>'
    + '<p class="sub">Asks each model for the estimator\'s JSON shape and reports the RAW response. '
    + 'Add <code>?plan=1</code> to run the REAL extraction prompt against a synthetic sheet whose numbers we know, at the real token budget (<code>&amp;max=20000</code> to raise it, <code>&amp;blocks=12</code> to send a tiled plan set like production does). <code>?effort=1</code> also sends the effort parameter. '
    + 'Nothing here is wired into the app.</p>' + srcNote + rows);
};
