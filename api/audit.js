// Free AI Website Audit engine — by Siamak Kalhor Consulting (Orchamind).
//
// v2 — extraction rewrite.
//
// v1 scored a site from prose alone and made three classes of error:
//   1. The heading regex was /<h[12][^>]*>([^<]{2,120})<\/h[12]>/gi. The [^<]
//      class cannot match a heading containing any nested tag, so a normal H1
//      like `Become the answer<br><span>AI gives.</span>` was skipped
//      entirely. Real pages were reported as having "only two H-tags".
//   2. It never fetched robots.txt or sitemap.xml, so it told sites that
//      already had a sitemap to go and build one.
//   3. It never parsed JSON-LD — the primary signal an assistant uses to
//      ground a citation — while claiming to score AI visibility.
//
// Recommending work a site has already done is the fastest way to lose a
// knowledgeable prospect. v2 measures facts first and asks the model to
// interpret them, rather than asking it to infer what exists.
//
// Response shape is backward compatible; report.signals is additive.
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

    const UA = 'Mozilla/5.0 (compatible; OrchamindAudit/2.0; +https://orchamind.com)';
    let origin = '';
    try { origin = new URL(url).origin; } catch (e) { origin = 'https://' + host; }

    async function grab(target, ms, cap) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms || 10000);
      try {
        const r = await fetch(target, { signal: ctrl.signal, headers: { 'User-Agent': UA }, redirect: 'follow' });
        const b = r.ok ? (await r.text()).slice(0, cap || 200000) : '';
        return { ok: r.ok, status: r.status, body: b };
      } catch (e) {
        return { ok: false, status: 0, body: '', err: e.name === 'AbortError' ? 'timeout' : e.message };
      } finally { clearTimeout(t); }
    }

    // Homepage plus the three files that decide crawl and AI behaviour.
    const [page, robots, sitemap, llms] = await Promise.all([
      grab(url, 12000, 300000),
      grab(origin + '/robots.txt', 6000, 20000),
      grab(origin + '/sitemap.xml', 8000, 400000),
      grab(origin + '/llms.txt', 6000, 40000)
    ]);

    if (!page.ok || !page.body) {
      return res.status(200).json({
        error: "I couldn't load that website (" + (page.err || ('status ' + page.status)) +
               "). Double-check the address, or the site may be blocking automated visits. " +
               "You can still call Siamak at 323-657-7752 for a manual review."
      });
    }

    const html = page.body;
    const strip = function (x) { return x.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); };
    const attr = function (re) { const m = html.match(re); return m ? m[1].trim() : ''; };

    const pageTitle  = attr(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc   = attr(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
    const canonical  = attr(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
    const metaRobots = attr(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i);
    const ogTitle    = attr(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
    const ogImage    = attr(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']*)["']/i);
    const htmlLang   = attr(/<html[^>]+lang=["']([^"']*)["']/i);
    const viewport   = /<meta[^>]+name=["']viewport["']/i.test(html);

    // FIX 1 — headings may contain nested markup; capture H1-H6.
    const headings = [];
    const counts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
    const hre = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let hm;
    while ((hm = hre.exec(html))) {
      const lvl = hm[1];
      const text = strip(hm[2]);
      counts['h' + lvl]++;
      if (text && headings.length < 40) headings.push('H' + lvl + ': ' + text.slice(0, 120));
    }

    // FIX 3 — structured data is the core AI-visibility signal.
    const ldTypes = [];
    let ldBlocks = 0, ldInvalid = 0;
    const ldre = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let lm;
    while ((lm = ldre.exec(html))) {
      ldBlocks++;
      try {
        const parsed = JSON.parse(lm[1].trim());
        const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
        nodes.forEach(function (n) {
          if (n && n['@type']) {
            const t = Array.isArray(n['@type']) ? n['@type'].join('/') : n['@type'];
            if (ldTypes.indexOf(t) === -1) ldTypes.push(t);
          }
        });
      } catch (e) { ldInvalid++; }
    }

    const imgs = html.match(/<img[^>]*>/gi) || [];
    const imgsNoAlt = imgs.filter(function (t) { return !/\balt\s*=\s*["'][^"']+["']/i.test(t); }).length;
    const internalLinks = (html.match(/href=["']\/[^"']*["']/g) || []).length;
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const hasTel = /href=["']tel:/i.test(html);
    const hasMail = /href=["']mailto:/i.test(html);
    const hasForm = /<form/i.test(html);

    // FIX 2 — what actually exists at the crawl-control URLs.
    const sitemapUrls = sitemap.ok ? (sitemap.body.match(/<loc>/g) || []).length : 0;
    const robotsHasSitemap = robots.ok && /sitemap\s*:/i.test(robots.body);
    const robotsAIRules = robots.ok && /(GPTBot|ClaudeBot|PerplexityBot|Google-Extended)/i.test(robots.body);

    const pageText =
      'MEASURED SIGNALS (FACTS from the live site — never contradict these, and\n' +
      'never recommend adding anything listed here as present):\n' +
      '- Title tag: ' + (pageTitle ? '"' + pageTitle + '" (' + pageTitle.length + ' chars)' : 'MISSING') + '\n' +
      '- Meta description: ' + (metaDesc ? '"' + metaDesc + '" (' + metaDesc.length + ' chars)' : 'MISSING') + '\n' +
      '- Canonical tag: ' + (canonical || 'MISSING') + '\n' +
      '- Meta robots: ' + (metaRobots || 'none (indexable)') + '\n' +
      '- Mobile viewport tag: ' + (viewport ? 'present' : 'MISSING') + '\n' +
      '- html lang: ' + (htmlLang || 'MISSING') + '\n' +
      '- Heading counts: H1=' + counts.h1 + ' H2=' + counts.h2 + ' H3=' + counts.h3 +
        ' H4=' + counts.h4 + ' H5=' + counts.h5 + ' H6=' + counts.h6 + '\n' +
      '- Headings found: ' + (headings.join(' | ') || 'NONE') + '\n' +
      '- JSON-LD structured data: ' + (ldBlocks ? ldBlocks + ' block(s), types: ' + (ldTypes.join(', ') || 'unknown') : 'NONE FOUND') +
        (ldInvalid ? ' (' + ldInvalid + ' failed to parse)' : '') + '\n' +
      '- Open Graph: og:title ' + (ogTitle ? 'present' : 'MISSING') + ', og:image ' + (ogImage ? 'present' : 'MISSING') + '\n' +
      '- robots.txt: ' + (robots.ok ? 'present' + (robotsHasSitemap ? ', declares a sitemap' : ', no sitemap directive') +
        (robotsAIRules ? ', contains AI-crawler rules' : '') : 'NOT FOUND') + '\n' +
      '- sitemap.xml: ' + (sitemap.ok ? 'present with ' + sitemapUrls + ' URLs' : 'NOT FOUND at /sitemap.xml') + '\n' +
      '- llms.txt: ' + (llms.ok ? 'present (' + llms.body.length + ' chars)' : 'NOT FOUND') + '\n' +
      '- Images: ' + imgs.length + ' total, ' + imgsNoAlt + ' missing alt text\n' +
      '- Internal links on page: ' + internalLinks + '\n' +
      '- Contact signals: phone link ' + (hasTel ? 'yes' : 'no') + ', email link ' + (hasMail ? 'yes' : 'no') +
        ', form ' + (hasForm ? 'yes' : 'no') + '\n' +
      '- Visible text length: ' + bodyText.length + ' chars\n' +
      '- SCOPE: homepage only.\n\n' +
      'VISIBLE TEXT (excerpt):\n' + bodyText.slice(0, 7000);

    // --- Ask Claude for a structured report + website preview content ---
    const system = `You are the analysis engine behind "Siamak Kalhor Consulting — Your Online Presence Report." You review how a business shows up online and return a concrete, honest, encouraging report a non-technical owner can act on — PLUS ready-to-use content for a website mockup.

CRITICAL ACCURACY RULES:
- You are given a MEASURED SIGNALS block. Those are facts from the live site. Never contradict them.
- NEVER recommend adding something the signals say is already present. If a sitemap exists, do not suggest creating one — suggest improving it. If structured data exists, acknowledge it and suggest extending it.
- You saw the HOMEPAGE ONLY. Never assert that other pages are missing; you cannot know. Phrase such suggestions as "if you don't already have one".
- Use the measured heading counts. Do not estimate them from the text.
- Never invent awards, numbers, review counts or clients you cannot verify.
- If a signal is strong, say so plainly. An honest high score builds more trust than a manufactured problem.

Return ONLY valid JSON (no markdown, no preamble) with this exact shape:
{
  "business_name": "best guess at the business name",
  "what_they_do": "one plain sentence on what this business appears to do",
  "industry": "one or two word category, e.g. General Contractor, Restaurant, Law Firm, Dentist, Salon, Real Estate",
  "overall_score": 0-100 integer,
  "grade_label": "a short friendly label for the score, e.g. 'Good foundation, big upside' or 'Strong, a few gaps'",
  "headline": "one punchy sentence summarizing the single biggest opportunity",
  "scope_note": "one sentence stating this reviewed the homepage only",
  "scores": {
    "seo": {"score": 0-100, "summary": "2 sentences", "fixes": ["specific fix", "specific fix", "specific fix"]},
    "llmo": {"score": 0-100, "summary": "2 sentences on how well AI assistants (ChatGPT, Claude, Google AI) could understand and recommend this business", "fixes": ["specific fix", "specific fix", "specific fix"]},
    "positioning": {"score": 0-100, "summary": "2 sentences on clarity of who they serve and why to choose them", "fixes": ["specific fix", "specific fix", "specific fix"]},
    "content": {"score": 0-100, "summary": "2 sentences on content relevance, freshness, trust signals", "fixes": ["specific fix", "specific fix", "specific fix"]}
  },
  "quick_wins": ["the 4 highest-impact things to do first, each one clear sentence"],
  "ideas": ["3 bigger creative growth ideas tailored to their industry — e.g. a specific content piece, an offer, a local-SEO play, an AI-assistant tactic. Each 1-2 sentences and specific to them."],
  "preview": {
    "logo_text": "short brand name for a logo (<= 22 chars)",
    "tagline": "a short tagline, 2-5 words",
    "hero_headline": "a compelling hero headline, 4-9 words, benefit-driven",
    "hero_sub": "one supporting sentence under the headline",
    "primary_cta": "button text, e.g. 'Get a Free Quote' or 'Book a Table'",
    "services": [
      {"title": "service/offering name", "desc": "one short sentence"},
      {"title": "service/offering name", "desc": "one short sentence"},
      {"title": "service/offering name", "desc": "one short sentence"}
    ],
    "why_us": ["short proof point 3-6 words", "short proof point", "short proof point"],
    "about_line": "one warm sentence they could use as an intro/about blurb",
    "location_line": "city/area served if known, else empty string"
  },
  "pitch": "2 sentences: warmly note this is exactly what Siamak Kalhor Consulting fixes, and that we can advise OR build them a fast, modern, AI-ready site fast."
}

SCORING GUIDANCE:
- SEO: title and meta quality, heading structure (use the MEASURED counts, never a guess), canonical, viewport, alt text, indexability.
- LLMO (AI/LLM Optimization): can an AI extract the business name, what they do, who they serve, location and contact from plain text? Weight STRUCTURED DATA heavily — which JSON-LD types are present, whether an Organization/LocalBusiness entity is declared, and whether llms.txt exists. No structured data is a major LLMO weakness; a rich entity graph is a major strength. Explain it simply.
- POSITIONING: is it instantly clear what they do, who it's for, and why pick them over a competitor? Unique value, proof, credibility.
- CONTENT: relevance to their audience, trust signals (reviews, license #, years in business), freshness, clear calls-to-action.
Be generous but honest. A weak presence scores 30-55 with clear fixes; a strong one 75-90. Keep every fix concrete and jargon-free.
For the "preview" content: write it as polished marketing copy a professional copywriter would put on THIS business's new homepage — confident, specific, benefit-driven, and true to what they actually do.`;

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
        max_tokens: 3000,
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
    if (!report.scope_note) report.scope_note = 'This report reviewed your homepage only.';

    // Additive: raw measurements, so the report is auditable and the front end
    // can show hard facts next to the model's interpretation.
    report.signals = {
      title: pageTitle, title_length: pageTitle.length,
      meta_description: metaDesc, meta_description_length: metaDesc.length,
      canonical: canonical, meta_robots: metaRobots, html_lang: htmlLang, viewport: viewport,
      headings: counts, heading_list: headings,
      jsonld_blocks: ldBlocks, jsonld_types: ldTypes, jsonld_invalid: ldInvalid,
      og_title: !!ogTitle, og_image: !!ogImage,
      robots_txt: robots.ok, robots_declares_sitemap: robotsHasSitemap, robots_ai_rules: robotsAIRules,
      sitemap_found: sitemap.ok, sitemap_urls: sitemapUrls, llms_txt: llms.ok,
      images: imgs.length, images_missing_alt: imgsNoAlt, internal_links: internalLinks,
      has_phone_link: hasTel, has_email_link: hasMail, has_form: hasForm,
      visible_text_length: bodyText.length, scope: 'homepage-only'
    };

    return res.status(200).json({ ok: true, report: report });

  } catch (err) {
    return res.status(200).json({ error: 'Audit error: ' + err.message });
  }
};
