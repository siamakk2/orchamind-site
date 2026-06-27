// Free AI Website Audit engine — by Siamak Kalhor Consulting (Orchamind).
// Fetches a visitor's website, then asks Claude to score and analyze it across
// SEO, LLMO (how AI assistants see them), positioning, and content relevancy.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ error: "The audit tool isn't set up yet. Please call Siamak at 323-657-7752." });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};

    // --- Normalize the URL ---
    let url = (body.url || '').toString().trim();
    if (!url) { return res.status(200).json({ error: 'Please enter your website address.' }); }
    if (!/^https?:\/\//i.test(url)) { url = 'https://' + url; }
    let host = '';
    try { host = new URL(url).hostname; } catch (e) {
      return res.status(200).json({ error: "That doesn't look like a valid website address. Try again (e.g. yourbusiness.com)." });
    }

    // --- Fetch the website (with timeout + size cap) ---
    let pageText = '', pageTitle = '', fetchError = '';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrchamindAudit/1.0; +https://orchamind.com)' },
        redirect: 'follow'
      });
      clearTimeout(t);
      if (!resp.ok) { fetchError = 'status ' + resp.status; }
      let html = await resp.text();
      html = html.slice(0, 200000); // cap raw html

      // Pull the <title>
      const tm = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      pageTitle = tm ? tm[1].trim() : '';

      // Pull meta description
      const dm = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
      const metaDesc = dm ? dm[1].trim() : '';

      // Strip scripts/styles, collapse tags to text
      let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Capture heading hints before stripping (h1/h2)
      const heads = [];
      const hre = /<h[12][^>]*>([^<]{2,120})<\/h[12]>/gi; let hm;
      while ((hm = hre.exec(html)) && heads.length < 12) { heads.push(hm[1].trim()); }

      pageText =
        'PAGE TITLE: ' + (pageTitle || '(none)') + '\n' +
        'META DESCRIPTION: ' + (metaDesc || '(none — missing)') + '\n' +
        'HEADINGS: ' + (heads.join(' | ') || '(none found)') + '\n\n' +
        'VISIBLE TEXT (excerpt):\n' + text.slice(0, 6000);
    } catch (e) {
      fetchError = e.name === 'AbortError' ? 'timeout' : e.message;
    }

    if (!pageText && fetchError) {
      return res.status(200).json({
        error: "I couldn't load that website (" + fetchError + "). Double-check the address, or the site may be blocking automated visits. You can still call Siamak at 323-657-7752 for a manual review."
      });
    }

    // --- Ask Claude for a structured audit ---
    const system = `You are the analysis engine behind "Siamak Kalhor Consulting — Free AI Website Audit." You review a business's website and return a concrete, honest, encouraging audit a non-technical owner can act on. You are reviewing real fetched content. Be specific to THIS site — quote or reference what you actually see. Never invent facts you can't see.

Return ONLY valid JSON (no markdown, no preamble) with this exact shape:
{
  "business_name": "best guess at the business name",
  "what_they_do": "one plain sentence on what this business appears to do",
  "overall_score": 0-100 integer,
  "headline": "one punchy sentence summarizing the single biggest opportunity",
  "scores": {
    "seo": {"score": 0-100, "summary": "1-2 sentences", "fixes": ["specific fix", "specific fix", "specific fix"]},
    "llmo": {"score": 0-100, "summary": "1-2 sentences on how well AI assistants (ChatGPT, Claude, Google AI) could understand and recommend this business", "fixes": ["specific fix", "specific fix"]},
    "positioning": {"score": 0-100, "summary": "1-2 sentences on clarity of who they serve and why to choose them", "fixes": ["specific fix", "specific fix"]},
    "content": {"score": 0-100, "summary": "1-2 sentences on content relevance, freshness, trust signals", "fixes": ["specific fix", "specific fix"]}
  },
  "quick_wins": ["the 3 highest-impact things to do first, each one sentence"],
  "pitch": "2 sentences: warmly note this is exactly what Siamak Kalhor Consulting fixes, and that we can advise OR build them a fast, modern site."
}

SCORING GUIDANCE:
- SEO: title tag quality, meta description presence, headings, keywords matching their service+location, mobile signals, clarity for Google.
- LLMO (AI/LLM Optimization): is the business name, what they do, who they serve, location, and contact info stated in plain text an AI can extract? Structured, factual, unambiguous copy scores high; vague/image-only/jargon scores low. This is a NEW competitive edge — explain it simply.
- POSITIONING: is it instantly clear what they do, who it's for, and why pick them over a competitor? Unique value, proof, credibility.
- CONTENT: relevance to their audience, trust signals (reviews, license #, years in business), freshness, clear calls-to-action.
Be generous but honest. A weak site should score 30-55 with clear fixes; a strong site 75-90. Keep every fix concrete and jargon-free.`;

    const user = 'Audit this website: ' + url + ' (host: ' + host + ')\n\n--- FETCHED CONTENT ---\n' + pageText;

    const aResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1800,
        system: system,
        messages: [{ role: 'user', content: user }]
      })
    });

    const data = await aResp.json();
    let txt = '';
    if (data && Array.isArray(data.content)) {
      txt = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    }
    if (!txt) {
      return res.status(200).json({ error: "The analysis came back empty. Please try again, or call Siamak at 323-657-7752." });
    }

    // Strip any stray code fences and parse
    txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    let report;
    try { report = JSON.parse(txt); }
    catch (e) {
      // Try to salvage the JSON object
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { try { report = JSON.parse(m[0]); } catch (e2) {} }
    }
    if (!report) {
      return res.status(200).json({ error: "I analyzed the site but couldn't format the report. Please try again." });
    }

    report.url = url;
    report.host = host;
    return res.status(200).json({ ok: true, report: report });

  } catch (err) {
    return res.status(200).json({ error: 'Audit error: ' + err.message });
  }
};
