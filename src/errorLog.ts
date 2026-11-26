/**
 * Pure helpers for tournament-day error reports (errorReporting.ts sends them; supabase/errors.sql stores them).
 * A report says what broke and where, never what anyone typed: no student names, ballot text or comments.
 */

export type ErrorKind = 'page' | 'request';
export type AppError = { id: string; tournamentId: string | null; role: string; area: string; kind: ErrorKind; message: string; at: string };

/** The same message is recorded at most once a minute, and at most 30 reports per page load. */
export const REPEAT_WINDOW_MS = 60_000;
export const MAX_PER_SESSION = 30;
export const MAX_MESSAGE = 300;

/** Returns a gate: call it with a message and it says whether to record it now. */
export function createThrottle(now: () => number = Date.now, limit = MAX_PER_SESSION, windowMs = REPEAT_WINDOW_MS) {
  const last = new Map<string, number>();
  let count = 0;
  return (message: string): boolean => {
    if (count >= limit) return false;
    const time = now(); const previous = last.get(message);
    if (previous !== undefined && time - previous < windowMs) return false;
    last.set(message, time); count += 1;
    return true;
  };
}

/** Removes anything that may be someone's words: quoted text, email addresses, long numbers. */
export function scrub(text: string): string {
  return text
    .replace(/"[^"]*"?/g, '"…"')
    .replace(/[“”][^“”]*[“”]?/g, '“…”')
    .replace(/'[^']*\s[^']*'/g, "'…'")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\d{4,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE);
}

// JavaScript's own errors describe the code ("x is not a function"). Any other error may carry text from
// the server or the page (a database message can name a student), so only its type is kept.
const engineErrors = ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError'];

/** Where in the code an error was thrown: the first stack frame's file and line, e.g. "store.tsx:212". */
function whereThrown(stack: string | undefined): string {
  const frame = (stack ?? '').split('\n').map(line => line.match(/([\w.-]+\.(?:m?js|tsx?|jsx))(?:\?[^:)]*)?:(\d+)/)).find(Boolean);
  return frame ? `${frame[1]}:${frame[2]}` : '';
}

/** A short, content-free description of an uncaught error or rejected promise. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const where = whereThrown(error.stack);
    const text = engineErrors.includes(error.name) ? `${error.name}: ${scrub(error.message)}` : `${error.name || 'Error'} (message not recorded)`;
    return `${text}${where ? ` at ${where}` : ''}`.slice(0, MAX_MESSAGE);
  }
  if (typeof error === 'string') return 'Error (message not recorded)';
  return 'Something other than an error was thrown';
}

/** "ballots", "rpc tab_sheet", "auth token": what a Supabase request was for, from its URL. */
export function requestTarget(url: string): string {
  let path = url;
  try { path = new URL(url, 'http://localhost').pathname; } catch { /* keep as is */ }
  const rest = path.match(/\/rest\/v1\/(rpc\/)?([\w-]+)/);
  if (rest) return rest[1] ? `rpc ${rest[2]}` : rest[2];
  const other = path.match(/\/(auth|functions|storage)\/v1\/([\w-]+)/);
  return other ? `${other[1]} ${other[2]}` : 'request';
}

/**
 * A description of a failed Supabase request, or null when it should not be reported: the report itself
 * (so a failing report can't loop), or a sign-in the person simply got wrong.
 * `status` 0 means the request never got an answer (offline, blocked).
 */
export function describeRequest(method: string, url: string, status: number, code = ''): string | null {
  const target = requestTarget(url);
  if (target === 'app_errors') return null;
  if (target.startsWith('auth ') && status >= 400 && status < 500) return null;
  if (status !== 0 && status < 400) return null;
  const safeCode = /^[\w-]{1,12}$/.test(code) ? code : '';
  return status === 0 ? `${method.toUpperCase()} ${target}: no response (offline or blocked)` : `${method.toUpperCase()} ${target} failed (${status}${safeCode ? `, ${safeCode}` : ''})`;
}
