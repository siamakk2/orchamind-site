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
// Full shape of the report, so the model fills every nested field as real
// JSON (a loose "object" let it send sections as strings or skip them).
const SEC = { type: 'object', properties: { score: { type: 'integer' }, summary: { type: 'string' },
  fixes: { type: 'array', items: { type: 'string' } } }, required: ['score', 'summary', 'fixes'] };
const STR = { type: 'string' }, STRS = { type: 'array', items: { type: 'string' } };
const REPORT_SCHEMA = { type: 'object', properties: {
  business_name: STR, what_they_do: STR, industry: STR, overall_score: { type: 'integer' }, grade_label: STR, headline: STR,
  scores: { type: 'object', properties: { seo: SEC, llmo: SEC, positioning: SEC, content: SEC }, required: ['seo', 'llmo', 'positioning', 'content'] },
  quick_wins: STRS, ideas: STRS,
  preview: { type: 'object', properties: { logo_text: STR, tagline: STR, hero_headline: STR, hero_sub: STR, primary_cta: STR,
    services: { type: 'array', items: { type: 'object', properties: { title: STR, desc: STR }, required: ['title', 'desc'] } },
    why_us: STRS, about_line: STR, location_line: STR }, required: ['logo_text', 'hero_headline', 'services'] },
  pitch: STR },
  required: ['business_name', 'what_they_do', 'overall_score', 'grade_label', 'headline', 'scores', 'quick_wins', 'ideas', 'preview', 'pitch'] };

// Repair what the model sends instead of rejecting it: sections that arrive
// as JSON strings are parsed, missing pieces get safe defaults. Only a report
// with no usable scores at all counts as a failure.
function normalize(r) {
  const parse = (v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return v; } } return v; };
  r = parse(r);
  if (!r || typeof r !== 'object') return null;
  for (const k of ['scores', 'preview', 'quick_wins', 'ideas']) r[k] = parse(r[k]);
  const sc = r.scores && typeof r.scores === 'object' ? r.scores : null;
  if (!sc) return null;
  const arr = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : (x && (x.text || x.title)) || '')).filter(Boolean) : (typeof v === 'string' && v ? [v] : []));
  const num = (v, d) => { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(0, Math.min(100, n)) : d; };
  let have = 0;
  for (const k of ['seo', 'llmo', 'positioning', 'content']) {
    let x = parse(sc[k]);
    if (typeof x === 'number') x = { score: x };
    if (!x || typeof x !== 'object') x = {};
    if (x.score != null) have++;
    sc[k] = { score: num(x.score, 50), summary: String(x.summary || ''), fixes: arr(x.fixes) };
  }
  if (!have) return null;
  r.scores = sc;
  const avg = Math.round((sc.seo.score + sc.llmo.score + sc.positioning.score + sc.content.score) / 4);
  r.overall_score = num(r.overall_score, avg);
  r.quick_wins = arr(r.quick_wins); r.ideas = arr(r.ideas);
  for (const k of ['business_name', 'what_they_do', 'industry', 'grade_label', 'headline', 'pitch']) r[k] = String(r[k] || '');
  const p = r.preview && typeof r.preview === 'object' ? r.preview : {};
  p.services = (Array.isArray(p.services) ? p.services : []).map((x) => (typeof x === 'string' ? { title: x, desc: '' } : { title: String((x && x.title) || ''), desc: String((x && x.desc) || '') })).filter((x) => x.title);
  p.why_us = arr(p.why_us);
  for (const k of ['logo_text', 'tagline', 'hero_headline', 'hero_sub', 'primary_cta', 'about_line', 'location_line']) p[k] = String(p[k] || '');
  if (!p.logo_text) p.logo_text = r.business_name.slice(0, 22);
  if (!p.primary_cta) p.primary_cta = 'Get in Touch';
  r.preview = p;
  return r;
}


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

    // FIX 4 — properties, not just types. The engine used to report only the
    // @type names, so the model saw "ProfessionalService" with no detail and,
    // told to "suggest extending" existing schema, recommended adding sameAs,
    // areaServed and hasOfferCatalog to a site that already had all three. It
    // was being asked to judge completeness while shown only a label. Now each
    // entity reports what it has and what it lacks, so recommendations can be
    // about real gaps.
    const ENTITY_TYPES = /Organization|LocalBusiness|ProfessionalService|Service|Person|Store|Restaurant|Dentist|Physician|LegalService|Attorney|MedicalBusiness|HomeAndConstructionBusiness|Corporation/i;
    const ORG_PROPS = ['name','url','logo','image','description','address','telephone','email',
                       'geo','openingHoursSpecification','areaServed','sameAs','hasOfferCatalog',
                       'aggregateRating','review','founder','priceRange','contactPoint'];
    const PERSON_PROPS = ['name','url','image','jobTitle','worksFor','sameAs','knowsAbout','alumniOf','description'];
    const ldEntities = [];
    function recordEntity(t, n) {
      if (!ENTITY_TYPES.test(t) || ldEntities.length >= 6) return;
      const props = /Person/i.test(t) && !/Organization|Business/i.test(t) ? PERSON_PROPS : ORG_PROPS;
      const has = [], lacks = [];
      props.forEach(function (k) {
        const v = n[k];
        const present = v !== undefined && v !== null && v !== '' &&
                        !(Array.isArray(v) && v.length === 0);
        if (present) {
          if (k === 'sameAs') has.push('sameAs (' + (Array.isArray(v) ? v.length : 1) + ' profiles)');
          else if (k === 'hasOfferCatalog') {
            const items = (v && v.itemListElement) || [];
            has.push('hasOfferCatalog (' + (Array.isArray(items) ? items.length : 1) + ' offers)');
          }
          else has.push(k);
        } else lacks.push(k);
      });
      // An entity may be declared on this page by reference only. That is not
      // the same as lacking properties, so do not report it as incomplete.
      const referenceOnly = Object.keys(n).filter(function (k) { return k[0] !== '@'; }).length === 0;
      ldEntities.push({ type: t, has: has, lacks: lacks, referenceOnly: referenceOnly });
    }
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
            recordEntity(t, n);
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
      (ldEntities.length ? ldEntities.map(function (e) {
        if (e.referenceOnly) return '- Entity ' + e.type + ': declared by reference only (defined elsewhere)\n';
        return '- Entity ' + e.type + ' HAS: ' + (e.has.join(', ') || 'nothing') + '\n' +
               '  Entity ' + e.type + ' LACKS: ' + (e.lacks.join(', ') || 'nothing') + '\n';
      }).join('') : '') +
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
- NEVER recommend adding something the signals say is already present. If a sitemap exists, do not suggest creating one — suggest improving it.
- Structured data: the signals list, for each entity, the properties it HAS and LACKS. Only ever recommend adding properties from the LACKS list. Recommending a property from the HAS list is a factual error that destroys the report's credibility — the owner will check, find it present, and distrust everything else you said.
- If an entity HAS the important properties, say so and credit it. Do not invent a schema gap to fill a recommendation slot.
- Do NOT recommend adding aggregateRating or review markup to a business's own Organization or LocalBusiness entity. Google treats review markup a business applies to itself as self-serving and ineligible for rich results. If reviews matter, recommend earning them on third-party platforms — Google Business Profile, Yelp, industry directories — instead.
- Of the LACKS list, the properties most worth recommending for a local business are geo, openingHoursSpecification, contactPoint and logo.
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

    // The report comes back through a forced tool call with the full report
    // shape, so the model must return one complete JSON object. Free text was
    // cut off past max_tokens and failed with "couldn't format the report".
    // Anything slightly off is repaired by normalize(); one retry with a
    // bigger budget if nothing usable came back.
    async function ask(maxTokens) {
      const aResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          // Sonnet 5.5 refuses a forced tool_choice; 4.6 supports it and is proven here.
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system: system + '\n\nDeliver the report by calling the submit_report tool with that JSON object as its input.',
          tools: [{ name: 'submit_report', description: 'Submit the finished website report.', input_schema: REPORT_SCHEMA }],
          tool_choice: { type: 'tool', name: 'submit_report' },
          messages: [{ role: 'user', content: user }]
        })
      });
      const data = await aResp.json();
      if (!aResp.ok) { console.error(JSON.stringify({ source: 'audit', status: aResp.status, error: data && data.error })); return { fail: 'api' }; }
      if (data.stop_reason === 'max_tokens') console.error(JSON.stringify({ source: 'audit', truncated: maxTokens }));
      const tool = (data.content || []).find(b => b.type === 'tool_use');
      const fixed = tool && normalize(tool.input);
      if (fixed) return { report: fixed };
      const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { try { const r2 = normalize(JSON.parse(m[0])); if (r2) return { report: r2 }; } catch (e) {} }
      console.error(JSON.stringify({ source: 'audit', unparsed: true, stop: data.stop_reason }));
      return { fail: 'format' };
    }

    let out = await ask(8000);
    if (!out.report && out.fail !== 'api') out = await ask(12000);
    console.log(JSON.stringify({ source: 'audit', host, ok: !!out.report, fail: out.fail || null }));
    if (!out.report) {
      return res.status(200).json({ error: out.fail === 'api'
        ? 'The analysis service is busy right now. Please try again in a minute, or call Siamak at 323-657-7752.'
        : "I analyzed the site but couldn't format the report. Please try again." });
    }
    const report = out.report;

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
