// End-to-end estimator smoke test — OPERATOR / single-use token only.
//
// Runs the estimator's REAL two-pass pipeline on the synthetic fixture sheet and
// reports what a customer would get. Everything that decides the outcome is
// pulled out of the LIVE /demo page at request time, not copied here:
//
//   _estParseJSON     the app's own parser (a copy is exactly how a probe said
//                     "parses: yes" while the app returned null)
//   _planExtractSys   pass-1 transcription prompt
//   _planSys          pass-2 takeoff prompt
//   wrapper text      the manifest, the transcription note, the pass-2 instruction
//
// Model, token budgets and thinking budgets mirror what demo.html sends through
// /api/claude. Writes each run to diag_runs.
//
// The question it answers is the only one a customer cares about: drop a plan
// in, does a priced estimate come out — and does the first pass actually reach
// the second?

var crypto = require('crypto');

var OPERATOR = 'siamakk2';
var SB_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
var SITE = 'https://orchamind.com';

function jsStr(lit) {
  // Evaluate a captured single-quoted JS string body (with its escapes) exactly
  // as the browser would.
  return new Function("return '" + lit + "';")();
}

function extractFn(src, name, args) {
  var re = new RegExp('function ' + name + '\\(' + (args || '') + '\\)\\{[\\s\\S]*?\\n\\}');
  var m = src.match(re);
  return m ? m[0] : null;
}

async function callModel(apiKey, model, system, content, maxTokens, thinkBudget) {
  // Mirrors callClaudeBlocks + api/claude.js: thinking when requested and within
  // budget, and up to 3 continuations on max_tokens.
  var messages = [{ role: 'user', content: content }];
  var acc = '', tries = 0, last = null, t0 = Date.now(), usage = [];
  while (true) {
    var payload = { model: model, max_tokens: maxTokens, system: system, messages: messages };
    if (thinkBudget) {
      var bt = Math.min(Math.max(thinkBudget, 1024), 8000);
      if (bt < maxTokens) payload.thinking = { type: 'enabled', budget_tokens: bt };
    }
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload)
    });
    var data = await r.json();
    last = data;
    if (data && data.error) return { ok: false, error: data.error.message || JSON.stringify(data.error), ms: Date.now() - t0 };
    usage.push(data.usage || null);
    var text = (data.content || []).filter(function (b) { return b && b.type === 'text'; })
                                    .map(function (b) { return b.text; }).join('\n');
    acc += text;
    if (data.stop_reason === 'max_tokens' && tries < 3 && text) {
      tries++;
      messages = messages.concat([{ role: 'assistant', content: text },
        { role: 'user', content: 'Continue your previous answer exactly where it left off. Do not repeat anything you already wrote.' }]);
      continue;
    }
    break;
  }
  return { ok: !!acc, text: acc, stop: last && last.stop_reason, continuations: tries, usage: usage, ms: Date.now() - t0 };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  function send(o, code) { res.statusCode = code || 200; res.end(JSON.stringify(o, null, 2)); }

  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var APIKEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY || !APIKEY) return send({ ok: false, error: 'not configured' }, 500);

  // ---- auth: operator cookie, or a single-use token -----------------------
  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  var authed = false;
  var cm = (req.headers.cookie || '').match(/(?:^|;\s*)orcha_sess=([^;]+)/);
  if (cm) {
    var parts = decodeURIComponent(cm[1]).split('|');
    if (parts.length === 4 && parts[0] === OPERATOR && sign(parts[0] + '|' + parts[1] + '|' + parts[2]) === parts[3] && Date.now() <= Number(parts[2])) authed = true;
  }
  var tok = (req.query && req.query.token) ? String(req.query.token) : '';
  if (!authed && /^[a-f0-9]{32,64}$/.test(tok)) {
    var H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
    var tr = await fetch(SB_URL + '/rest/v1/probe_tokens?token=eq.' + tok + '&select=*', { headers: H });
    var rows = await tr.json();
    var row = Array.isArray(rows) && rows[0];
    if (row && !row.used_at && new Date(row.expires_at).getTime() > Date.now()) {
      await fetch(SB_URL + '/rest/v1/probe_tokens?token=eq.' + tok, {
        method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, H),
        body: JSON.stringify({ used_at: new Date().toISOString() })
      });
      authed = true;
    }
  }
  if (!authed) return send({ ok: false, error: 'Not authorised.' }, 403);

  var report = { ok: false, stages: {} };
  try {
    // ---- 1. pull the live app ----------------------------------------------
    var page = await (await fetch(SITE + '/demo', { headers: { 'Cache-Control': 'no-cache' } })).text();
    report.liveBytes = page.length;
    report.liveSha = crypto.createHash('sha256').update(page).digest('hex').slice(0, 16);

    var parseSrc = extractFn(page, '_estParseJSON', 'text');
    var exSrc = extractFn(page, '_planExtractSys');
    var tkSrc = extractFn(page, '_planSys');
    var useM = page.match(/'\\nUse each sheet for its purpose:((?:[^'\\]|\\.)*)'/);
    var extM = page.match(/var extNote=extracted\?\('((?:[^'\\]|\\.)*)'\+JSON\.stringify\(extracted\)\)/);
    var insM = page.match(/'These are the plans for the job\.'\+\(scope\?\(' Extra context from the contractor: '\+scope\):''\)\+'((?:[^'\\]|\\.)*)'/);
    var missing = [];
    if (!parseSrc) missing.push('_estParseJSON');
    if (!exSrc) missing.push('_planExtractSys');
    if (!tkSrc) missing.push('_planSys');
    if (!useM) missing.push('manifest text');
    if (!extM) missing.push('transcription note');
    if (!insM) missing.push('pass-2 instruction');
    if (missing.length) { report.error = 'Could not extract from live page: ' + missing.join(', '); return send(report); }

    var _estParseJSON = new Function(parseSrc + '; return _estParseJSON;')();
    var extractSys = new Function(exSrc + '; return _planExtractSys();')();
    var takeoffSys = new Function('CURRENT_USER', '_pbRateCard', tkSrc + '; return _planSys();')({ name: 'Smoke Test Co' }, function () { return ''; });
    var manifest = 'This plan set has 1 file(s), in this order:\nFile 1: Auto-detect (image, "test-plan.png")\nUse each sheet for its purpose:' + jsStr(useM[1]);
    var extPrefix = jsStr(extM[1]);
    var instruction = 'These are the plans for the job.' + jsStr(insM[1]);
    report.extracted = { parser: parseSrc.length, extractPrompt: extractSys.length, takeoffPrompt: takeoffSys.length };

    // ---- 2. fixture --------------------------------------------------------
    var ir = await fetch(SITE + '/media/test-plan.png');
    if (!ir.ok) { report.error = 'fixture HTTP ' + ir.status; return send(report); }
    var img = Buffer.from(await ir.arrayBuffer()).toString('base64');
    var media = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: img } }];

    // Same model as demo.html → api/claude.js unless asked otherwise.
    var model = (req.query && req.query.model) ? String(req.query.model) : 'claude-sonnet-4-6';
    report.model = model;

    // ---- 3. PASS 1: transcription -----------------------------------------
    var p1 = await callModel(APIKEY, model, extractSys,
      [{ type: 'text', text: manifest }].concat(media).concat([{ type: 'text', text: 'Transcribe these plan sheets per your instructions. JSON only.' }]),
      10000, 4000);
    var extracted = p1.ok ? _estParseJSON(p1.text) : null;
    report.stages.pass1 = {
      apiOk: p1.ok, error: p1.error || null, stop: p1.stop, ms: p1.ms, textChars: (p1.text || '').length,
      // THE check: does the app's own parser accept the transcription?
      appParserAccepts: !!extracted,
      textHead: (p1.text || '').slice(0, 300),
      totalPrintedSqft: extracted ? extracted.totalPrintedSqft : null,
      stories: extracted ? extracted.stories : null
    };

    // ---- 4. PASS 2: takeoff, exactly as the app builds it -----------------
    var extNote = extracted ? (extPrefix + JSON.stringify(extracted)) : '';
    var p2 = await callModel(APIKEY, model, takeoffSys,
      [{ type: 'text', text: manifest + (extNote ? ('\n\n' + extNote) : '') }].concat(media).concat([{ type: 'text', text: instruction }]),
      12000, 4000);
    var est = p2.ok ? _estParseJSON(p2.text) : null;
    var items = (est && Array.isArray(est.items)) ? est.items : [];
    var total = items.reduce(function (s, i) { return s + (Number(i.qty) || 0) * (Number(i.price) || 0); }, 0);
    report.stages.pass2 = {
      apiOk: p2.ok, error: p2.error || null, stop: p2.stop, ms: p2.ms, textChars: (p2.text || '').length,
      receivedTranscription: !!extNote,
      appParserAccepts: !!est,
      lineItems: items.length,
      total: Math.round(total),
      totalSqft: est ? est.totalSqft : null,
      sampleItems: items.slice(0, 6).map(function (i) { return i.desc + ' — ' + i.qty + ' ' + i.unit + ' @ ' + i.price; })
    };

    // ---- 5. would the computed-quantities panel render? --------------------
    var Q = require('../lib/takeoff-quantities.js');
    if (extracted) {
      var od = extracted.overallDims || {};
      var q = Q.computeQuantities({
        totalPrintedSqft: extracted.totalPrintedSqft, stories: extracted.stories, storyHeightFt: extracted.storyHeightFt,
        overallDims: { widthFt: od.widthFt || od.width || od.w, depthFt: od.depthFt || od.depth || od.d },
        roof: extracted.roof, areaSchedule: extracted.areaSchedule
      });
      report.stages.quantities = { panelWouldRender: true, computed: q.computedCount, missing: q.missingCount,
        lines: q.items.filter(function (i) { return i.computed; }).map(function (i) { return i.item + ': ' + i.qty + ' ' + i.unit; }) };
    } else {
      report.stages.quantities = { panelWouldRender: false, reason: 'no transcription reached the panel' };
    }

    // ---- verdict -----------------------------------------------------------
    report.customerGetsEstimate = items.length > 0;
    report.firstPassReachesSecond = !!extNote;
    report.ok = report.customerGetsEstimate;
  } catch (e) {
    report.error = (e && e.message) || String(e);
  }

  try {
    await fetch(SB_URL + '/rest/v1/diag_runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY, Prefer: 'return=minimal' },
      body: JSON.stringify({ id: 'smoke_' + Date.now().toString(36), kind: 'smoke', result: report })
    });
  } catch (e) {}
  console.log('[smoke]', JSON.stringify({ ok: report.ok, est: report.customerGetsEstimate, p1p2: report.firstPassReachesSecond, err: report.error || null }));
  return send(report);
};
