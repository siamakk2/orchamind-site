// Trial check-in emails: who is due for which note, and what it says.
//
// Pure functions only, so the same code drives the daily automation, the admin
// panel preview, and the unit tests (scripts/test-outreach.js).
//
// The sequence, one email at most per run and never two within MIN_GAP_DAYS:
//   welcome  - 3+ days after signup, trial still has more than 7 days left
//   checkin  - 7 days or fewer left (more than 2)
//   ending   - 2 days or fewer left
//   winback  - trial ended 1-60 days ago without converting
// Each kind goes to a person once per trial period (username + kind + trial_end).

var DAY = 864e5;
var MIN_GAP_DAYS = 3;
var WINBACK_MAX_DAYS = 60;

// The sample company that ships with the demo. Records carrying these names are
// not the customer's own work even when they ended up in a real account.
var SEED_NAMES = ['the bennetts', 'm. reynolds', 'j. castellano', 'the bryants', 'the andersons',
  'oak street hoa', 'nguyen rentals', 'sonoma vista residence', 'valley view estate',
  'hillside adu project', 'calistoga pool & deck'];

function isRealRecord(r) {
  if (!r || typeof r !== 'object') return false;
  // Sample records use short ids (j1, e2, d3). Anything a person makes gets a timestamp id.
  if (!/\d{10,}/.test(String(r.id || ''))) return false;
  var names = [r.client, r.name, r.project, r.title].map(function (x) { return String(x || '').trim().toLowerCase(); });
  return !names.some(function (n) { return n && SEED_NAMES.indexOf(n) > -1; });
}

function usage(data, events) {
  data = data || {};
  function n(key) { return Array.isArray(data[key]) ? data[key].filter(isRealRecord).length : 0; }
  var u = { estimates: n('estimates'), jobs: n('jobs'), clients: n('clients'), invoices: n('invoices') };
  u.total = u.estimates + u.jobs + u.clients + u.invoices;
  var ev = Array.isArray(events) ? events : [];
  u.triedPlan = ev.some(function (e) { return /^plan_read/.test(e && e.type || ''); });
  return u;
}

// A plain-English guess at the trade from the company name, used for one sentence.
var TRADES = [
  { re: /heat|hvac|air\b|cooling|mechanical|plumb|furnace/i, key: 'hvac',
    line: 'For heating and service work, most owners start with a replacement or install quote, then use dispatch and scheduling to run the service calls.' },
  { re: /electric/i, key: 'electrical',
    line: 'For electrical work, most owners start with a panel or service-upgrade quote, then use dispatch and scheduling for the crew.' },
  { re: /tile|stone|floor|counter|granite|marble/i, key: 'tile',
    line: 'For tile and stone, the plan reader measures floor and wall areas, so square footage and material quantities come off the drawing instead of a tape.' },
  { re: /arch|design|scape|interior/i, key: 'design',
    line: 'For design work, the 3D walkthrough and the client portal let your clients see the space and approve finishes without a back-and-forth by email.' },
  { re: /construct|build|remodel|contract|homes|develop|restor/i, key: 'gc',
    line: 'For general contracting, dropping in a floor plan for a priced estimate, then change orders and invoices from the same job, is where most of the time comes back.' }
];
function trade(company) {
  for (var i = 0; i < TRADES.length; i++) if (TRADES[i].re.test(String(company || ''))) return TRADES[i];
  return { key: 'other', line: '' };
}

function firstName(name) {
  var f = String(name || '').trim().split(/\s+/)[0] || '';
  if (!f) return 'there';
  return f.charAt(0).toUpperCase() + f.slice(1);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

// Which note, if any, is due for this account right now.
//   acct: { username, created_at, trial_end, stripe_status, status, no_outreach, profile:{email} }
//   sent: rows from outreach_log for this username [{kind, trial_end, sent_at, status}]
function due(acct, sent, now) {
  now = now == null ? Date.now() : now;
  if (!acct || acct.no_outreach) return null;
  var email = String((acct.profile && acct.profile.email) || '').trim();
  if (!email) return null;
  if (acct.stripe_status === 'active') return null;
  if (!acct.trial_end) return null;
  sent = (sent || []).filter(function (s) { return s && s.status === 'sent'; });

  var last = sent.reduce(function (m, s) { return Math.max(m, new Date(s.sent_at || 0).getTime()); }, 0);
  if (last && now - last < MIN_GAP_DAYS * DAY) return null;

  var end = new Date(acct.trial_end).getTime();
  var left = (end - now) / DAY;
  var age = (now - new Date(acct.created_at || acct.trial_end).getTime()) / DAY;
  function already(kind) {
    return sent.some(function (s) { return s.kind === kind && new Date(s.trial_end).getTime() === end; });
  }

  var kind = null;
  if (left <= 0) {
    if (-left >= 1 && -left <= WINBACK_MAX_DAYS) kind = 'winback';
  } else if (left <= 2) kind = 'ending';
  else if (left <= 7) kind = 'checkin';
  else if (age >= 3) kind = 'welcome';
  if (!kind || already(kind)) return null;
  // Someone who just signed up and is already in the last week (short trial) gets
  // the check-in, not a welcome; never send a welcome after the check-in.
  if (kind === 'welcome' && (already('checkin') || already('ending'))) return null;
  return kind;
}

// What the admin "Send now" button would send, ignoring the timing windows.
function suggest(acct, now) {
  now = now == null ? Date.now() : now;
  if (!acct || !acct.trial_end) return 'checkin';
  var left = (new Date(acct.trial_end).getTime() - now) / DAY;
  if (left <= 0) return 'winback';
  if (left <= 2) return 'ending';
  if (left <= 7) return 'checkin';
  return 'welcome';
}

function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

var BOOK = 'https://orchamind.com/book';
var APP = 'https://orchamind.com/app';

// ctx: { name, company, trial_end, usage, unsubUrl }
function compose(kind, ctx) {
  var hi = firstName(ctx.name);
  var co = String(ctx.company || '').trim() || 'your business';
  var t = trade(ctx.company);
  var u = ctx.usage || { total: 0 };
  var endTxt = ctx.trial_end ? fmtDate(ctx.trial_end) : '';
  var unused = !u.total;
  var p = [];   // paragraphs (plain text; links added as [label](url))
  var subject;

  var questions = 'Three quick questions, if you have a minute — even a one-line reply helps:\n'
    + '1. What were you hoping Orchamind would do for ' + co + '?\n'
    + '2. What got in the way, or felt confusing?\n'
    + '3. What would you need it to do before it is worth $500 a month to you?';
  var custom = 'We are a small team and we build Orchamind around the contractors who use it. If something is missing for your trade — your price list, your forms, the way you quote — tell me and we will set it up for you.';

  if (kind === 'welcome') {
    subject = 'Getting started with Orchamind — can I help?';
    p.push('Hi ' + hi + ',');
    p.push('Thanks for trying Orchamind for ' + co + '. I wanted to check in personally and see how the first few days have gone.');
    if (unused) p.push('If you have not had a chance to dig in yet, the fastest way to see what it does is to upload one floor plan, or describe a job in a few sentences. You get a priced, line-by-line estimate in about three minutes, built from your project rather than our sample.');
    else p.push('I can see you have already started setting things up — thank you. If anything has not worked the way you expected, I would really like to hear about it.');
    if (t.line) p.push(t.line);
    p.push('If it is easier, I am happy to do a 15-minute screen-share and build your first estimate together: [pick a time](' + BOOK + ').');
    p.push(custom);
  } else if (kind === 'checkin') {
    subject = 'How is Orchamind working for ' + co + '?';
    p.push('Hi ' + hi + ',');
    p.push('Your Orchamind trial ends on ' + endTxt + ', so I wanted to check in before then — not to sell you anything, just to make sure it has been useful.');
    if (unused) p.push('It looks like you have not had a chance to put a real job in yet, which is completely normal in a busy season. If it would help, send me a plan or a short description of a job you are bidding, and we can walk through it together so you see the estimate with your own numbers.');
    else p.push('Thank you for putting real work into it. I would value your honest take on what is working and what is not.');
    if (t.line) p.push(t.line);
    p.push(questions);
    p.push(custom);
    p.push('And if you just need more time to try it properly, reply and say so — I am happy to extend your trial.');
  } else if (kind === 'ending') {
    subject = 'Your Orchamind trial ends ' + endTxt;
    p.push('Hi ' + hi + ',');
    p.push('A short note: your free trial for ' + co + ' ends on ' + endTxt + '.');
    p.push('If you want to keep going, you can add a payment method on the Billing page in the app menu — [open Orchamind](' + APP + '). Everything you have set up stays exactly where it is.');
    p.push('If you are not sure yet, or you have not had time to really try it, just reply. I would rather give you a couple more weeks than have you decide on a rushed look.');
    p.push(custom);
  } else if (kind === 'winback') {
    subject = 'Could I ask for your honest feedback on Orchamind?';
    p.push('Hi ' + hi + ',');
    p.push('Your Orchamind trial for ' + co + ' ended recently, and I wanted to say thank you for giving it a try.');
    p.push('I would be grateful to know what did not fit — your answer goes straight to me and shapes what we build next.');
    p.push(questions);
    p.push('Since your trial, we have made plan estimates more accurate (the drawing\'s printed dimensions now carry through to the quantities) and made the first steps much simpler. If you would like another look, reply and I will reopen your account for two weeks, no card needed.');
    p.push(custom);
  } else {
    throw new Error('unknown kind ' + kind);
  }

  var sig = 'Siamak Kalhor\nFounder, Orchamind · orchamind.com';
  var text = p.join('\n\n') + '\n\nThank you,\n' + sig
    + (ctx.unsubUrl ? '\n\n—\nPrefer not to get these check-ins? ' + ctx.unsubUrl : '');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  function para(s) {
    var h = esc(s).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#2D7FF9;">$1</a>').replace(/\n/g, '<br>');
    return '<p style="margin:0 0 14px;">' + h + '</p>';
  }
  var html = '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;color:#0A1628;line-height:1.6;max-width:560px;">'
    + p.map(para).join('')
    + '<p style="margin:22px 0 0;">Thank you,<br>Siamak Kalhor<br><span style="color:#5A6B7D;">Founder, Orchamind &middot; <a href="https://orchamind.com" style="color:#2D7FF9;">orchamind.com</a></span></p>'
    + (ctx.unsubUrl ? '<p style="margin:26px 0 0;font-size:12px;color:#9aa7b4;">Prefer not to get these check-ins? <a href="' + esc(ctx.unsubUrl) + '" style="color:#9aa7b4;">Stop these emails</a>.</p>' : '')
    + '</div>';

  return { kind: kind, subject: subject, text: text, html: html };
}

var KIND_LABEL = { welcome: 'Getting started', checkin: '1 week left', ending: 'Ends in 2 days', winback: 'Feedback after trial' };

module.exports = { due: due, suggest: suggest, compose: compose, usage: usage, trade: trade, isRealRecord: isRealRecord,
  firstName: firstName, KIND_LABEL: KIND_LABEL, MIN_GAP_DAYS: MIN_GAP_DAYS, WINBACK_MAX_DAYS: WINBACK_MAX_DAYS };
