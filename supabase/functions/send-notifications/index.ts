// Supabase Edge Function (Deno): sends queued Orator alerts by text (Twilio) and email (Resend).
//
//   supabase functions deploy send-notifications
//   supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=+1... RESEND_API_KEY=... NOTIFY_FROM_EMAIL="Orator <alerts@your-domain>"
//
// Run it every minute with pg_cron (see the end of supabase/alerts.sql). Each run claims queued rows with
// public.claim_notifications (FOR UPDATE SKIP LOCKED), sends them, and records each result with
// public.finish_notification, so overlapping runs never send the same row twice. A channel whose secrets
// are missing is skipped and its rows stay queued; the response says which secrets are missing.
import { deliver, readConfig, readResponse, resendRequest, twilioRequest, type Channel, type Claimed, type Outcome, type Store } from './lib.ts';

declare const Deno: { env: { toObject(): Record<string, string> }; serve(handler: (request: Request) => Response | Promise<Response>): void };

const env = Deno.env.toObject();
const supabaseUrl = env.SUPABASE_URL ?? '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const site = env.ORATOR_SITE_URL || 'https://orator-1rab.vercel.app';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? (undefined as T) : await response.json() as T;
}

const store: Store = {
  claim: (batch: number, channels: Channel[]) => rpc<Claimed[]>('claim_notifications', { batch, channels }),
  finish: (id: string, outcome: Outcome) => rpc<void>('finish_notification', outcome.ok
    ? { target: id, ok: true, failure: '', provider: outcome.providerId, retry: false }
    : { target: id, ok: false, failure: outcome.error, provider: '', retry: outcome.retry }),
};

async function post(provider: 'Twilio' | 'Resend', request: { url: string; init: RequestInit }): Promise<Outcome> {
  const response = await fetch(request.url, request.init);
  const body = await response.json().catch(() => ({}));
  return readResponse(provider, response.status, body);
}

Deno.serve(async request => {
  // Only the scheduler (or you, with the service role key) may run a delivery.
  if (!serviceKey || request.headers.get('Authorization') !== `Bearer ${serviceKey}`) return new Response('Unauthorized', { status: 401 });
  const config = readConfig(env);
  try {
    const report = await deliver(store, config, {
      sms: config.sms ? row => post('Twilio', twilioRequest(config.sms!, row)) : undefined,
      email: config.email ? row => post('Resend', resendRequest(config.email!, row, site)) : undefined,
    });
    return Response.json(report);
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : String(caught) }, { status: 500 });
  }
});
