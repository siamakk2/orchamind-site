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
    var files = ['floor_0.jpg','floor_1.jpg','floor_2.jpg','floor_3.jpg','elev_0.jpg','elev_1.jpg','elev_2.jpg','elev_3.jpg'];
    var content = [{ type: 'text', text:
      'This plan set has 2 files, in this order:\n' +
      'File 1: Floor plan (image, "Main_Residence_floor_plan") — provided as 4 overlapping high-resolution tiles (2 across × 2 down, reading order left→right then top→bottom). ALL these tiles are pieces of ONE single sheet; stitch them mentally and read every table at full detail.\n' +
      'File 2: Elevation (image, "55_Longhorn_Main_Residence_Elevations") — provided as 4 overlapping high-resolution tiles (2 across × 2 down, reading order left→right then top→bottom). ALL these tiles are pieces of ONE single sheet; each tile contains one elevation view.\n' +
      'Use each sheet for its purpose: floor plans for rooms, dimensions and square footage; elevations for stories, roof form, glazing style and window counts.' }];
    files.forEach(function (f) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(path.join(dir, f)).toString('base64') } });
    });
    content.push({ type: 'text', text: 'Transcribe these plan sheets per your instructions. JSON only.' });

    var system = 'You are a construction plan TRANSCRIBER. Your ONLY job is to read what is printed and drawn on these plan sheets and transcribe it exactly. Do NOT compute, estimate, price, or infer anything.\n\n'
      + 'WORK METHODICALLY. FIRST, inventory: for each file, list to yourself every distinct drawing, view, and table it contains (title block, floor plan, individual elevation views — one image often holds several — sections, details, area/window/door/room schedules, general notes). THEN transcribe, one identified item at a time:\n'
      + '1. AREA SCHEDULE: find any printed area table — titles vary by architect: "SQUARE FOOTAGE", "AREA SCHEDULE", "BUILDING AREA", "AREA TABULATION", "GROSS/NET AREA", or a per-level breakdown. Transcribe each row exactly as printed (label + square footage). CRITICAL: conditioned floor area (e.g. "MAIN FLOOR") is separate from covered porches, patios, decks, and garages — transcribe every row, and set totalPrintedSqft to the CONDITIONED floor total only (sum of floor levels), never including porch/patio/garage rows. If no table is printed, use null.\n'
      + '2. ROOM SCHEDULE: from the floor plan, list every labeled room with its printed name. Transcribe names EXACTLY as printed.\n'
      + '3. BEDROOMS: list the names of rooms that are explicitly labeled as bedrooms. Do not count a den/office/flex room as a bedroom unless the plan labels it one.\n'
      + '4. WINDOW & DOOR SCHEDULES: if printed, transcribe them (mark, size, count).\n'
      + '5. ELEVATIONS: for EACH elevation view, examine it carefully one at a time. Identify the GLAZING STYLE ("punched", "window-wall", or "mixed"), count the window UNITS visible (for window-walls, count the major glazed panels), and note CLERESTORY true/false. State which elevation has the main entry door (that is "front"). Note the roof form and any printed height dimensions.\n'
      + '6. STORIES and overall building dimensions if printed.\n\n'
      + 'RULES: transcribe only what is actually printed or drawn. Anything absent or unreadable = null. Never guess. If two sheets disagree, report both in "conflicts".\n\n'
      + 'Return ONLY JSON, no markdown: {"areaSchedule":[{"label":"string","sqft":number}]|null,"totalPrintedSqft":number|null,"stories":number|null,"rooms":[{"name":"string"}]|null,"bedrooms":["string"]|null,"windowSchedule":[{"mark":"string","size":"string","count":number}]|null,"elevations":{"present":true,"front":{"windows":number,"style":"punched|window-wall|mixed","clerestory":true|false,"door":true},"back":{"windows":number,"style":"string","clerestory":true|false},"left":{"windows":number,"style":"string","clerestory":true|false},"right":{"windows":number,"style":"string","clerestory":true|false}}|null,"roof":"string"|null,"heights":["string"]|null,"overallDims":"string"|null,"conflicts":["string"]|null}';

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
    console.log('[selftest] stop:', data && data.stop_reason, 'chars:', text.length);
    return res.status(200).json({ stop: data && data.stop_reason, extraction: text, error: data && data.error });
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
};
