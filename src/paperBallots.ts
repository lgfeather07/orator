/**
 * Paper ballots typed in by the tab room: the checks that catch typos before a ballot is saved.
 * The same rules as the e-ballot (and supabase/paper_ballots.sql): ranks 1..n with no ties for the
 * speakers who performed, points 35–50, and a speaker can't be ranked above someone with more points
 * unless that lower-ranked speaker was lowered for time.
 * Pure functions, so `npm run test:paper` can check them without a browser.
 */
import { MARK_MAX, RATING_MIN, TIME_GRACE_SECONDS, type BallotEvent } from './ballots';

export const RATING_MAX = 50;
export const MARK_COUNT = 5;

/** One speaker's line as typed, kept as text until it is checked. */
export type PaperRow = {
  code: string; name: string;
  noShow: boolean; rank: string; confirm: string; points: string; marks: string[]; time: string; penalty: boolean;
};
export type PaperField = 'rank' | 'confirm' | 'points' | 'marks' | 'time';
/** `required` problems are only shown once the director tries to save; the rest show as they type. */
export type PaperProblem = { code: string; field: PaperField; message: string; required: boolean };
/** What is saved: one line per speaker, in speaking order. */
export type PaperEntry = { code: string; present: boolean; rank: number | null; rating: number | null; time_seconds: number | null; time_penalty: boolean; marks: number[] };

export const blankRow = (code: string, name: string): PaperRow => ({ code, name, noShow: false, rank: '', confirm: '', points: '', marks: ['', '', '', '', ''], time: '', penalty: false });

const whole = (text: string) => /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;

/**
 * A spoken time: "9:41", "9.41", "941" (minutes and seconds), or "10" (minutes).
 * Returns seconds, null when blank, or NaN when it can't be read.
 */
export function parseTime(text: string): number | null {
  const value = text.trim();
  if (value === '') return null;
  const match = value.match(/^(\d{1,2})[:.](\d{2})$/) ?? value.match(/^(\d{1,2})(\d{2})$/);
  if (match) { const seconds = Number(match[2]); return seconds < 60 ? Number(match[1]) * 60 + seconds : NaN; }
  if (/^\d{1,2}$/.test(value)) return Number(value) * 60;
  return NaN;
}
export const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

/** The total of five section marks, or null until all five are valid. The NSAA scale starts at 35. */
export function marksTotal(marks: string[]): number | null {
  const values = marks.map(whole);
  if (values.length !== MARK_COUNT || values.some(mark => mark === null || mark < 1 || mark > MARK_MAX)) return null;
  return Math.max(RATING_MIN, values.reduce<number>((sum, mark) => sum + (mark ?? 0), 0));
}

/** The points a row carries: the marks' total when marks are used, otherwise the typed total. */
export function pointsOf(row: PaperRow, useMarks: boolean): number | null {
  if (row.noShow) return null;
  if (useMarks) return marksTotal(row.marks);
  const points = whole(row.points);
  return points !== null && points >= RATING_MIN && points <= RATING_MAX ? points : null;
}

/** Every problem with a typed ballot. An empty list means it can be saved. */
export function checkPaper(rows: PaperRow[], options: { doubleEntry: boolean; useMarks: boolean }): PaperProblem[] {
  const problems: PaperProblem[] = [];
  const add = (code: string, field: PaperField, message: string, required = false) => problems.push({ code, field, message, required });
  const present = rows.filter(row => !row.noShow);
  const count = present.length;
  const rankOf = new Map<string, number>();

  present.forEach(row => {
    const text = row.rank.trim();
    if (text === '') { add(row.code, 'rank', 'Rank needed (or mark a no-show).', true); return; }
    const rank = whole(text);
    if (rank === null) { add(row.code, 'rank', 'Rank must be a whole number.'); return; }
    if (rank < 1 || rank > count) { add(row.code, 'rank', `Rank must be 1–${count}: ${count} ${count === 1 ? 'speaker' : 'speakers'} performed.`); return; }
    rankOf.set(row.code, rank);
  });
  // No ties: name everyone who shares a rank.
  present.forEach(row => {
    const rank = rankOf.get(row.code); if (rank === undefined) return;
    const others = present.filter(other => other.code !== row.code && rankOf.get(other.code) === rank);
    if (others.length) add(row.code, 'rank', `Rank ${rank} is also given to ${others.map(other => other.name).join(', ')}. No ties.`);
  });

  if (options.doubleEntry) present.forEach(row => {
    if (row.rank.trim() === '') return;
    if (row.confirm.trim() === '') add(row.code, 'confirm', 'Type the rank a second time to confirm it.', true);
    else if (row.confirm.trim() !== row.rank.trim()) add(row.code, 'confirm', `Second entry (${row.confirm.trim()}) doesn’t match the rank (${row.rank.trim()}).`);
  });

  if (options.useMarks) present.forEach(row => {
    const typed = row.marks.filter(mark => mark.trim() !== '');
    if (typed.some(mark => { const value = whole(mark); return value === null || value < 1 || value > MARK_MAX; })) add(row.code, 'marks', `Section marks are 1–${MARK_MAX}.`);
    else if (typed.length < MARK_COUNT) add(row.code, 'marks', `All ${MARK_COUNT} section marks needed.`, true);
  });
  else {
    present.forEach(row => {
      if (row.points.trim() === '') return;
      const points = whole(row.points);
      if (points === null || points < RATING_MIN || points > RATING_MAX) add(row.code, 'points', `Points must be ${RATING_MIN}–${RATING_MAX}.`);
    });
    // Points are optional, but a ballot with some and not others is almost always a missed field.
    const withPoints = present.filter(row => row.points.trim() !== '');
    if (withPoints.length > 0 && withPoints.length < count) present.filter(row => row.points.trim() === '').forEach(row => add(row.code, 'points', 'Points needed: enter points for every speaker, or for none.', true));
  }

  // A higher rank can't have fewer points, unless the lower-ranked speaker was lowered for time.
  const scored = present.filter(row => rankOf.has(row.code) && pointsOf(row, options.useMarks) !== null);
  scored.forEach(below => {
    if (below.penalty) return;
    scored.filter(above => rankOf.get(above.code)! < rankOf.get(below.code)! && pointsOf(above, options.useMarks)! < pointsOf(below, options.useMarks)!).forEach(above => {
      add(below.code, options.useMarks ? 'marks' : 'points', `Ranked ${rankOf.get(below.code)} with ${pointsOf(below, options.useMarks)} points, more than ${above.name} (ranked ${rankOf.get(above.code)}, ${pointsOf(above, options.useMarks)}). Check the ranks and points, or tick the time penalty.`);
    });
  });

  present.forEach(row => {
    const seconds = parseTime(row.time);
    if (seconds !== null && (Number.isNaN(seconds) || seconds > 3600)) add(row.code, 'time', 'Time must look like 9:41.');
  });
  return problems;
}

/** A gentle note when a time is past the event's limit and the penalty box isn't ticked. Never blocks saving. */
export function timeHint(row: PaperRow, event: BallotEvent | undefined): string {
  const seconds = parseTime(row.time);
  if (!event || row.noShow || row.penalty || seconds === null || Number.isNaN(seconds)) return '';
  const over = seconds - event.time.max;
  const under = event.time.min ? event.time.min - seconds : 0;
  if (over > TIME_GRACE_SECONDS) return `Over ${clock(event.time.max)} by ${clock(over)}. Tick the time penalty if the judge lowered this speaker.`;
  if (under > TIME_GRACE_SECONDS) return `Under ${clock(event.time.min!)} by ${clock(under)}. Tick the time penalty if the judge lowered this speaker.`;
  return '';
}

/** The ballot as it is saved. Only call once `checkPaper` finds nothing. */
export function toEntries(rows: PaperRow[], useMarks: boolean): PaperEntry[] {
  return rows.map(row => {
    const seconds = parseTime(row.time);
    return {
      code: row.code, present: !row.noShow, rank: row.noShow ? null : whole(row.rank), rating: pointsOf(row, useMarks),
      time_seconds: row.noShow || seconds === null || Number.isNaN(seconds) ? null : seconds, time_penalty: !row.noShow && row.penalty,
      marks: useMarks && !row.noShow ? row.marks.map(mark => Number(mark)) : [],
    };
  });
}

/** Back from saved lines to typed rows, so a saved ballot can be corrected. */
export function fromEntries(names: { code: string; name: string }[], saved: Partial<PaperEntry>[]): { rows: PaperRow[]; useMarks: boolean } {
  const byCode = new Map(saved.map(entry => [entry.code, entry]));
  const useMarks = saved.some(entry => (entry.marks ?? []).length === MARK_COUNT);
  return {
    useMarks,
    rows: names.map(({ code, name }) => {
      const entry = byCode.get(code); const row = blankRow(code, name);
      if (!entry) return row;
      const rank = entry.rank ? String(entry.rank) : '';
      return {
        ...row, noShow: entry.present === false, rank, confirm: rank, points: entry.rating ? String(entry.rating) : '',
        marks: (entry.marks ?? []).length === MARK_COUNT ? entry.marks!.map(String) : row.marks,
        time: entry.time_seconds === null || entry.time_seconds === undefined ? '' : clock(entry.time_seconds), penalty: entry.time_penalty ?? false,
      };
    }),
  };
}
