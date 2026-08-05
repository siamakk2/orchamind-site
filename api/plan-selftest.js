// TEMPORARY self-test: runs the plan-extraction pass against the real project
// sheets committed in /selftest, so accuracy can be verified and iterated on
// directly from logs/response without a human re-testing in the UI each round.
// Secret-gated; remove after tuning is complete.
var fs = require('fs');
var path = require('path');

module.exports = async function handler(req, res) {
  if ((req.query && req.query.k) !== 'orcha-tune-7391') { return res.status(404).json({ error: 'Not found' }); }
  try {
    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(200).json({ error: 'no key' });

    var dir = path.join(process.cwd(), 'selftest');
    var files = ['floor_0.jpg','floor_1.jpg','floor_2.jpg','floor_3.jpg','floor_4.jpg','floor_5.jpg','elev_0.jpg','elev_1.jpg','elev_2.jpg','elev_3.jpg'];
    var content = [{ type: 'text', text:
      'This plan set has 2 files, in this order:\n' +
      'File 1: Floor plan (image, "Main_Residence_floor_plan") — provided as 6 overlapping high-resolution magnified tiles (3 across × 2 down, reading order left→right then top→bottom). ALL these tiles are pieces of ONE single sheet; stitch them mentally and read every table at full detail.\n' +
      'File 2: Elevation (image, "55_Longhorn_Main_Residence_Elevations") — provided as 4 overlapping high-resolution tiles (2 across × 2 down, reading order left→right then top→bottom). ALL these tiles are pieces of ONE single sheet; each tile contains one elevation view.\n' +
      'Use each sheet for its purpose: floor plans for rooms, dimensions and square footage; elevations for stories, roof form, glazing style and window counts.' }];
    files.forEach(function (f) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(path.join(dir, f)).toString('base64') } });
    });
    content.push({ type: 'text', text: 'Transcribe these plan sheets per your instructions. JSON only.' });

    var system = 'You are a construction plan TRANSCRIBER. Your ONLY job is to read what is printed and drawn on these plan sheets and transcribe it exactly. Do NOT compute, estimate, price, or infer anything.\n\n'
      + 'WORK METHODICALLY. FIRST, inventory: for each file, list to yourself every distinct drawing, view, and table it contains (title block, floor plan, individual elevation views — one image often holds several — sections, details, area/window/door/room schedules, general notes). THEN transcribe, one identified item at a time:\n'
      + '1. AREA SCHEDULE: find any printed area table — titles vary by architect: "SQUARE FOOTAGE", "AREA SCHEDULE", "BUILDING AREA", "AREA TABULATION", "GROSS/NET AREA", or a per-level breakdown. Transcribe each row exactly as printed (label + square footage). CRITICAL: conditioned floor area (e.g. "MAIN FLOOR") is separate from covered porches, patios, decks, and garages — transcribe every row, and set totalPrintedSqft to the CONDITIONED floor total only (sum of floor levels), never including porch/patio/garage rows. If no table is printed, use null. READ NUMBERS DIGIT-BY-DIGIT: schedule figures like "1,156" are easy to misread as "156" - re-read every area number twice, and when the drawing also prints the dimensions of that space, cross-check (length × width ≈ printed area); if they disagree by roughly 10×, you dropped a leading digit - re-read it.\n'
      + '2. ROOM SCHEDULE: from the floor plan, list every labeled room with its printed name. Transcribe names EXACTLY as printed.\n'
      + '3. BEDROOMS: list the names of rooms that are explicitly labeled as bedrooms. Do not count a den/office/flex room as a bedroom unless the plan labels it one. SEPARATELY, list rooms NOT labeled as bedrooms that could plausibly serve as one (office, den, study, flex, loft, bonus room) as potentialBedrooms — the owner decides, not you.\n'
      + '4. WINDOW & DOOR SCHEDULES: if printed, transcribe them (mark, size, count).\n'
      + '5. ELEVATIONS: for EACH elevation view, examine it carefully one at a time. Identify the GLAZING STYLE ("punched", "window-wall", or "mixed"), count the window UNITS visible (for window-walls, count the major glazed panels), and note CLERESTORY true/false. State which elevation has the main entry door (that is "front"). Note the roof form and any printed height dimensions. If a raised/stepped roof section exists, transcribe its horizontal EXTENT (start/end in feet from printed dimensions) and heights. From the floor plan, transcribe the covered porch printed dimensions and WHICH SIDE it runs along.\n'
      + '6. STORIES and overall building dimensions if printed.\n\n'
      + 'RULES: transcribe only what is actually printed or drawn. Anything absent or unreadable = null. Never guess. If two sheets disagree, report both in "conflicts".\n\n'
      + 'Return ONLY JSON, no markdown: {"areaSchedule":[{"label":"string","sqft":number}]|null,"totalPrintedSqft":number|null,"stories":number|null,"rooms":[{"name":"string"}]|null,"bedrooms":["string"]|null,"potentialBedrooms":["string"]|null,"windowSchedule":[{"mark":"string","size":"string","count":number}]|null,"elevations":{"present":true,"front":{"windows":number,"style":"punched|window-wall|mixed","clerestory":true|false,"door":true},"back":{"windows":number,"style":"string","clerestory":true|false},"left":{"windows":number,"style":"string","clerestory":true|false},"right":{"windows":number,"style":"string","clerestory":true|false}}|null,"roof":"string"|null,"heights":["string"]|null,"raisedSection":{"present":true,"fromFt":number,"toFt":number,"heightFt":number}|null,"porchInfo":{"side":"string","printedDims":"string"}|null,"overallDims":"string"|null,"conflicts":["string"]|null}';

    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 10000,
        thinking: { type: 'enabled', budget_tokens: 5000 },
        system: system,
        messages: [{ role: 'user', content: content }]
      })
    });
    var data = await r.json();
    var text = '';
    if (data && data.content) text = data.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
    console.log('[selftest] pass1 stop:', data && data.stop_reason, 'chars:', text.length);
    if (data && data.error) return res.status(200).json({ phase: 1, error: data.error });

    // Parse extraction exactly like the client: last balanced JSON candidate wins
    function parseJSON(s) {
      if (!s) return null;
      s = s.replace(/```json/gi, '').replace(/```/g, '').trim();
      var cands = [], depth = 0, start = -1, inStr = false, esc = false;
      for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') { inStr = true; continue; }
        if (c === '{') { if (depth === 0) start = i; depth++; }
        else if (c === '}') { depth--; if (depth === 0 && start >= 0) { cands.push(s.substring(start, i + 1)); start = -1; } if (depth < 0) depth = 0; }
      }
      for (var j = cands.length - 1; j >= 0; j--) { try { return JSON.parse(cands[j]); } catch (e) {} }
      return null;
    }
    var extracted = parseJSON(text);
    if (!extracted) return res.status(200).json({ phase: 1, error: 'extraction unparseable', raw: text.slice(0, 2000) });

    // PASS 2 — the estimate, under the production consistency contract
    var sys2 = 'You are an expert construction estimator. Using the plan sheets and the VERIFIED TRANSCRIPTION, produce a takeoff and estimate as JSON. '
      + 'HARD RULES: totalSqft MUST equal the transcription totalPrintedSqft. Bedroom names MUST come from the transcription; if potentialBedrooms exist, keep the printed count and add a question asking the owner whether to count them. '
      + 'geometry.volumes: 1-4 volumes in feet; the MAIN volume footprint MUST be the full conditioned footprint (match overall printed dims); a raised/stepped section is a SUB-RECTANGLE INSIDE the main footprint at the transcribed raisedSection extent, glazing "clerestory", height from printed heights - NEVER a separate box beside it; porches attach FLUSH on the side porchInfo shows with printed dims. Roof strings must be exactly flat, low-slope, gable, or hip. '
      + 'Do verification inside your thinking. Output EXACTLY ONE JSON object, nothing else: {"items":[{"desc":"string","qty":number,"unit":"string","price":number}],"totalSqft":number,"questions":["string"],"geometry":{"stories":number,"storyHeight":number,"roof":"flat|low-slope|gable|hip","windows":{"front":{"count":number,"style":"string","clerestory":true},"back":{},"left":{},"right":{}},"volumes":[{"name":"string","x":number,"y":number,"w":number,"h":number,"heightFt":number,"roof":"string","glazing":"band|clerestory|punched|none"}],"porches":[{"x":number,"y":number,"w":number,"h":number,"heightFt":number}],"rooms":[{"name":"string","x":number,"y":number,"w":number,"h":number}]}}';
    var content2 = content.slice(0, content.length - 1);
    content2.push({ type: 'text', text: 'VERIFIED TRANSCRIPTION (ground truth):\n' + JSON.stringify(extracted) + '\nDo the takeoff and draft the estimate.' });
    var r2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 12000, thinking: { type: 'enabled', budget_tokens: 4000 }, system: sys2, messages: [{ role: 'user', content: content2 }] })
    });
    var data2 = await r2.json();
    var text2 = '';
    if (data2 && data2.content) text2 = data2.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
    console.log('[selftest] pass2 stop:', data2 && data2.stop_reason, 'chars:', text2.length);
    var est = parseJSON(text2);

    // SELF-SCORING against the printed ground truth
    var score = {
      sqft_2616: !!(est && est.totalSqft === 2616),
      parsed: !!est,
      bedroomQuestion: !!(est && (est.questions || []).some(function (q) { return /bedroom/i.test(q); })),
      volumes: est && est.geometry && est.geometry.volumes ? est.geometry.volumes.length : 0,
      mainIsFullBar: false, raisedInside: false, hasPorch: !!(est && est.geometry && (est.geometry.porches || []).length)
    };
    if (est && est.geometry && est.geometry.volumes && est.geometry.volumes.length) {
      var vs = est.geometry.volumes.slice().sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
      var m = vs[0];
      score.mainIsFullBar = !!(m && m.w >= 90 && m.w <= 102 && m.h >= 24 && m.h <= 31);
      if (vs.length > 1) {
        var rz = vs[1];
        score.raisedInside = !!(rz && m && rz.x >= m.x - 2 && (rz.x + rz.w) <= (m.x + m.w) + 2 && rz.heightFt > m.heightFt);
      }
    }
    return res.status(200).json({ score: score, extractionOk: { sqft: extracted.totalPrintedSqft, bedrooms: extracted.bedrooms, potential: extracted.potentialBedrooms, raised: extracted.raisedSection, porch: extracted.porchInfo }, estimate: est ? { totalSqft: est.totalSqft, questions: est.questions, volumes: est.geometry && est.geometry.volumes, porches: est.geometry && est.geometry.porches, roof: est.geometry && est.geometry.roof } : null, raw2: est ? undefined : text2.slice(0, 1500) });
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
};
