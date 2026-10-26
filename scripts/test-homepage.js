// Homepage refresh: years in business are 40 everywhere, the 3D build hero and
// new sections are wired, and every image they use exists.
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var failures = [];
function check(n, c, d) { if (c) process.stdout.write('  ✓ ' + n + '\n'); else { failures.push(n + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + n + '\n'); } }
console.log('\nhomepage');
var files = ['index.html', 'llms.txt', 'api/chat.js'];
files.forEach(function (f) {
  var s = fs.readFileSync(path.join(root, f), 'utf8');
  check(f + ': no "35 years" claim left', !/\b35\+?\s*(years|yrs)\b/i.test(s), (s.match(/.{0,40}\b35\+?\s*(years|yrs).{0,20}/i) || [''])[0]);
});
check('founder badge says 40 years in business', /<span class="fb">40 years in business<\/span>/.test(html));
check('hero has the 3D build stage', /id="buildStage"/.test(html) && /class="bs-canvas"/.test(html));
check('hero loads hero-build.js (deferred)', /<script defer src="\/hero-build\.js"><\/script>/.test(html));
check('voice demo still present (typed / cmdResult / resultText)', /id="typed"/.test(html) && /id="cmdResult"/.test(html) && /id="resultText"/.test(html));
check('plans-to-3D section present', /id="plans-to-3d"/.test(html));
check('crews section present before industries', html.indexOf('id="crews"') > 0 && html.indexOf('id="crews"') < html.indexOf('id="industries"'));
var imgs = (html.match(/\/media\/home\/[a-z0-9-]+\.webp/g) || []);
check('new images referenced', imgs.length >= 10, imgs.length + '');
var missing = imgs.filter(function (p) { return !fs.existsSync(path.join(root, p)); });
check('every referenced image exists', !missing.length, missing.join(', '));
var tags = html.match(/<img[^>]+\/media\/home\/[^>]+>/g) || [];
check('every new image has alt, width and height', tags.every(function (t) { return /\balt="/.test(t) && /\bwidth="\d+"/.test(t) && /\bheight="\d+"/.test(t); }));
var js = fs.readFileSync(path.join(root, 'hero-build.js'), 'utf8');
check('3D loads three.js only from cdnjs', /cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/.test(js));
check('3D respects reduced motion', /prefers-reduced-motion/.test(js));
check('3D has an image fallback without WebGL', /plan3d-1200\.webp/.test(js));
if (failures.length) { console.error('\n❌  homepage FAILED:\n   • ' + failures.join('\n   • ')); process.exit(1); }
console.log('✅  homepage: 40 years, 3D hero, plans-to-3D and crews all wired.\n');
