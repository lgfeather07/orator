/**
 * Ballots that survive bad wifi. Every change a judge makes is also kept on their own device, so a dropped
 * connection or a reloaded page loses nothing. A ballot submitted while offline waits in an outbox on the
 * device and is sent as soon as the connection is back, even if the judge has moved on to another room.
 */
import { useEffect, useState } from 'react';
import { saveBallot, type BallotKey, type EntryInput } from './ballotApi';

const DRAFT = 'orator-ballot-draft:';
const OUTBOX = 'orator-ballot-outbox:';

/** One device-local key per judge, tournament, round and room. */
export const localKey = (userId: string, key: BallotKey) => `${userId}|${key.tournament}|${key.round}|${key.room}`;

/** What the ballot screen needs to come back exactly as the judge left it. */
export type LocalDraft<B> = {
  ballots: Record<string, B>; order: string[]; eventId: string; classA: boolean; ballotId: string | null;
  presence: Record<string, 'present' | 'absent' | undefined>;
  /** True while the device holds changes the server hasn't saved yet. */
  unsynced: boolean;
  at: number;
};

/** A submission waiting for the connection: everything saveBallot needs. */
export type Pending = {
  key: BallotKey; ballotId: string | null; eventId: string; classA: boolean; entries: EntryInput[];
  link?: { tournamentId: string; sectionId: string };
  at: number;
};

const read = <T,>(name: string): T | null => { try { const raw = localStorage.getItem(name); return raw ? JSON.parse(raw) as T : null; } catch { return null; } };
const write = (name: string, value: unknown) => { try { localStorage.setItem(name, JSON.stringify(value)); return true; } catch { return false; } };
const remove = (name: string) => { try { localStorage.removeItem(name); } catch { /* storage off */ } };

export const readDraft = <B,>(id: string) => read<LocalDraft<B>>(DRAFT + id);
export const writeDraft = <B,>(id: string, draft: LocalDraft<B>) => write(DRAFT + id, draft);
export const clearDraft = (id: string) => remove(DRAFT + id);

export const readPending = (id: string) => read<Pending>(OUTBOX + id);
export const queueSubmit = (id: string, pending: Pending) => { const ok = write(OUTBOX + id, pending); notify(); return ok; };
const clearPending = (id: string) => { remove(OUTBOX + id); notify(); };

/** Every submission still waiting on this device, oldest first. */
export function pendingSubmissions(): { id: string; pending: Pending }[] {
  const found: { id: string; pending: Pending }[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const name = localStorage.key(index);
      if (!name?.startsWith(OUTBOX)) continue;
      const pending = read<Pending>(name);
      if (pending) found.push({ id: name.slice(OUTBOX.length), pending });
    }
  } catch { /* storage off */ }
  return found.sort((a, b) => a.pending.at - b.pending.at);
}

/**
 * Is this a lost connection rather than the server saying no? A refusal (a missing time, ranks with gaps) must be
 * shown to the judge to fix, not retried forever.
 */
export function isConnectionProblem(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|err_internet|err_network|timed? ?out|typeerror: fetch/i.test(text);
}

let flushing: Promise<number> | null = null;
/**
 * Send every waiting submission. Returns how many went through. A submission the server refuses outright (not a
 * connection problem) leaves the queue and stays a draft on this device, so the judge can open it and fix it.
 */
export function flushOutbox(onSent?: (id: string, pending: Pending) => void): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const { id, pending } of pendingSubmissions()) {
      try {
        await saveBallot(pending.key, pending.ballotId, pending.eventId, pending.classA, pending.entries, true, pending.link);
        clearPending(id); clearDraft(id); sent++; onSent?.(id, pending);
      } catch (error) {
        if (isConnectionProblem(error)) break; // Still offline: try again later.
        // The server said no (not a lost connection). Stop retrying: the ballot goes back to a draft that is still
        // on this device, and reopening it shows the judge what to fix when they submit again.
        lastRefusal = error instanceof Error ? error.message : 'The server refused this ballot.';
        clearPending(id);
      }
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

let lastRefusal = '';
/** Why the most recent queued ballot couldn't be sent, if the server refused it. */
export const outboxRefusal = () => lastRefusal;

// Screens that show the outbox re-render when it changes.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/** Whether the browser thinks it is online, kept up to date. */
export function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/**
 * Keep sending waiting ballots: on load, when the connection comes back, and every 20 seconds while any wait.
 * Returns how many are still waiting, for a status line. `onSent` runs after each one goes through.
 */
export function useBallotOutbox(enabled: boolean, onSent?: () => void) {
  const [waiting, setWaiting] = useState(() => enabled ? pendingSubmissions().length : 0);
  useEffect(() => {
    if (!enabled) return;
    const count = () => setWaiting(pendingSubmissions().length);
    listeners.add(count);
    const tryNow = () => { if (pendingSubmissions().length) flushOutbox().then(sent => { count(); if (sent) onSent?.(); }); };
    tryNow();
    window.addEventListener('online', tryNow);
    const timer = window.setInterval(tryNow, 20000);
    return () => { listeners.delete(count); window.removeEventListener('online', tryNow); window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return waiting;
}
