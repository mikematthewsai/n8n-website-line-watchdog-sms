// Checks for workflow/website-and-line-watchdog-sms.json.
// Runs the Code node source straight out of the published workflow file, with n8n's globals
// stubbed and the clock frozen, so every branch of the watchdog is exercised without waiting.
//   cd tests && npm install && node watchdog.test.js
const path = require('path');
const { DateTime, Settings } = require('luxon');
const wf = require(path.join(__dirname, '..', 'workflow', 'website-and-line-watchdog-sms.json'));
const NODE = { plan: 'Plan the checks', judge: 'Judge the websites', decide: 'Decide what to tell you', delivered: 'Mark it delivered' };
const src = n => wf.nodes.find(x => x.name === NODE[n]).parameters.jsCode;

function runCode(code, { nodes, input, state }) {
  const $ = name => {
    if (!(name in nodes)) throw new Error('no node ' + name);
    const items = nodes[name];
    return { first: () => items[0], all: () => items };
  };
  const $input = { all: () => input || [], first: () => (input || [])[0] };
  const $json = (input && input[0] && input[0].json) || {};
  const fn = new Function('$', '$input', '$json', 'DateTime', '$getWorkflowStaticData', '"use strict";\n' + code);
  return fn($, $input, $json, DateTime, () => state);
}

const baseSettings = {
  business_name: 'Test Plumbing', business_number: '+14045550100', owner_cell: '+14045550199',
  timezone: 'America/New_York', websites: 'https://example.com | Call us',
  fails_before_alert: 2, remind_every_hours: 4, balance_floor: 20, block_window_minutes: 60,
  block_alert_count: 3, quiet_start: '21:00', quiet_end: '07:00', routing_alerts_at_night: true, morning_check_in: true,
};
// Made up Twilio style ids, assembled at run time so no SID-shaped string sits in the source.
const fakeSid = (prefix, end) => prefix + '0123456789abcdef0123456789ab' + end;
const goodNumber = { incoming_phone_numbers: [{ voice_url: 'https://hooks.example.com/voice?token=abc', sms_url: 'https://hooks.example.com/sms', voice_application_sid: null, sms_application_sid: '', trunk_sid: null }] };

function check({ settings = {}, http = null, balance = { balance: '84.20', currency: 'USD' }, numbers = goodNumber, messages = { messages: [] }, now, state }) {
  Settings.now = () => Date.now();
  const frozen = DateTime.fromISO(now, { zone: 'America/New_York' }).toMillis();
  Settings.now = () => frozen;
  const nodes = { 'Your settings': [{ json: { ...baseSettings, ...settings } }] };
  nodes['Plan the checks'] = runCode(src('plan'), { nodes, state });
  const httpOut = nodes['Plan the checks'][0].json.watching ? nodes['Plan the checks'].map((p, i) => ({ json: (http || [])[i] || { statusCode: 200, body: '<p>Call us today</p>' } })) : nodes['Plan the checks'];
  nodes['Judge the websites'] = runCode(src('judge'), { nodes, input: httpOut, state });
  nodes['Your Twilio balance'] = [{ json: balance }];
  nodes['How your number is routed'] = [{ json: numbers }];
  nodes['Texts your number sent'] = [{ json: messages }];
  const d = runCode(src('decide'), { nodes, state })[0].json;
  return { d, sites: nodes['Judge the websites'][0].json.sites, plan: nodes['Plan the checks'] };
}
function delivered(state) { runCode(src('delivered'), { nodes: {}, input: [{ json: { sid: 'SM1' } }], state }); }

let pass = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { failN++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra, null, 1) : ''); } };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const day = '2026-09-22';

// ---------- Plan the checks ----------
t('P1 placeholder numbers refused', throws(() => check({ settings: { business_number: '+15555550100' }, now: day + 'T15:00', state: {} }), /example phone numbers/));
t('P2 bad owner cell refused', throws(() => check({ settings: { owner_cell: '12345' }, now: day + 'T15:00', state: {} }), /must both be phone numbers/));
t('P3 bad time zone refused', throws(() => check({ settings: { timezone: 'Mars/Base' }, now: day + 'T15:00', state: {} }), /not a time zone/));
{
  const r = check({ settings: { websites: '' }, now: day + 'T15:00', state: {} });
  t('P4 no websites: watching false, sites empty', r.plan[0].json.watching === false && r.sites.length === 0);
  t('P4b startup text reads right with no websites', /Watching \+14045550100, your Twilio balance and carrier blocking \(no websites listed\)\. Right now: no websites watched/.test(r.d.body), r.d.body);
}
{
  const r = check({ settings: { websites: 'example.com | Call us\n# old site\nhttps://second.example.org/', owner_cell: '(404) 555-0199', block_alert_count: 0, balance_floor: '' }, now: day + 'T15:00', state: {} });
  const p = r.plan.map(i => i.json);
  t('P5 bare domain gets https and keeps required text', p[0].url === 'https://example.com' && p[0].must_contain === 'Call us');
  t('P6 comment line ignored, two sites', p.length === 2 && p[1].label === 'second.example.org');
  t('P7 0 kept, blank falls back to default, cell normalised', p[0].cfg.block_alert_count === 0 && p[0].cfg.balance_floor === 20 && p[0].cfg.owner_cell === '+14045550199');
}

// ---------- Judge the websites ----------
{
  const cases = [
    [{ statusCode: 200, body: 'CALL US now' }, true, ''],
    [{ statusCode: 503, body: '' }, false, 'the server answered 503, a server error'],
    [{ statusCode: 404, body: '' }, false, 'the server answered 404, page not found'],
    [{ error: { message: 'getaddrinfo ENOTFOUND example.com' } }, false, 'does not resolve'],
    [{ error: { message: 'certificate has expired', code: 'CERT_HAS_EXPIRED' } }, false, 'security certificate'],
    [{ error: { message: 'timeout of 15000ms exceeded', code: 'ECONNABORTED' } }, false, 'no answer within 15 seconds'],
    [{ error: 'connect ECONNREFUSED 1.2.3.4:443' }, false, 'refused'],
    [{ statusCode: 200, body: '<h1>Under construction</h1>' }, false, '"Call us" is missing'],
    [{ statusCode: 200, data: 'please call us' }, true, ''],
  ];
  cases.forEach(([resp, ok, reason], i) => {
    const r = check({ http: [resp], now: day + 'T15:00', state: {} });
    t('J' + (i + 1) + ' ' + (reason || 'up'), r.sites[0].ok === ok && r.sites[0].reason.includes(reason), r.sites[0]);
  });
  const bad = check({ settings: { websites: 'not a url' }, now: day + 'T15:00', state: {} });
  t('J10 garbage address reported, not requested', bad.sites[0].ok === false && /not a web address/.test(bad.sites[0].reason), bad.sites[0]);
}

// ---------- Decide: a site going down and coming back ----------
{
  const st = {};
  let r = check({ now: day + 'T15:00', state: st });
  t('D1 first run texts what it watches', r.d.send && /^Watchdog: now on for Test Plumbing\. Watching/.test(r.d.body) && /website up/.test(r.d.body) && /7:00 AM/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T15:05', state: st, http: [{ statusCode: 503 }] });
  t('D2 one failed check: no text', !r.d.send, r.d);
  r = check({ now: day + 'T15:10', state: st, http: [{ statusCode: 503 }] });
  t('D3 second failed check: down alert with first failure time', r.d.send && /example.com is down: the server answered 503/.test(r.d.body) && /3:05 PM/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T16:00', state: st, http: [{ statusCode: 503 }] });
  t('D4 still down inside 4 h: no repeat', !r.d.send, r.d);
  r = check({ now: day + 'T19:10', state: st, http: [{ statusCode: 503 }] });
  t('D5 4 h later: reminder with how long', r.d.send && /still down, 4 h 5 min so far/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T19:15', state: st });
  t('D6 recovery: back up after 4 h 10 min', r.d.send && /back up after 4 h 10 min/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T19:20', state: st, http: [{ statusCode: 503 }] });
  const r2 = check({ now: day + 'T19:25', state: st });
  t('D7 a single blip never texts', !r.d.send && !r2.d.send);
}

// ---------- Decide: quiet hours and the morning check-in ----------
{
  const st = {};
  check({ now: day + 'T15:00', state: st }); delivered(st);
  let r = check({ now: day + 'T22:00', state: st, http: [{ statusCode: 502 }] });
  r = check({ now: day + 'T22:05', state: st, http: [{ statusCode: 502 }] });
  t('D8 down in quiet hours: held, not sent', !r.d.send && r.d.quiet && r.d.held_for_morning === 1, r.d);
  r = check({ now: '2026-09-23T02:10', state: st, http: [{ statusCode: 502 }] });
  t('D9 reminder due in quiet hours: skipped', !r.d.send && r.d.held_for_morning === 1, r.d);
  r = check({ now: '2026-09-23T02:15', state: st });
  t('D10 recovery in quiet hours: held', !r.d.send && r.d.held_for_morning === 2, r.d);
  r = check({ now: '2026-09-23T07:00', state: st });
  t('D11 morning check-in lists the night and the current state', r.d.send && /Morning check-in\. Overnight: 10:05 PM example\.com is down/.test(r.d.body) && /2:15 AM example\.com is back up after 4 h 15 min/.test(r.d.body) && /Right now: website up/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: '2026-09-23T07:05', state: st });
  t('D12 only one check-in a day', !r.d.send, r.d);
  // Down at night and still down at 7: the check-in says so, and no separate reminder rides along.
  check({ now: '2026-09-23T23:00', state: st, http: [{ statusCode: 500 }] });
  check({ now: '2026-09-23T23:05', state: st, http: [{ statusCode: 500 }] });
  r = check({ now: '2026-09-24T07:00', state: st, http: [{ statusCode: 500 }] });
  t('D13 still down at check-in: named in Right now, no extra reminder', r.d.send && /Right now: example\.com down \(the server answered 500/.test(r.d.body) && !/still down/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: '2026-09-24T07:05', state: st, http: [{ statusCode: 500 }] });
  t('D14 no reminder straight after the check-in', !r.d.send, r.d);
}
{
  const st = {};
  check({ settings: { morning_check_in: false }, now: day + 'T15:00', state: st }); delivered(st);
  const r = check({ settings: { morning_check_in: false }, now: '2026-09-23T07:00', state: st });
  t('D15 check-in switched off and a quiet night: nothing sent', !r.d.send, r.d);
}

// ---------- Decide: Twilio balance ----------
{
  const st = {};
  check({ now: day + 'T15:00', state: st }); delivered(st);
  let r = check({ now: day + 'T15:05', state: st, balance: { balance: '14.8', currency: 'USD' } });
  t('D16 balance under the floor', r.d.send && /balance is \$14\.80, under your \$20\.00 floor/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T15:10', state: st, balance: { balance: '14.2', currency: 'USD' } });
  t('D17 no repeat inside 24 h', !r.d.send);
  r = check({ now: '2026-09-23T07:00', state: st, balance: { balance: '9.1', currency: 'USD' } });
  t('D18a morning check-in flags the low balance', /Twilio balance \$9\.10, under your \$20\.00 floor/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: '2026-09-23T15:06', state: st, balance: { balance: '9.1', currency: 'USD' } });
  t('D18 reminder after 24 h', r.d.send && /still low: \$9\.10/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: '2026-09-23T15:30', state: st, balance: { balance: '60', currency: 'USD' } });
  t('D19 topped up', r.d.send && /back up to \$60\.00/.test(r.d.body), r.d.body);
  delivered(st);
  const st2 = {};
  check({ settings: { balance_floor: 0 }, now: day + 'T15:00', state: st2 }); delivered(st2);
  r = check({ settings: { balance_floor: 0 }, now: day + 'T15:05', state: st2, balance: { balance: '0.40', currency: 'USD' } });
  t('D20 floor 0 switches the balance check off', !r.d.send);
  const st3 = {};
  check({ settings: { balance_floor: 1000 }, now: day + 'T15:00', state: st3 }); delivered(st3);
  r = check({ settings: { balance_floor: 1000 }, now: day + 'T15:05', state: st3, balance: { balance: '1234.5', currency: 'USD' } });
  const r3 = check({ settings: { balance_floor: 1000 }, now: day + 'T15:00', state: {}, balance: { balance: '52.2', currency: 'USD' } });
  t('D20b thousands get a comma', /under your \$1,000\.00 floor/.test(r3.d.body), r3.d.body);
}

// ---------- Decide: routing ----------
{
  const st = {};
  check({ now: day + 'T15:00', state: st }); delivered(st);
  const moved = { incoming_phone_numbers: [{ voice_url: 'https://webhooks.twilio.com/v1/Accounts/' + fakeSid('AC', 'cdef') + '/Flows/' + fakeSid('FW', 'cd12') + '?x=1', sms_url: 'https://hooks.example.com/sms' }] };
  let r = check({ now: day + 'T15:05', state: st, numbers: moved });
  t('D21 call routing change: old and new, SIDs shortened, query dropped', r.d.send && /Calls to \+14045550100 used to go to hooks\.example\.com\/voice\. They now go to webhooks\.twilio\.com\/v1\/Accounts\/AC\.\.\.cdef\/Flows\/FW\.\.\.cd12\./.test(r.d.body) && !/token=abc/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T15:10', state: st, numbers: moved });
  t('D22 same routing next check: quiet', !r.d.send);
  r = check({ now: day + 'T23:30', state: st, numbers: { incoming_phone_numbers: [{ voice_application_sid: fakeSid('AP', 'cdef'), sms_url: 'https://hooks.example.com/sms' }] } });
  t('D23 routing change at night is sent at night', r.d.send && r.d.quiet && /TwiML app AP\.\.\.cdef/.test(r.d.body), r.d.body);
  delivered(st);
  const st2 = {};
  check({ settings: { routing_alerts_at_night: false }, now: day + 'T15:00', state: st2 }); delivered(st2);
  r = check({ settings: { routing_alerts_at_night: false }, now: day + 'T23:30', state: st2, numbers: moved });
  t('D24 routing at night switched off: held for morning', !r.d.send && r.d.held_for_morning === 1, r.d);
  r = check({ now: day + 'T15:00', state: {}, numbers: { incoming_phone_numbers: [{ voice_url: '', sms_url: '' }] } });
  t('D25 no handler set is named plainly', /calls go to nowhere, no handler is set/.test(r.d.body), r.d.body);
}
{
  const st = {};
  check({ now: day + 'T15:00', state: st }); delivered(st);
  let r = check({ now: day + 'T23:00', state: st, numbers: { incoming_phone_numbers: [] } });
  t('D26 number gone from the account: urgent, even at night', r.d.send && /is not on your Twilio account any more/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T23:05', state: st, numbers: { incoming_phone_numbers: [] } });
  t('D27 said once', !r.d.send);
  r = check({ now: day + 'T23:10', state: st });
  t('D28 number back', r.d.send && /is back on your Twilio account/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T23:15', state: st, numbers: { error: { message: 'The resource was not found' } } });
  t('D29 Twilio lookup failed: skipped, not reported as missing', !r.d.send, r.d);
}

// ---------- Decide: carrier blocking ----------
{
  const rfc = iso => DateTime.fromISO(iso, { zone: 'America/New_York' }).toRFC2822();
  const msg = (min, status, code, to = '+14045551111') => ({ direction: 'outbound-api', to, status, error_code: code, date_created: rfc(day + 'T15:' + String(min).padStart(2, '0')) });
  const log = { messages: [
    msg(50, 'undelivered', 30007), msg(48, 'undelivered', 30007), msg(45, 'failed', 30034), msg(40, 'undelivered', 30007),
    msg(35, 'delivered', null), msg(30, 'failed', 30003), msg(25, 'delivered', null), msg(20, 'delivered', null), msg(15, 'undelivered', 30006),
    msg(44, 'undelivered', 30007, '+14045550199'), msg(43, 'undelivered', 30007, '+14045550199'),
    { direction: 'inbound', to: '+14045550100', status: 'received', error_code: null, date_created: rfc(day + 'T15:41') },
  ] };
  const st = {};
  check({ now: day + 'T15:00', state: st }); delivered(st);
  let r = check({ now: day + 'T15:55', state: st, messages: log });
  t('D30 blocking alert counts only carrier errors, leaves out texts to the owner', r.d.send && /4 of the 9 texts your number sent in the last 60 min were blocked by carriers: 30007 carrier filtering \(3\), 30034 number not registered for A2P 10DLC \(1\)/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T15:58', state: st, messages: log });
  t('D31 not repeated inside the window', !r.d.send);
  const few = { messages: log.messages.slice(0, 2) };
  r = check({ now: day + 'T15:55', state: (() => { const s = {}; check({ now: day + 'T15:00', state: s }); delivered(s); return s; })(), messages: few });
  t('D32 under the threshold: nothing', !r.d.send);
  r = check({ now: day + 'T15:55', state: {}, messages: { error: { message: 'boom' } } });
  t('D33 log lookup failed: says unknown, no alert', /text log unknown/.test(r.d.body), r.d.body);
}

// ---------- Decide: a text that did not go out is retried ----------
{
  const st = {};
  check({ now: day + 'T15:00', state: st }); delivered(st);
  check({ now: day + 'T15:05', state: st, http: [{ statusCode: 500 }] });
  let r = check({ now: day + 'T15:10', state: st, http: [{ statusCode: 500 }] });
  t('D34 down alert produced', r.d.send);
  // Twilio refused it: "Mark it delivered" never ran.
  r = check({ now: day + 'T15:15', state: st, http: [{ statusCode: 500 }] });
  t('D35 next check sends it again', r.d.send && /example\.com is down/.test(r.d.body), r.d.body);
  r = check({ now: day + 'T15:20', state: st, balance: { balance: '5', currency: 'USD' } });
  t('D36 retried text rides along with a new one as a list', /^Watchdog:\n- example\.com is down/.test(r.d.body) && /- example\.com is back up/.test(r.d.body) && /- Your Twilio balance is \$5\.00/.test(r.d.body), r.d.body);
  delivered(st);
  r = check({ now: day + 'T15:25', state: st, balance: { balance: '5', currency: 'USD' } });
  t('D37 after delivery nothing is repeated', !r.d.send, r.d);
  const st2 = {};
  check({ settings: { morning_check_in: false }, now: day + 'T15:00', state: st2 });
  r = check({ settings: { morning_check_in: false }, now: '2026-09-23T16:00', state: st2 });
  t('D38 an unsent text is dropped after 24 h', !r.d.send, r.d);
}

// ---------- The published file itself ----------
{
  const all = ['plan', 'judge', 'decide', 'delivered'].map(src).join('\n');
  t('H1 no em or en dashes in code', !new RegExp('[' + String.fromCharCode(0x2014, 0x2013) + ']').test(all));
  t('H2 ships with no credentials attached', wf.nodes.every(n => !n.credentials));
  const settings = Object.fromEntries(wf.nodes.find(n => n.name === 'Your settings').parameters.assignments.assignments.map(a => [a.name, a.value]));
  t('H3 ships with the example numbers and the defaults', settings.business_number === '+15555550100' && settings.owner_cell === '+15555550199' && settings.fails_before_alert === 2 && settings.balance_floor === 20 && settings.quiet_start === '21:00');
  const every = wf.nodes.find(n => n.name === 'Every 5 minutes').parameters.rule.interval[0];
  t('H4 schedule is every 5 minutes', every.field === 'minutes' && every.minutesInterval === 5);
  const twilio = wf.nodes.filter(n => n.parameters && n.parameters.nodeCredentialType === 'twilioApi');
  t('H5 five HTTP Request nodes talk to Twilio, as the sticky says', twilio.length === 5);
}
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
