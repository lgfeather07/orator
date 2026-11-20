import { supabase } from './auth';
import type { AlertChannel, AlertKind, AlertSettings } from './alerts';

/** Text and email alerts in the database (supabase/alerts.sql). */
const fail = (message: string): never => {
  if (/could not find|schema cache|does not exist/i.test(message)) throw new Error('Alerts need a database update. Run supabase/alerts.sql in the Supabase SQL Editor.');
  if (/notification_phone_format/i.test(message)) throw new Error('Enter a 10-digit US mobile number.');
  if (/notification_sms_needs_phone/i.test(message)) throw new Error('Add your mobile number to get texts.');
  if (/row-level security/i.test(message)) throw new Error('You don’t have permission to do that.');
  throw new Error(message);
};
const db = () => supabase ?? fail('Accounts are not connected.');
/** A function returning one JSON value comes back as the value (or, through some proxies, a one-item list). */
const single = <T>(data: unknown) => (Array.isArray(data) ? data[0] : data) as T;

type SettingsRecord = { phone: string; sms_opt_in: boolean; email_opt_in: boolean; alert_rooms: boolean; alert_ballots: boolean; alert_schedule: boolean; alert_entries: boolean; sms_consent_at: string | null };
const toSettings = (row: SettingsRecord): AlertSettings => ({ phone: row.phone ?? '', smsOptIn: row.sms_opt_in, emailOptIn: row.email_opt_in, rooms: row.alert_rooms, ballots: row.alert_ballots, schedule: row.alert_schedule, entries: row.alert_entries, smsConsentAt: row.sms_consent_at });

/** The signed-in person's own settings, or null if they've never saved any. */
export async function loadMyAlertSettings(userId: string): Promise<AlertSettings | null> {
  const { data, error } = await db().from('notification_settings').select('phone, sms_opt_in, email_opt_in, alert_rooms, alert_ballots, alert_schedule, alert_entries, sms_consent_at').eq('user_id', userId).limit(1);
  if (error) fail(error.message);
  const row = (data ?? [])[0] as SettingsRecord | undefined;
  return row ? toSettings(row) : null;
}

/** Save the signed-in person's settings. `consent` is the wording they agreed to when switching texts on. */
export async function saveMyAlertSettings(userId: string, settings: AlertSettings, consent: string): Promise<void> {
  const { error } = await db().from('notification_settings').upsert({
    user_id: userId, phone: settings.phone, sms_opt_in: settings.smsOptIn, email_opt_in: settings.emailOptIn,
    alert_rooms: settings.rooms, alert_ballots: settings.ballots, alert_schedule: settings.schedule, alert_entries: settings.entries, sms_consent_text: settings.smsOptIn ? consent : '',
  }, { onConflict: 'user_id' });
  if (error) fail(error.message);
}

export type AlertStatus = 'queued' | 'sending' | 'sent' | 'failed';
export type AlertRow = { id: string; channel: AlertChannel; kind: AlertKind; message: string; status: AlertStatus; error: string; createdAt: string; sentAt: string | null };
type AlertRecord = { id: string; channel: AlertChannel; kind: AlertKind; message: string; status: AlertStatus; error: string; created_at: string; sent_at: string | null };
const toAlert = (row: AlertRecord): AlertRow => ({ id: row.id, channel: row.channel, kind: row.kind, message: row.message, status: row.status, error: row.error, createdAt: row.created_at, sentAt: row.sent_at });
const alertColumns = 'id, channel, kind, message, status, error, created_at, sent_at';

/** Alerts sent (or waiting) to the signed-in person, newest first. */
export async function listMyAlerts(userId: string, limit = 6): Promise<AlertRow[]> {
  const { data, error } = await db().from('notifications').select(alertColumns).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  if (error) fail(error.message);
  return ((data ?? []) as AlertRecord[]).map(toAlert);
}

/** The latest alerts for a tournament. Only its director gets rows back. */
export async function listTournamentAlerts(tournamentId: string, limit = 12): Promise<AlertRow[]> {
  const { data, error } = await db().from('notifications').select(alertColumns).eq('tournament_id', tournamentId).order('created_at', { ascending: false }).limit(limit);
  if (error) fail(error.message);
  return ((data ?? []) as AlertRecord[]).map(toAlert);
}

export type RoundAlertResult = { queued: number; alreadyQueued: number; students: number; judges: number; unmatched: number; rooms: number };
/** The director sends room alerts for one round. Pressing again only queues messages that changed. */
export async function queueRoundAlerts(tournamentId: string, round: number): Promise<RoundAlertResult> {
  const { data, error } = await db().rpc('queue_round_alerts', { target: tournamentId, round_number: round });
  if (error) fail(error.message);
  return single<RoundAlertResult>(data);
}

export type AlertSummary = {
  queued: number; sending: number; sent: number; failed: number; oldestQueued: string | null; lastSent: string | null;
  members: number; optedIn: number; textOptIns: number; emailOptIns: number; byRole: { student: number; judge: number; coach: number };
  errors: { channel: AlertChannel; kind: AlertKind; error: string; at: string }[];
};
/** Counts for the director: what's queued, sent and failed, and how many members opted in. No contact details. */
export async function loadAlertSummary(tournamentId: string): Promise<AlertSummary> {
  const { data, error } = await db().rpc('alert_summary', { target: tournamentId });
  if (error) fail(error.message);
  return single<AlertSummary>(data);
}
