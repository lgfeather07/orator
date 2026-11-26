import { useEffect, useSyncExternalStore } from 'react';
import { createThrottle, describeError, describeRequest, type AppError, type ErrorKind } from './errorLog';

/**
 * Tournament-day error reports. Uncaught page errors and failed Supabase requests are recorded with the
 * tournament, the person's role and the page they were on (errorLog.ts keeps the message free of content).
 * Signed in, each report is also sent to public.app_errors (supabase/errors.sql), where only the tournament's
 * director can read it, on the Issues tab. In the demo they stay in this page's memory.
 */

type Context = { live: boolean; tournamentId: string | null; role: string; area: string; sub: string };
type Sink = (report: Omit<AppError, 'id' | 'at'>) => Promise<void>;

const context: Context = { live: false, tournamentId: null, role: '', area: '', sub: '' };
const gate = createThrottle();
let sink: Sink | null = null;
let recent: AppError[] = [];
const listeners = new Set<() => void>();
let counter = 0;

/** Where the person is, for the next report. Fields left out keep their value. */
export function setErrorContext(patch: Partial<Context>) { Object.assign(context, patch); }

/** How signed-in reports reach the database (errorsApi.ts sets it). */
export function setErrorSink(next: Sink | null) { sink = next; }

/** Record one problem, unless the same message was recorded in the last minute or this page has sent 30. */
export function recordError(kind: ErrorKind, message: string) {
  if (!message || !gate(message)) return;
  const area = [context.area, context.sub].filter(Boolean).join(' / ').slice(0, 60);
  const report = { tournamentId: context.tournamentId, role: context.role, area, kind, message };
  recent = [{ ...report, id: `local-${++counter}`, at: new Date().toISOString() }, ...recent].slice(0, 50);
  listeners.forEach(listener => listener());
  if (context.live && sink) sink(report).catch(() => undefined);
}

/** Reports recorded on this page since it loaded, newest first. */
export function useRecentErrors(): AppError[] {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => recent);
}

let installed = false;
/** Listen for errors nothing else caught: thrown during rendering or in an event, or a rejected promise. */
export function installPageErrorHandlers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', event => { if (event.error !== undefined || event.message) recordError('page', event.error !== undefined && event.error !== null ? describeError(event.error) : 'Script error (details hidden by the browser)'); });
  window.addEventListener('unhandledrejection', event => recordError('page', `Unhandled: ${describeError(event.reason)}`));
}

/**
 * fetch for the Supabase client: the same as fetch, but a request that fails (an error status, or no answer)
 * is recorded. Only the method, what it was for, the status and the database's error code are kept.
 */
export const watchedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  try {
    const response = await fetch(input, init);
    if (!response.ok) {
      const code = await response.clone().json().then((body: { code?: unknown }) => typeof body?.code === 'string' ? body.code : '', () => '');
      const message = describeRequest(method, url, response.status, code);
      if (message) recordError('request', message);
    }
    return response;
  } catch (caught) {
    // A request the app cancelled on purpose is not a failure.
    if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
      const message = describeRequest(method, url, 0);
      if (message) recordError('request', message);
    }
    throw caught;
  }
};

/** Name the page or tab the person is on while this is shown. */
export function ErrorArea({ role, area, sub }: { role?: string; area?: string; sub?: string }) {
  useEffect(() => {
    if (role !== undefined) setErrorContext({ role });
    if (area !== undefined) setErrorContext({ area });
    if (sub !== undefined) setErrorContext({ sub });
    return () => { if (sub !== undefined) setErrorContext({ sub: '' }); };
  }, [role, area, sub]);
  return null;
}
