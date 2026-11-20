/**
 * The parts of send-notifications that don't need Deno or the network, so they can be unit-tested in Node
 * (`npm run test:alerts`). index.ts wires them to Supabase, Twilio, and Resend.
 */

export type Channel = 'sms' | 'email';
/** A row handed out by public.claim_notifications. */
export type Claimed = { id: string; channel: Channel; address: string; message: string; kind: string; attempts: number };
export type Env = Record<string, string | undefined>;

export type Config = {
  sms: { accountSid: string; authToken: string; from: string } | null;
  email: { apiKey: string; from: string } | null;
  /** Why a channel is off, naming the missing secrets. */
  missing: Partial<Record<Channel, string[]>>;
};

/** Which channels have every secret they need. A channel without them is left queued, not failed. */
export function readConfig(env: Env): Config {
  const need = (names: string[]) => names.filter(name => !(env[name] ?? '').trim());
  const smsMissing = need(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']);
  const emailMissing = need(['RESEND_API_KEY', 'NOTIFY_FROM_EMAIL']);
  return {
    sms: smsMissing.length ? null : { accountSid: env.TWILIO_ACCOUNT_SID!.trim(), authToken: env.TWILIO_AUTH_TOKEN!.trim(), from: env.TWILIO_FROM_NUMBER!.trim() },
    email: emailMissing.length ? null : { apiKey: env.RESEND_API_KEY!.trim(), from: env.NOTIFY_FROM_EMAIL!.trim() },
    missing: { ...(smsMissing.length ? { sms: smsMissing } : {}), ...(emailMissing.length ? { email: emailMissing } : {}) },
  };
}
export const configuredChannels = (config: Config): Channel[] => [...(config.sms ? ['sms' as const] : []), ...(config.email ? ['email' as const] : [])];

/** Swap typographic punctuation for plain characters so a text stays in the 160-character GSM alphabet. */
export function toGsm(text: string) {
  return text.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"').replace(/[‐‑‒–—―]/g, '-').replace(/…/g, '...').replace(/[  ]/g, ' ');
}

/** The form body for Twilio's Messages API. */
export function twilioRequest(config: NonNullable<Config['sms']>, row: Claimed) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const body = new URLSearchParams({ To: row.address, From: config.from, Body: toGsm(row.message) });
  const auth = `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`;
  return { url, init: { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() } };
}

const subjects: Record<string, string> = { rooms: 'Your room for the next round', ballots: 'You have a ballot', schedule: 'Schedule update', entries: 'Entries update' };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** The email for one row: the same words as the text, a subject, and a footer saying how to stop them. */
export function emailPayload(config: NonNullable<Config['email']>, row: Claimed, site = 'https://orator-1rab.vercel.app') {
  const text = row.message.replace(/^Orator:\s*/, '');
  const footer = `You get these because you turned on email alerts in Orator. To stop them, open Orator, go to Alerts, and switch email off: ${site}`;
  const linked = escapeHtml(text).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return {
    from: config.from, to: [row.address], subject: `Orator: ${subjects[row.kind] ?? 'Tournament alert'}`,
    text: `${text}\n\n--\n${footer}`,
    html: `<p style="font:16px/1.5 system-ui,sans-serif">${linked}</p><p style="font:12px/1.5 system-ui,sans-serif;color:#625d75">${escapeHtml(footer)}</p>`,
  };
}
export function resendRequest(config: NonNullable<Config['email']>, row: Claimed, site?: string) {
  return { url: 'https://api.resend.com/emails', init: { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `orator-${row.id}` }, body: JSON.stringify(emailPayload(config, row, site)) } };
}

/** What a provider's reply means: sent (with its id), or failed and whether trying again could help. */
export type Outcome = { ok: true; providerId: string } | { ok: false; error: string; retry: boolean };
export function readResponse(provider: 'Twilio' | 'Resend', status: number, body: unknown): Outcome {
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (status >= 200 && status < 300) return { ok: true, providerId: String(data.sid ?? data.id ?? '') };
  const detail = [data.code, data.message ?? data.name].filter(part => part !== undefined && part !== '').join(': ');
  // Rate limits and provider outages are worth another try; a bad number or a rejected key is not.
  return { ok: false, error: `${provider} ${status}${detail ? ` ${detail}` : ''}`.slice(0, 500), retry: status === 429 || status >= 500 };
}

export type Transport = (row: Claimed) => Promise<Outcome>;
export type Store = {
  claim: (batch: number, channels: Channel[]) => Promise<Claimed[]>;
  finish: (id: string, outcome: Outcome) => Promise<void>;
};
export type Report = { sent: number; failed: number; retrying: number; claimed: number; skipped: Partial<Record<Channel, string>> };

/**
 * One delivery run: claim up to `batch` rows for the configured channels, send each, record each outcome.
 * A channel with missing secrets is never claimed, so its rows wait in the queue and the report says why.
 * Safe to run at the same time as another run: claiming hands each row to one run only.
 */
export async function deliver(store: Store, config: Config, transports: Partial<Record<Channel, Transport>>, batch = 50): Promise<Report> {
  const channels = configuredChannels(config).filter(channel => transports[channel]);
  const skipped: Report['skipped'] = Object.fromEntries(Object.entries(config.missing).map(([channel, names]) => [channel, `Not configured: set ${names!.join(', ')}. Rows stay queued.`]));
  const report: Report = { sent: 0, failed: 0, retrying: 0, claimed: 0, skipped };
  if (channels.length === 0) return report;
  const rows = await store.claim(batch, channels);
  report.claimed = rows.length;
  for (const row of rows) {
    let outcome: Outcome;
    try { outcome = await transports[row.channel]!(row); }
    catch (caught) { outcome = { ok: false, error: `Network error: ${caught instanceof Error ? caught.message : String(caught)}`.slice(0, 500), retry: true }; }
    await store.finish(row.id, outcome);
    if (outcome.ok) report.sent++; else if (outcome.retry && row.attempts < 3) report.retrying++; else report.failed++;
  }
  return report;
}
