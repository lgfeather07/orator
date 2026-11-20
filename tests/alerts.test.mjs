// Unit tests for text and email alerts: run with `npm run test:alerts`.
// Covers phone numbers, the wording of each alert (the same as supabase/alerts.sql), the demo preview, and the
// send-notifications Edge Function's message building and delivery loop with fake providers. The database
// rules (who can queue, who receives, dedupe, claiming) are proven against Postgres separately (see README).
import assert from 'node:assert/strict';
import * as alerts from '../.test-out/alerts/src/alerts.js';
import * as edge from '../.test-out/alerts/supabase/functions/send-notifications/lib.js';
let passed = 0; const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── Phone numbers
test('US numbers in any common format become +1 and ten digits', () => {
  for (const input of ['(402) 555-0123', '402-555-0123', '402.555.0123', '4025550123', '+1 402 555 0123', '1-402-555-0123']) assert.equal(alerts.normalizePhone(input).phone, '+14025550123', input);
  assert.deepEqual(alerts.normalizePhone('  '), { phone: '', error: '' });
});
test('bad numbers are refused with a reason', () => {
  for (const input of ['555-0123', '402555012', '40255501234', '(102) 555-0123', '(402) 155-0123', '402-555-O123', '+44 20 7946 0958']) {
    const result = alerts.normalizePhone(input); assert.equal(result.phone, '', input); assert.ok(result.error.length > 10, input);
  }
});
test('phones are shown formatted and masked', () => {
  assert.equal(alerts.formatPhone('+14025550123'), '(402) 555-0123');
  assert.equal(alerts.maskPhone('+14025550123'), '(•••) •••-••23');
});

// ── Wording
const section = { id: 's1', round: 2, eventId: 'info', division: 'varsity', label: 'Section A', room: 'Room 104', judgeId: 'j1', entryIds: ['e1', 'e2', 'e3'] };
test('student and judge messages are short and specific', () => {
  assert.equal(alerts.studentRoomMessage(section, 3, 3), 'Orator: Round 2 Informative - Room 104 at 9:30 AM. You speak 3rd.');
  assert.equal(alerts.judgeRoomMessage({ ...section, eventId: 'poetry', room: 'Room 108' }, 3), "Orator: You're judging Round 2 Poetry in Room 108 at 9:30 AM. Open your ballot: https://orator-1rab.vercel.app");
  assert.equal(alerts.studentRoomMessage({ ...section, round: 4, division: 'novice' }, 3, 1), 'Orator: Novice Informative final - Room 104 at 1:30 PM. You speak 1st.');
  assert.equal(alerts.roomLabel({ round: 1, eventId: 'extemp', division: 'novice' }, 3), 'Round 1 Novice Extemp');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(alerts.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});
test('every message fits in one plain text', () => {
  const long = { name: 'The Very Long Annual Northeast Nebraska Speech Invitational and Novice Showcase 2026' };
  for (const text of [alerts.studentRoomMessage(section, 3, 6), alerts.judgeRoomMessage({ ...section, eventId: 'duet', division: 'novice', room: 'Band room (overflow)' }, 3), alerts.scheduleMessage(long), alerts.entriesMessage(long, true), alerts.entriesMessage(long, false)]) {
    assert.ok(text.length <= 160, `${text.length}: ${text}`); assert.equal(alerts.smsSegments(text), 1, text);
  }
  assert.equal(alerts.smsSegments('Room 104 — 9:30'), 1);
  assert.equal(alerts.smsSegments('x'.repeat(150) + '’'.repeat(1)), 3, 'one curly quote makes the whole text Unicode');
});

// ── Round preview (mirrors queue_round_alerts)
const settings = (patch) => ({ ...alerts.defaultAlertSettings, ...patch });
const entries = [
  { id: 'e1', student: 'Eli Thompson', school: 'Wrenfield High', eventId: 'info' },
  { id: 'e2', student: 'Nora Patel', school: 'Wrenfield High', eventId: 'info' },
  { id: 'e3', student: 'Maya Rodriguez', school: 'Wrenfield High', eventId: 'info' },
  { id: 'e4', student: 'Maya Rodriguez', school: 'Wrenfield High', eventId: 'poetry' },
];
const people = [
  { id: 'u-maya', name: 'Maya R', rosterName: 'Maya Rodriguez', role: 'student', school: 'wrenfield high', email: 'maya@x.test', settings: settings({ phone: '+14025550101', smsOptIn: true, emailOptIn: true }) },
  { id: 'u-eli', name: 'Eli Thompson', role: 'student', school: 'Wrenfield High', email: 'eli@x.test', settings: settings({ emailOptIn: true, rooms: false }) },
  { id: 'j1', name: 'Judge One', role: 'judge', school: '', email: 'j1@x.test', settings: settings({ phone: '+14025550106', smsOptIn: true }) },
  { id: 'j2', name: 'Judge Two', role: 'judge', school: '', email: 'j2@x.test', settings: settings({ emailOptIn: true, ballots: false }) },
];
const sections = [section, { ...section, id: 's2', eventId: 'poetry', room: 'Room 110', judgeId: 'j2', entryIds: ['e4'] }, { ...section, id: 's0', round: 1, room: 'Room 101' }];
test('round alerts go only to opted-in people, per channel and per event', () => {
  const { planned, unmatched, students } = alerts.roundAlerts({ rounds: 3 }, sections, entries, people, 2);
  assert.equal(unmatched, 1, 'Nora has no account'); assert.equal(students, 3);
  assert.deepEqual(planned.map(item => `${item.person.id} ${item.channel} ${item.address}`), ['u-maya sms +14025550101', 'u-maya email maya@x.test', 'j1 sms +14025550106', 'u-maya sms +14025550101', 'u-maya email maya@x.test']);
  assert.equal(planned[0].message, 'Orator: Round 2 Informative - Room 104 at 9:30 AM. You speak 3rd.');
  assert.equal(planned[3].message, 'Orator: Round 2 Poetry - Room 110 at 9:30 AM. You speak 1st.');
  assert.equal(alerts.roundAlerts({ rounds: 3 }, sections, entries, people, 1).planned.length, 3);
});
test('the demo has sample people, about six in ten opted in, and uses the viewer’s own settings', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, student: `Student ${i}`, school: 'S', eventId: 'info' }));
  const sample = alerts.demoPeople(many, [], {});
  const optedIn = sample.filter(person => person.settings.smsOptIn || person.settings.emailOptIn).length;
  assert.ok(optedIn > 20 && optedIn < 50, String(optedIn));
  assert.ok(sample.every(person => !person.settings.smsOptIn || alerts.normalizePhone(person.settings.phone).phone === person.settings.phone));
  assert.deepEqual(alerts.demoPeople(many, [], {}), sample, 'the same every time');
  const mine = settings({ emailOptIn: true });
  const withMaya = alerts.demoPeople([{ id: 'm', student: 'Maya Rodriguez', school: 'Wrenfield High', eventId: 'info' }], [{ id: 'jl', name: 'Judge Leather', school: '' }], { student: mine, judge: mine });
  assert.equal(withMaya.find(person => person.name === 'Maya Rodriguez').settings, mine);
  assert.equal(withMaya.find(person => person.id === 'jl').settings, mine);
});

// ── Edge Function: configuration
test('channels without every secret are off, and the report names what is missing', () => {
  const none = edge.readConfig({});
  assert.equal(none.sms, null); assert.equal(none.email, null);
  assert.deepEqual(none.missing, { sms: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'], email: ['RESEND_API_KEY', 'NOTIFY_FROM_EMAIL'] });
  const smsOnly = edge.readConfig({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+14025550000', RESEND_API_KEY: ' ' });
  assert.deepEqual(edge.configuredChannels(smsOnly), ['sms']);
  assert.deepEqual(smsOnly.missing, { email: ['RESEND_API_KEY', 'NOTIFY_FROM_EMAIL'] });
});

// ── Edge Function: message building
const row = { id: 'n1', channel: 'sms', address: '+14025550101', message: 'Orator: Round 2 Informative — Room 104 at 9:30 AM. You’re 3rd.', kind: 'rooms', attempts: 1 };
const smsConfig = { accountSid: 'AC123', authToken: 'secret', from: '+14025550000' };
test('a text becomes a Twilio form post in plain characters', () => {
  const request = edge.twilioRequest(smsConfig, row);
  assert.equal(request.url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
  assert.equal(request.init.headers.Authorization, `Basic ${Buffer.from('AC123:secret').toString('base64')}`);
  const form = new URLSearchParams(request.init.body);
  assert.equal(form.get('To'), '+14025550101'); assert.equal(form.get('From'), '+14025550000');
  assert.equal(form.get('Body'), "Orator: Round 2 Informative - Room 104 at 9:30 AM. You're 3rd.");
  assert.equal(alerts.smsSegments(form.get('Body')), 1);
});
test('an email gets a subject, an opt-out footer, a linked URL, and escaped HTML', () => {
  const mail = edge.emailPayload({ apiKey: 're_1', from: 'Orator <alerts@example.com>' }, { ...row, channel: 'email', address: 'maya@x.test', kind: 'ballots', message: "Orator: You're judging Round 2 <Poetry> in Room 108. Open your ballot: https://orator.example" });
  assert.equal(mail.subject, 'Orator: You have a ballot'); assert.deepEqual(mail.to, ['maya@x.test']); assert.equal(mail.from, 'Orator <alerts@example.com>');
  assert.match(mail.text, /^You're judging Round 2 <Poetry>/); assert.match(mail.text, /switch email off/);
  assert.match(mail.html, /&lt;Poetry&gt;/); assert.match(mail.html, /<a href="https:\/\/orator.example">/); assert.doesNotMatch(mail.html, /<Poetry>/);
  const request = edge.resendRequest({ apiKey: 're_1', from: 'a@b.c' }, { ...row, channel: 'email', address: 'maya@x.test' });
  assert.equal(request.init.headers.Authorization, 'Bearer re_1'); assert.equal(request.init.headers['Idempotency-Key'], 'orator-n1');
});
test('provider replies: success, permanent failure, and retryable failure', () => {
  assert.deepEqual(edge.readResponse('Twilio', 201, { sid: 'SM1' }), { ok: true, providerId: 'SM1' });
  assert.deepEqual(edge.readResponse('Resend', 200, { id: 'em_1' }), { ok: true, providerId: 'em_1' });
  assert.deepEqual(edge.readResponse('Twilio', 400, { code: 21211, message: "The 'To' number is not valid." }), { ok: false, error: "Twilio 400 21211: The 'To' number is not valid.", retry: false });
  assert.equal(edge.readResponse('Resend', 429, { name: 'rate_limit_exceeded' }).retry, true);
  assert.equal(edge.readResponse('Twilio', 503, null).retry, true);
});

// ── Edge Function: the delivery loop, with a fake outbox that claims like the database does
function fakeOutbox(rows) {
  const state = new Map(rows.map(item => [item.id, { ...item, status: 'queued', attempts: 0 }]));
  return {
    state,
    claim: async (batch, channels) => {
      const picked = [...state.values()].filter(item => item.status === 'queued' && channels.includes(item.channel)).slice(0, batch);
      picked.forEach(item => { item.status = 'sending'; item.attempts++; });
      return picked.map(item => ({ ...item }));
    },
    finish: async (id, outcome) => { const item = state.get(id); if (item.status !== 'sending') return; item.status = outcome.ok ? 'sent' : outcome.retry && item.attempts < 3 ? 'queued' : 'failed'; item.error = outcome.ok ? '' : outcome.error; },
  };
}
const outboxRows = [
  { id: 'a', channel: 'sms', address: '+14025550101', message: 'one', kind: 'rooms' },
  { id: 'b', channel: 'sms', address: '+14025550102', message: 'two', kind: 'rooms' },
  { id: 'c', channel: 'email', address: 'x@y.z', message: 'three', kind: 'schedule' },
  { id: 'd', channel: 'sms', address: '+14025550103', message: 'four', kind: 'ballots' },
];
test('with no keys, nothing is claimed: rows stay queued and the report says why', async () => {
  const box = fakeOutbox(outboxRows);
  const report = await edge.deliver(box, edge.readConfig({}), {});
  assert.equal(report.claimed, 0); assert.ok([...box.state.values()].every(item => item.status === 'queued'));
  assert.match(report.skipped.sms, /TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER/); assert.match(report.skipped.email, /RESEND_API_KEY/);
});
test('texts only: sent, failed and retried rows are recorded; emails wait', async () => {
  const box = fakeOutbox(outboxRows); const sentTo = [];
  const config = edge.readConfig({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+14025550000' });
  const sms = async item => { sentTo.push(item.address); if (item.id === 'b') return { ok: false, error: 'Twilio 400 21211', retry: false }; if (item.id === 'd') throw new Error('socket hang up'); return { ok: true, providerId: 'SM' + item.id }; };
  const report = await edge.deliver(box, config, { sms });
  assert.deepEqual(report, { sent: 1, failed: 1, retrying: 1, claimed: 3, skipped: { email: 'Not configured: set RESEND_API_KEY, NOTIFY_FROM_EMAIL. Rows stay queued.' } });
  assert.deepEqual(Object.fromEntries([...box.state.values()].map(item => [item.id, item.status])), { a: 'sent', b: 'failed', c: 'queued', d: 'queued' });
  assert.match(box.state.get('d').error, /Network error: socket hang up/);
  // Running again only retries the network failure; nothing is sent twice.
  const again = await edge.deliver(box, config, { sms: async item => { sentTo.push(item.address); return { ok: true, providerId: 'x' }; } });
  assert.equal(again.sent, 1); assert.deepEqual(sentTo, ['+14025550101', '+14025550102', '+14025550103', '+14025550103']);
  assert.equal((await edge.deliver(box, config, { sms })).claimed, 0, 'a third run finds nothing to do');
});
test('two runs at once never send the same row', async () => {
  const box = fakeOutbox(outboxRows.map(item => ({ ...item, channel: 'sms' }))); const sent = [];
  const config = edge.readConfig({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+1' });
  const slow = async item => { await new Promise(resolve => setTimeout(resolve, 5)); sent.push(item.id); return { ok: true, providerId: '' }; };
  await Promise.all([edge.deliver(box, config, { sms: slow }, 2), edge.deliver(box, config, { sms: slow }, 2), edge.deliver(box, config, { sms: slow }, 2)]);
  assert.deepEqual([...sent].sort(), ['a', 'b', 'c', 'd']);
});

for (const [name, fn] of tests) { await fn(); passed++; console.log('ok -', name); }
console.log(`\n${passed} alert tests passed`);
