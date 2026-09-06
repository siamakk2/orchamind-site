#!/usr/bin/env node
/**
 * Reachability guard.
 *
 * Three regressions shipped because code was changed without checking that the
 * resulting UI could still be operated:
 *   1. _epvPickPhoto() returned null  -> the <img> was hidden -> .epv-photowrap
 *      (position:relative, no height) collapsed -> the absolutely-positioned
 *      "Generate a real render" button went off-box. /api/render was never
 *      callable. Vercel logs showed zero requests.
 *   2. _epvSyncPreview() returned early -> the metrics block never ran -> a
 *      valid estimate rendered with no Total.
 *   3. save() was gated on an expired trial -> 11 of 16 accounts could not save.
 *
 * All three share a shape: a control the user must reach became unreachable,
 * and every unit test still passed. This asserts reachability itself.
 *
 *   node scripts/check-reachability.js
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'demo.html');
const dom = new JSDOM(fs.readFileSync(FILE, 'utf8'), {
  runScripts: 'dangerously',
  url: 'https://orchamind.com/app',
});
const w = dom.window;
if (!w.fetch) w.fetch = () => new Promise(() => {});  // stub: no network in this check

let failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

setTimeout(() => {
  try {
    // A control is unreachable if it, or any ancestor, is display:none.
    function visible(el) {
      let n = el;
      while (n && n.nodeType === 1) {
        if (n.style && n.style.display === 'none') return false;
        n = n.parentNode;
      }
      return true;
    }

    // --- every modal must expose its primary action ---
    const modals = ['estModal', 'jobModal', 'logModal', 'schModal', 'coModal', 'expModal',
                    'leadModal', 'planModal', 'crewModal', 'subModal', 'hoursModal'];
    modals.forEach(id => {
      const m = w.document.getElementById(id);
      if (!m) return;
      const btns = [...m.querySelectorAll('button')]
        .filter(b => /save|log hours|create/i.test(b.textContent || ''));
      check(btns.length > 0, `${id}: no save/create button found`);
      btns.forEach(b => check(visible(b), `${id}: primary button "${b.textContent.trim()}" is not reachable`));
    });

    // --- the footer must stay put on a very long estimate ---
    const css = fs.readFileSync(FILE, 'utf8');
    check(/\.modal-foot\{[^}]*position:sticky/.test(css),
      '.modal-foot is not sticky - Save scrolls off screen on a long estimate');

    // --- the write path must not be blocked by default ---
    w.IS_REAL_APP = true;
    w._payConnected = false;
    w.CURRENT_USER = { username: 'anyowner', role: 'owner', trialEnd: Math.floor(Date.now() / 1000) - 86400 };
    check(w.omTrialLocked() === false,
      'omTrialLocked() blocks an expired account by default - this locked 11 of 16 accounts');

    // --- totals must render even when no model can be built ---
    w._planFromPlans = true;
    w._planExtracted = { totalPrintedSqft: 1603, stories: 1, elevations: { present: false }, roof: null };
    w._planGeom = null;
    w.document.getElementById('estLines').innerHTML = '';
    w.addEstLine({ desc: 'x', qty: 2, unit: 'ea', price: 100 });
    w.document.getElementById('estTax').value = '0';
    w.recalcEst();
    const metrics = (w.document.getElementById('epvMetrics') || {}).textContent || '';
    check(/Total estimate/.test(metrics),
      'no Total rendered when massing is unavailable - missing geometry must not suppress the numbers');

    // --- the photo box must keep its height, or the render button vanishes ---
    // (checked here: the preview card only exists once the estimate has lines)
    w._epvRealRender = null;
    w.epvSetView('photo');
    const img = w.document.getElementById('epvPhoto');
    const rbtn = w.document.getElementById('epvRenderBtn');
    check(img && img.style.display !== 'none',
      'epvPhoto is hidden - .epv-photowrap collapses and takes the render button with it');
    check(img && !!img.getAttribute('src'),
      'epvPhoto has no src - the box has no height');
    check(rbtn && visible(rbtn), 'the "Generate a real render" button is not reachable');

    // --- validation must move the user to the field it complains about ---
    check(typeof w._estFieldError === 'function',
      'no _estFieldError - "enter a client name" with no way to find the field');

    // --- the two public forms that capture leads must be operable ---
    // Both silently swallowed submissions in production: /book wrote to a table
    // that did not exist and showed a thank-you anyway. A dead Send button here
    // costs a real lead, and no unit test would notice.
    const PUBLIC_FORMS = [
      { file: 'contact/index.html', button: 'ctSend',  label: 'Contact page Send' },
      { file: 'book.html',          button: 'bkGo',    label: '/book submit' },
    ];
    for (const f of PUBLIC_FORMS) {
      const full = path.resolve(__dirname, '..', f.file);
      if (!fs.existsSync(full)) { check(false, `${f.file} is missing`); continue; }
      const src = fs.readFileSync(full, 'utf8');

      check(src.includes(`id="${f.button}"`), `${f.label}: button #${f.button} not found`);

      // It must post somewhere, not just look like a form.
      check(/fetch\(\s*['"]\/api\//.test(src), `${f.label}: form does not POST to an API`);

      // And it must not declare success on failure - the bug that lost every
      // booking while showing "Request sent!".
      const honest = /\.then\(function\s*\(d\)\s*\{[\s\S]{0,200}?d\s*&&\s*d\.queued/.test(src)
                  || /\(d\s*&&\s*d\.queued\)/.test(src);
      check(honest, `${f.label}: success is not gated on the server confirming queued:true`);

      // A blind timer that fires the thank-you regardless must never come back.
      check(!/setTimeout\(\s*bkThanks\s*,/.test(src),
        `${f.label}: a timer fires the thank-you regardless of the server response`);
    }

    if (failures.length) {
      console.error('\n\u274c  UNREACHABLE UI - do not push:\n');
      failures.forEach(f => console.error('   \u2022 ' + f));
      console.error('');
      process.exit(1);
    }
    console.log('\u2705  Reachability: every primary action is on screen and operable.');
    process.exit(0);
  } catch (e) {
    console.error('\u274c  Reachability check threw: ' + e.message);
    process.exit(1);
  }
}, 3000);
