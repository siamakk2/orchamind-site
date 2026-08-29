#!/usr/bin/env node
/**
 * Orchamind app validator.
 *
 * Catches the class of bug that silently killed the entire estimating engine
 * in production: a literal "</script>" (or a raw newline) inside a JavaScript
 * string. The HTML parser ends the script element at the first "</script>" it
 * sees, regardless of JS string context, so a 101 KB block can be truncated
 * mid-expression and never execute. The browser reports nothing useful.
 *
 * This script parses the way a browser does, then hands each block to Node's
 * own parser. Run it before every push.
 *
 *   node scripts/validate-app.js
 *
 * Exit code 0 = safe to ship. 1 = do not push.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['demo.html', 'demo-test.html'];
const BANNED_HOSTS = ['orchamind-site.vercel.app'];

let failures = [];
const fail = (f, msg) => failures.push(`${f}: ${msg}`);

/** Split out script elements exactly as an HTML parser would. */
function scriptBlocks(html) {
  const blocks = [];
  const openRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const attrs = m[1] || '';
    const start = m.index + m[0].length;
    const end = html.indexOf('</script>', start); // first closer wins — same as the browser
    if (end === -1) {
      blocks.push({ attrs, body: html.slice(start), start, unterminated: true });
      break;
    }
    blocks.push({ attrs, body: html.slice(start, end), start, unterminated: false });
    openRe.lastIndex = end + '</script>'.length;
  }
  return blocks;
}

function lineOf(html, offset) {
  return html.slice(0, offset).split('\n').length;
}

for (const file of FILES) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { fail(file, 'missing'); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const blocks = scriptBlocks(html);
  let inlineCount = 0;

  for (const b of blocks) {
    if (b.unterminated) { fail(file, `unterminated <script> at line ${lineOf(html, b.start)}`); continue; }
    if (/\bsrc\s*=/i.test(b.attrs)) continue;
    if (/type\s*=\s*["'](application\/json|text\/template)/i.test(b.attrs)) continue;
    if (!b.body.trim()) continue;
    inlineCount++;

    const line = lineOf(html, b.start);

    // A block that builds HTML containing a <script> tag must close it as
    // "<\/script>". If an opener has no escaped closer after it, the literal
    // "</script>" already truncated this block — that is the bug.
    const openerRe = /<script\b/gi;
    let om;
    while ((om = openerRe.exec(b.body)) !== null) {
      if (b.body.indexOf('<\\/script>', om.index) === -1) {
        fail(file, `block at line ${line} builds a <script> tag whose closer is not escaped — ` +
                   `write "<\\/script>", otherwise the parser ends the block there`);
      }
    }

    // The real test: does Node's parser accept it?
    const tmp = path.join(os.tmpdir(), `om-block-${line}-${process.pid}.js`);
    fs.writeFileSync(tmp, b.body);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      const detail = String(e.stderr || e.message).split('\n').slice(0, 3).join(' ').trim();
      fail(file, `script block at line ${line} is NOT valid JavaScript — the browser will ` +
                 `silently drop all ${b.body.length} bytes of it. ${detail}`);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  }

  if (inlineCount === 0) fail(file, 'no inline script blocks found — extraction is broken');

  for (const host of BANNED_HOSTS) {
    const n = html.split(host).length - 1;
    if (n) fail(file, `${n} link(s) to ${host} — customer-facing CTAs must point at the real domain`);
  }
}

// The two files are served as one app; drift between them ships untested code.
if (FILES.every(f => fs.existsSync(path.join(ROOT, f)))) {
  const [a, b] = FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  if (a !== b) failures.push('demo.html and demo-test.html have diverged — keep them identical');
}

if (failures.length) {
  console.error('\n\u274c  BLOCKED — do not push:\n');
  failures.forEach(f => console.error('   • ' + f));
  console.error(`\n${failures.length} problem(s) found.\n`);
  process.exit(1);
}
console.log('\u2705  App validated: every inline script parses, files in sync, no stray hosts.');
