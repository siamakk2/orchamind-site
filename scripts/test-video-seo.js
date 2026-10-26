// Video pages Google can index: the watch page carries a complete VideoObject,
// the files exist, the video sitemap lists it, and no page points its
// canonical at somebody else's address (three feature pages used to point at
// the homepage, which tells Google not to index them).
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var failures = [];
function check(n, c, d) { if (c) process.stdout.write('  ✓ ' + n + '\n'); else { failures.push(n + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + n + '\n'); } }
console.log('\nvideo SEO');
var W = 'videos/meet-orchamind/index.html', URL = 'https://orchamind.com/videos/meet-orchamind/';
var w = fs.readFileSync(path.join(root, W), 'utf8');
check('watch page is indexable', !/<meta name="robots" content="[^"]*noindex/i.test(w));
check('watch page canonical is itself', w.indexOf('<link rel="canonical" href="' + URL + '"/>') > -1);
check('exactly one canonical', (w.match(/rel="canonical"/g) || []).length === 1);
var vids = [];
(w.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []).forEach(function (b) {
  var d = JSON.parse(b.replace(/^<script[^>]*>|<\/script>$/g, ''));
  (d['@graph'] || [d]).forEach(function (x) { if (x['@type'] === 'VideoObject') vids.push(x); });
});
check('one VideoObject', vids.length === 1, vids.length + '');
var v = vids[0] || {};
['name', 'description', 'thumbnailUrl', 'uploadDate', 'contentUrl', 'duration', 'transcript'].forEach(function (k) { check('VideoObject has ' + k, !!v[k]); });
check('upload date is a full ISO date with time zone', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(v.uploadDate || ''));
function local(u) { return path.join(root, String(u).replace('https://orchamind.com/', '')); }
check('video file exists', fs.existsSync(local(v.contentUrl)));
[].concat(v.thumbnailUrl || []).forEach(function (u) { check('thumbnail exists: ' + u.split('/').pop(), fs.existsSync(local(u))); });
check('video element plays the same file', w.indexOf('<source src="/media/video/meet-orchamind.mp4" type="video/mp4">') > -1);
check('transcript text is on the page', /id="transcript"/.test(w) && w.indexOf('Meet Orchamind. It') > -1);
check('no leftover Job Reports schema', !/"HowTo"|"FAQPage"/.test(w));
var sm = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
check('sitemap declares the video namespace', /xmlns:video="http:\/\/www\.google\.com\/schemas\/sitemap-video\/1\.1"/.test(sm));
check('sitemap lists the watch page with its video', sm.indexOf('<loc>' + URL + '</loc>') > -1 && /<video:content_loc>https:\/\/orchamind\.com\/media\/video\/meet-orchamind\.mp4<\/video:content_loc>/.test(sm));
var robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
check('robots.txt points to the sitemap', /Sitemap: https:\/\/orchamind\.com\/sitemap\.xml/.test(robots));
check('robots.txt does not block /media/ or /videos/', !/Disallow:\s*\/(media|videos)\b/.test(robots));
var home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
check('homepage embeds the video and links the watch page', home.indexOf('/media/video/meet-orchamind.mp4') > -1 && home.indexOf('href="/videos/meet-orchamind/"') > -1);
['features', 'features/job-reports', 'features/plan-takeoff', 'features/materials-calculator'].forEach(function (p) {
  var s = fs.readFileSync(path.join(root, p, 'index.html'), 'utf8');
  check(p + ': canonical is its own address', s.indexOf('<link rel="canonical" href="https://orchamind.com/' + p + '/"') > -1);
});
if (failures.length) { console.error('\n❌  video SEO FAILED:\n   • ' + failures.join('\n   • ')); process.exit(1); }
console.log('✅  video SEO: watch page, schema, files, sitemap and canonicals are right.\n');
