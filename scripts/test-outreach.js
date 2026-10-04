// Trial check-in emails: the right person gets the right note, once, and the
// note says nothing untrue. Uses lib/outreach.js exactly as the API does.

var o = require('../lib/outreach.js');
var failures = [];
function check(name, cond, d) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}
var DAY = 864e5;
var NOW = Date.parse('2026-10-04T21:00:00Z');
function acct(createdDaysAgo, endsInDays, extra) {
  return Object.assign({ username: 'u', name: 'dusty heiser', company: 'Heiser heating', stripe_status: 'trialing', status: 'active',
    created_at: new Date(NOW - createdDaysAgo * DAY).toISOString(), trial_end: new Date(NOW + endsInDays * DAY).toISOString(),
    profile: { email: 'a@b.com' } }, extra || {});
}
function sentRow(kind, a, daysAgo) { return { kind: kind, trial_end: a.trial_end, status: 'sent', sent_at: new Date(NOW - daysAgo * DAY).toISOString() }; }

console.log('\nwho is due');
check('day 1 of a trial: nothing yet', o.due(acct(1, 29), [], NOW) === null);
check('day 6, 23 days left: getting-started note', o.due(acct(6, 23), [], NOW) === 'welcome');
check('6.6 days left: one-week check-in', o.due(acct(23, 6.6), [], NOW) === 'checkin');
check('1.5 days left: ending note', o.due(acct(28, 1.5), [], NOW) === 'ending');
check('ended 22 days ago: feedback note', o.due(acct(52, -22), [], NOW) === 'winback');
check('ended today (under a day): wait for tomorrow', o.due(acct(30, -0.5), [], NOW) === null);
check('ended 61 days ago: leave them alone', o.due(acct(91, -61), [], NOW) === null);
check('paying customer: never', o.due(acct(10, 5, { stripe_status: 'active' }), [], NOW) === null);
check('no email on file: skipped', o.due(acct(10, 5, { profile: {} }), [], NOW) === null);
check('opted out: never', o.due(acct(10, 5, { no_outreach: true }), [], NOW) === null);

console.log('\nnever twice, never too close together');
var a = acct(23, 6.6);
check('check-in already sent this trial: not again', o.due(a, [sentRow('checkin', a, 4)], NOW) === null);
check('welcome sent 1 day ago: wait (3-day gap) even though check-in is due', o.due(a, [sentRow('welcome', a, 1)], NOW) === null);
check('welcome sent 4 days ago: check-in goes out', o.due(a, [sentRow('welcome', a, 4)], NOW) === 'checkin');
var b = acct(30, -10);
check('failed send does not count as sent', o.due(b, [{ kind: 'winback', trial_end: b.trial_end, status: 'error', sent_at: null }], NOW) === 'winback');
var c = acct(23, 6.6);
var oldTrial = { kind: 'checkin', trial_end: '2026-01-01T00:00:00Z', status: 'sent', sent_at: '2026-01-01T00:00:00Z' };
check('a check-in from an earlier trial does not block this one', o.due(c, [oldTrial], NOW) === 'checkin');

console.log('\nwhat they actually did');
var u0 = o.usage({ jobs: [{ id: 'j1', name: 'Sonoma Vista Residence' }], estimates: [{ id: 'e1', client: 'The Bennetts' }, { id: 'x1784690768073836', client: 'The Bennetts' }] }, []);
check('sample-company records (even copied ones) do not count as usage', u0.total === 0, JSON.stringify(u0));
var u1 = o.usage({ jobs: [{ id: 'x1786662201701854', name: 'Smith kitchen' }] }, [{ type: 'plan_read_ok' }]);
check('a job they created counts', u1.jobs === 1 && u1.total === 1);
check('a plan read is noticed', u1.triedPlan === true);

console.log('\nwhat the letters say');
['welcome', 'checkin', 'ending', 'winback'].forEach(function (k) {
  var m = o.compose(k, { name: 'dusty heiser', company: 'Heiser heating', trial_end: '2026-10-11T12:58:41Z', usage: u0, unsubUrl: 'https://orchamind.com/api/outreach?unsub=x' });
  check(k + ': greets by capitalised first name', /^Hi Dusty,/.test(m.text));
  check(k + ': names their company', m.text.indexOf('Heiser heating') > -1);
  check(k + ': has a working unsubscribe link', m.html.indexOf('Stop these emails') > -1 && m.text.indexOf('unsub=x') > -1);
  check(k + ': signed by Siamak', /Siamak Kalhor/.test(m.text));
  check(k + ': no leftover markdown or undefined', !/\]\(|undefined|NaN/.test(m.text + m.html));
  check(k + ': offers help or customisation', /set it up for you/.test(m.text));
});
var ck = o.compose('checkin', { name: 'Dusty', company: 'Heiser heating', trial_end: '2026-10-11T12:58:41Z', usage: u0 });
check('end date is shown in Pacific time (Oct 11, not a UTC slip)', /October 11/.test(ck.text), ck.text.slice(0, 200));
check('HVAC company gets the heating line', /heating and service work/.test(ck.text));
check('someone who has not used it is offered help, not thanked for usage', /not had a chance/.test(ck.text) && !/Thank you for putting real work/.test(ck.text));
var used = o.compose('checkin', { name: 'Gio', company: 'Alexander Custom Tile & Stone', trial_end: '2026-11-01T14:12:57Z', usage: u1 });
check('someone who used it is thanked, not told they have not', /Thank you for putting real work/.test(used.text) && !/not had a chance/.test(used.text));
check('tile company gets the tile line', /tile and stone/.test(used.text));
check('company names are HTML-escaped', used.html.indexOf('Tile &amp; Stone') > -1);
check('the ending note points to the real Billing page', /Billing page/.test(o.compose('ending', { name: 'x', company: 'y', trial_end: '2026-10-11T12:58:41Z', usage: u0 }).text));
check('no name on file: "Hi there"', /^Hi there,/.test(o.compose('welcome', { name: '', company: '', usage: u0 }).text));

console.log('\nsend-now suggestion');
check('suggests check-in with 5 days left', o.suggest(acct(25, 5), NOW) === 'checkin');
check('suggests feedback after the trial ended', o.suggest(acct(40, -10), NOW) === 'winback');

if (failures.length) { console.error('\n❌  outreach FAILED:\n'); failures.forEach(function (f) { console.error('   • ' + f); }); process.exit(1); }
console.log('✅  outreach: the right note, to the right person, once.\n');
