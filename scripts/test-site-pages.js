// Unified site: every public page shares one header/footer, and each main-menu
// item has its own page with a self canonical, valid JSON-LD and working links.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const root = path.join(__dirname, '..');
let fail = 0; const bad = (m) => { fail++; console.error('FAIL', m); };
try { execSync('python3 scripts/build-chrome.py --check', { cwd: root, stdio: 'pipe' }); }
catch (e) { bad('header/footer out of date: run python3 scripts/build-chrome.py\n' + (e.stdout || '')); }
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const rewrites = new Set((vercel.rewrites || []).map(r => r.source));
function exists(href) {
  const u = href.split(/[?#]/)[0];
  if (!u || u === '/') return true;
  if (rewrites.has(u) || rewrites.has(u.replace(/\/$/, ''))) return true;
  const f = path.join(root, u);
  return [f, f + '.html', path.join(f, 'index.html')].some(p => fs.existsSync(p) && fs.statSync(p).isFile());
}
const NEW = ['what-is-orchamind', 'how-it-works', 'pricing', 'about', 'industries', 'resources'];
for (const slug of NEW) {
  const file = path.join(root, slug, 'index.html');
  if (!fs.existsSync(file)) { bad(slug + ' missing'); continue; }
  const h = fs.readFileSync(file, 'utf8');
  if (!h.includes(`<link rel="canonical" href="https://orchamind.com/${slug}/">`)) bad(slug + ' canonical');
  if ((h.match(/<h1[\s>]/g) || []).length !== 1) bad(slug + ' needs exactly one h1');
  if (!h.includes('<!-- OM:HEADER -->') || !h.includes('<!-- OM:FOOTER -->')) bad(slug + ' shared chrome');
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { bad(slug + ' ld+json: ' + e.message); }
  }
  for (const m of h.matchAll(/href="(\/[^"]*)"/g)) if (!exists(m[1])) bad(`${slug} links to missing ${m[1]}`);
  if (!fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').includes(`https://orchamind.com/${slug}/</loc>`)) bad(slug + ' not in sitemap');
}
// Menu and footer links on the homepage resolve.
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const chrome = home.slice(home.indexOf('<!-- OM:HEADER -->'), home.indexOf('<!-- /OM:HEADER -->')) +
  home.slice(home.indexOf('<!-- OM:FOOTER -->'), home.indexOf('<!-- /OM:FOOTER -->'));
for (const m of chrome.matchAll(/href="(\/[^"]*)"/g)) if (!exists(m[1])) bad('menu/footer links to missing ' + m[1]);
if (fail) { console.error(fail + ' failure(s)'); process.exit(1); }
console.log('site pages: OK (' + NEW.length + ' menu pages, shared chrome, links, schema)');
