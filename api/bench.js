// Takeoff accuracy harness — OPERATOR ONLY.
//
// Holds plan sets we know the real bid for, scores pipeline output against that
// bid, and keeps every run so two configurations can be compared. This is how
// "we made the estimator smarter" stops being a feeling and becomes a number.
//
// Authorisation comes from the signed session cookie and nothing else. These
// are Orchamind's own fixtures, not customer data, but the endpoint can read
// and write the benchmark tables, so it is gated the same way the support view
// is: the operator account, or 403.

var crypto = require('crypto');
var SCORER = require('../lib/bench-score.js');

var OPERATOR = 'siamakk2';

function readBody(req) {
  var b = req.body;
  if (b == null) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return b;
}

// Minimal CSV reader: handles quoted fields and embedded commas, which real
// exported bids contain ("2x6 stud wall, upper").
function parseCSV(text) {
  var rows = [], row = [], field = '', inQ = false;
  var s = String(text || '').replace(/\r\n?/g, '\n');
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (f) { return String(f).trim() !== ''; }); });
}

function num(v) {
  if (v == null || v === '') return null;
  var n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
}

// Accept whatever a real bid export calls these columns.
var COLS = {
  trade: ['trade', 'division', 'category', 'section'],
  item: ['item', 'description', 'line', 'line item', 'name', 'material'],
  unit: ['unit', 'uom', 'units', 'measure'],
  qty: ['qty', 'quantity', 'count', 'amount'],
  unit_cost: ['unit_cost', 'unit cost', 'unitprice', 'unit price', 'rate', 'cost'],
  total: ['total', 'extended', 'ext', 'line total', 'subtotal'],
  tier: ['tier', 'priority']
};
function mapHeader(header) {
  var idx = {};
  header.forEach(function (h, i) {
    var k = String(h).toLowerCase().trim();
    Object.keys(COLS).forEach(function (field) {
      if (idx[field] == null && COLS[field].indexOf(k) >= 0) idx[field] = i;
    });
  });
  return idx;
}

function id(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!KEY) return res.status(200).json({ ok: false, error: 'Server not configured (Supabase key missing).' });
  var base = SUPABASE_URL + '/rest/v1';
  var H = { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  function session() {
    var c = req.headers.cookie || '';
    var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/);
    if (!m) return null;
    var parts = decodeURIComponent(m[1]).split('|');
    if (parts.length !== 4) return null;
    if (sign(parts[0] + '|' + parts[1] + '|' + parts[2]) !== parts[3]) return null;
    if (Date.now() > Number(parts[2])) return null;
    return { username: parts[0], role: parts[1] };
  }

  var sess = session();
  if (!sess || sess.username !== OPERATOR) {
    return res.status(403).json({ ok: false, error: 'Not authorised.' });
  }

  async function sb(path, init) {
    var r = await fetch(base + path, Object.assign({ headers: H }, init || {}));
    var txt = await r.text();
    var json; try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = null; }
    return { status: r.status, body: json, raw: txt };
  }

  try {
    var body = readBody(req);
    var action = String(body.action || (req.method === 'GET' ? 'sets' : '')).trim();

    // ---- list every set, with its most recent score ----------------------
    if (action === 'sets') {
      var sets = (await sb('/bench_sets?select=*&order=created_at.desc')).body || [];
      var results = (await sb('/bench_results?select=*&order=scored_at.desc')).body || [];
      var latest = {};
      results.forEach(function (r) { if (!latest[r.set_id]) latest[r.set_id] = r; });
      return res.status(200).json({
        ok: true,
        sets: sets.map(function (s) {
          return {
            id: s.id, name: s.name, source: s.source, total_bid: s.total_bid,
            sqft: s.sqft, notes: s.notes, created_at: s.created_at,
            hasPlans: !!(s.plan_blocks && s.plan_blocks.length),
            latest: latest[s.id] || null
          };
        })
      });
    }

    // ---- create a set -----------------------------------------------------
    if (action === 'createSet') {
      var name = String(body.name || '').trim();
      if (!name) return res.status(200).json({ ok: false, error: 'Give the set a name.' });
      var sid = id('set');
      var row = {
        id: sid, name: name,
        source: String(body.source || '').trim() || null,
        total_bid: num(body.bidTotal),
        sqft: num(body.sqft),
        notes: String(body.notes || '').trim() || null,
        trade_scope: Array.isArray(body.tradeScope) ? body.tradeScope : null,
        plan_blocks: Array.isArray(body.planBlocks) ? body.planBlocks : null
      };
      var ins = await sb('/bench_sets', { method: 'POST', headers: Object.assign({}, H, { Prefer: 'return=representation' }), body: JSON.stringify(row) });
      if (ins.status >= 300) return res.status(200).json({ ok: false, error: 'Could not save set: ' + ins.raw.slice(0, 200) });
      return res.status(200).json({ ok: true, setId: sid });
    }

    // ---- replace a set's ground truth from pasted CSV --------------------
    if (action === 'truth') {
      var setId = String(body.setId || '');
      if (!setId) return res.status(200).json({ ok: false, error: 'Which set?' });
      var rows = parseCSV(body.csv);
      if (rows.length < 2) return res.status(200).json({ ok: false, error: 'Need a header row and at least one line item.' });
      var idx = mapHeader(rows[0]);
      if (idx.item == null) {
        return res.status(200).json({ ok: false, error: 'No item/description column found. Header needs one of: ' + COLS.item.join(', ') });
      }
      var items = [];
      for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        var itemName = String(r[idx.item] == null ? '' : r[idx.item]).trim();
        if (!itemName) continue;
        items.push({
          set_id: setId,
          trade: idx.trade != null ? (String(r[idx.trade] || '').trim() || null) : null,
          item: itemName,
          unit: idx.unit != null ? (String(r[idx.unit] || '').trim() || null) : null,
          qty: idx.qty != null ? num(r[idx.qty]) : null,
          unit_cost: idx.unit_cost != null ? num(r[idx.unit_cost]) : null,
          total: idx.total != null ? num(r[idx.total]) : null,
          tier: idx.tier != null ? (String(r[idx.tier] || '').trim().toLowerCase() || 'primary') : 'primary'
        });
      }
      if (!items.length) return res.status(200).json({ ok: false, error: 'No usable rows found.' });
      await sb('/bench_truth?set_id=eq.' + encodeURIComponent(setId), { method: 'DELETE' });
      var tins = await sb('/bench_truth', { method: 'POST', headers: Object.assign({}, H, { Prefer: 'return=minimal' }), body: JSON.stringify(items) });
      if (tins.status >= 300) return res.status(200).json({ ok: false, error: 'Could not save truth: ' + tins.raw.slice(0, 200) });
      var primary = items.filter(function (x) { return x.tier === 'primary'; }).length;
      return res.status(200).json({ ok: true, saved: items.length, primary: primary, columns: Object.keys(idx) });
    }

    // ---- one set with its truth ------------------------------------------
    if (action === 'getSet') {
      var gid = String(body.setId || '');
      var sres = await sb('/bench_sets?id=eq.' + encodeURIComponent(gid) + '&select=*');
      var set = (sres.body || [])[0];
      if (!set) return res.status(200).json({ ok: false, error: 'No such set.' });
      var truth = (await sb('/bench_truth?set_id=eq.' + encodeURIComponent(gid) + '&select=*&order=id.asc')).body || [];
      delete set.plan_blocks; // never ship the encoded sheets back to the browser
      return res.status(200).json({ ok: true, set: set, truth: truth });
    }

    // ---- score a pipeline run against the truth --------------------------
    if (action === 'record') {
      var rid = String(body.setId || '');
      if (!rid) return res.status(200).json({ ok: false, error: 'Which set?' });
      var predicted = Array.isArray(body.items) ? body.items : [];
      var truthRows = (await sb('/bench_truth?set_id=eq.' + encodeURIComponent(rid) + '&select=*')).body || [];
      if (!truthRows.length) {
        return res.status(200).json({ ok: false, error: 'This set has no ground truth yet — paste the real bid first. Without it there is nothing to score against.' });
      }
      var setRow = ((await sb('/bench_sets?id=eq.' + encodeURIComponent(rid) + '&select=total_bid')).body || [])[0] || {};

      var runId = id('run');
      await sb('/bench_runs', {
        method: 'POST', headers: Object.assign({}, H, { Prefer: 'return=minimal' }),
        body: JSON.stringify({
          id: runId, set_id: rid,
          config: body.config || {},
          label: String(body.label || '').trim() || null,
          raw: { items: predicted },
          status: 'scored',
          finished_at: new Date().toISOString()
        })
      });

      var m = SCORER.score(truthRows, predicted, { bidTotal: setRow.total_bid });
      await sb('/bench_results', {
        method: 'POST', headers: Object.assign({}, H, { Prefer: 'return=minimal' }),
        body: JSON.stringify({
          run_id: runId, set_id: rid,
          coverage: m.coverage, precision_10: m.precision10, precision_25: m.precision25,
          composite: m.composite, total_delta: m.totalDelta,
          by_trade: m.byTrade, detail: m.detail
        })
      });
      console.log('[bench] scored', runId, 'cov', m.coverage.toFixed(3), 'p25', m.precision25.toFixed(3), 'comp', m.composite.toFixed(3));
      return res.status(200).json({ ok: true, runId: runId, metrics: m });
    }

    // ---- run history for a set -------------------------------------------
    if (action === 'runs') {
      var qid = String(body.setId || '');
      var runs = (await sb('/bench_runs?set_id=eq.' + encodeURIComponent(qid) + '&select=id,label,config,status,started_at&order=started_at.desc&limit=50')).body || [];
      var rs = (await sb('/bench_results?set_id=eq.' + encodeURIComponent(qid) + '&select=*')).body || [];
      var byRun = {}; rs.forEach(function (r) { byRun[r.run_id] = r; });
      return res.status(200).json({
        ok: true,
        runs: runs.map(function (r) { return Object.assign({}, r, { result: byRun[r.id] || null }); })
      });
    }

    if (action === 'deleteSet') {
      var did = String(body.setId || '');
      if (!did) return res.status(200).json({ ok: false, error: 'Which set?' });
      await sb('/bench_sets?id=eq.' + encodeURIComponent(did), { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (e) {
    console.error('[bench] error:', (e && e.message) || String(e));
    return res.status(200).json({ ok: false, error: (e && e.message) || String(e) });
  }
};
