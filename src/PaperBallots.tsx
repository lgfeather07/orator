import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Badge, Button, Icon, Progress } from './ui';
import { useStore } from './store';
import { useAuth } from './auth';
import { ballotEvents } from './ballots';
import { divisionOf, isFinal, type Section } from './tournament';
import { blankRow, checkPaper, clock, fromEntries, marksTotal, timeHint, toEntries, type PaperEntry, type PaperField, type PaperRow } from './paperBallots';
import { enterPaperBallot, listBallotSources, listPaperLog, loadBallotLines, type BallotSource, type PaperLogRow } from './paperBallotsApi';
import './paperBallots.css';

/**
 * Tab-room entry for paper ballots (director's Ballots tab). Every room on the schedule with its
 * status, and a keyboard-first form that checks a paper ballot for typos before it is saved.
 * A saved paper ballot counts exactly like a submitted e-ballot: it goes into the same room results.
 */

type Status = 'missing' | 'paper' | 'ebal';
type Room = { section: Section; status: Status; judge: string; event: string; round: string; final: boolean; source?: BallotSource; record?: DemoRecord };
/** Demo mode keeps paper ballots in the browser, next to the demo's other saved state. */
type DemoRecord = { fingerprint: string; entries: PaperEntry[]; enteredBy: string; enteredAt: string };
type DemoState = { records: Record<string, DemoRecord>; log: PaperLogRow[] };

const DEMO_KEY = 'orator-paper-ballots-v1';
const PREFS_KEY = 'orator-paper-prefs';
const DEMO_DIRECTOR = 'Dan Miller';
const loadDemo = (): DemoState => { try { const raw = localStorage.getItem(DEMO_KEY); if (raw) return JSON.parse(raw) as DemoState; } catch { /* storage off */ } return { records: {}, log: [] }; };
const loadPrefs = (): { doubleEntry: boolean } => { try { return { doubleEntry: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return { doubleEntry: false }; } };
/** A demo record only stands while the room still has the same speakers (rebuilding the schedule starts over). */
const fingerprint = (section: Section) => `${section.round}|${section.room}|${section.entryIds.join(',')}`;
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const statusText: Record<Status, string> = { missing: 'Missing', paper: 'Paper entered', ebal: 'E-ballot in' };
const actionText: Record<PaperLogRow['action'], string> = { entered: 'Entered', corrected: 'Corrected', override: 'Replaced the judge’s e-ballot', 'replaced-draft': 'Replaced an unsent e-ballot draft' };

export function BallotEntryBoard() {
  const store = useStore();
  const { profile } = useAuth();
  const { tournament, sections, entries, judges, roomResults, live, tournamentId } = store;
  const [demo, setDemo] = useState<DemoState>(loadDemo);
  const [sources, setSources] = useState<BallotSource[] | null>(null);
  const [liveLog, setLiveLog] = useState<PaperLogRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [roundFilter, setRoundFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [query, setQuery] = useState('');
  const [doubleEntry, setDoubleEntry] = useState(() => loadPrefs().doubleEntry);
  const [openId, setOpenId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!live) try { localStorage.setItem(DEMO_KEY, JSON.stringify(demo)); } catch { /* storage off */ } }, [demo, live]);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ doubleEntry })); } catch { /* storage off */ } }, [doubleEntry]);

  const reload = async () => {
    if (!live || !tournamentId) return;
    try { const [list, log] = await Promise.all([listBallotSources(tournamentId), listPaperLog(tournamentId)]); setSources(list); setLiveLog(log); setLoadError(''); }
    catch (caught) { setLoadError(caught instanceof Error ? caught.message : 'Could not load ballots.'); }
  };
  // Look again whenever the store refreshes its results (after a save, or when the director comes back to the tab).
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [live, tournamentId, roomResults]);

  const log = live ? liveLog : demo.log;
  const judgeName = (section: Section) => section.judgeName || judges.find(judge => judge.id === section.judgeId)?.name || '';
  const eventName = (section: Section) => { const name = ballotEvents.find(event => event.id === section.eventId)?.name ?? section.eventId; return divisionOf(section) === 'novice' ? `Novice ${name}` : name; };

  const rooms: Room[] = useMemo(() => sections.map(section => {
    const final = isFinal(section, tournament);
    const base = { section, judge: judgeName(section), event: eventName(section), round: final ? 'Final' : `Round ${section.round}`, final };
    const results = roomResults.filter(result => result.sectionId === section.id);
    if (live) {
      const mine = (sources ?? []).filter(source => source.sectionId === section.id);
      const paper = mine.find(source => source.source === 'paper');
      if (paper) return { ...base, status: 'paper' as const, source: paper };
      if (mine.length || results.length) return { ...base, status: 'ebal' as const, source: mine[0] };
      return { ...base, status: 'missing' as const };
    }
    const record = demo.records[section.id];
    const ranked = record ? record.entries.filter(entry => entry.present && entry.rank) : [];
    const stands = record && record.fingerprint === fingerprint(section) && results.length === ranked.length && ranked.every(entry => results.some(result => result.entryId === entry.code && result.rank === entry.rank));
    if (stands) return { ...base, status: 'paper' as const, record };
    return { ...base, status: results.length ? 'ebal' as const : 'missing' as const };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sections, tournament, roomResults, sources, demo, live, judges]);

  const rounds = [...new Set(sections.filter(section => !isFinal(section, tournament)).map(section => section.round))].sort((a, b) => a - b);
  const hasFinals = rooms.some(room => room.final);
  const needle = query.trim().toLowerCase();
  const order: Record<Status, number> = { missing: 0, ebal: 1, paper: 1 };
  const shown = rooms
    .filter(room => roundFilter === 'all' || (roundFilter === 'final' ? room.final : !room.final && String(room.section.round) === roundFilter))
    .filter(room => statusFilter === 'all' || room.status === statusFilter)
    .filter(room => !needle || [room.section.room, room.judge, room.event, room.section.label].some(text => text.toLowerCase().includes(needle)))
    // Round by round, the rooms still out first.
    .map((room, index) => ({ room, index })).sort((a, b) => a.room.section.round - b.room.section.round || order[a.room.status] - order[b.room.status] || a.index - b.index).map(item => item.room);
  const counts = { missing: rooms.filter(room => room.status === 'missing').length, paper: rooms.filter(room => room.status === 'paper').length, ebal: rooms.filter(room => room.status === 'ebal').length };
  const done = rooms.length - counts.missing;
  const open = rooms.find(room => room.section.id === openId) ?? null;

  const choose = (id: string | null) => {
    setOpenId(id);
    if (id) requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const nextMissing = (afterId: string) => {
    const pool = shown.length ? shown : rooms;
    const start = pool.findIndex(room => room.section.id === afterId);
    const after = [...pool.slice(start + 1), ...pool.slice(0, Math.max(start, 0))].find(room => room.status === 'missing' && room.section.id !== afterId);
    return after ?? rooms.find(room => room.status === 'missing' && room.section.id !== afterId) ?? null;
  };

  const speakersOf = (section: Section) => section.entryIds.map(id => { const entry = entries.find(item => item.id === id); return { code: id, name: entry?.student ?? 'Unknown speaker', school: entry?.school ?? '' }; });

  /** What is on file for a room now, to correct it (paper) or start from it (e-ballot). */
  const loadExisting = async (room: Room): Promise<PaperEntry[] | null> => {
    if (room.status === 'missing') return null;
    if (live) return room.source ? loadBallotLines(room.source.ballotId) : null;
    if (room.record) return room.record.entries;
    const results = roomResults.filter(result => result.sectionId === room.section.id);
    return room.section.entryIds.map(code => { const result = results.find(item => item.entryId === code); return { code, present: !!result, rank: result?.rank ?? null, rating: result?.rating || null, time_seconds: null, time_penalty: false, marks: [] }; });
  };

  const save = async (room: Room, lines: PaperEntry[], override: boolean, note: string) => {
    const rows = lines.filter(line => line.present && line.rank).map(line => ({ entryId: line.code, rank: line.rank!, rating: line.rating ?? 0 }));
    if (live) {
      await enterPaperBallot(room.section.id, lines, override, note);
      // In live mode this reloads results from the database, where the paper ballot now sits with the e-ballots.
      store.recordRoomResults(room.section.id, rows);
      await reload();
    } else {
      const previous = await loadExisting(room);
      const action: PaperLogRow['action'] = room.status === 'paper' ? 'corrected' : room.status === 'ebal' ? 'override' : 'entered';
      const at = new Date().toISOString();
      const actor = profile?.name || DEMO_DIRECTOR;
      setDemo(current => ({
        records: { ...current.records, [room.section.id]: { fingerprint: fingerprint(room.section), entries: lines, enteredBy: actor, enteredAt: at } },
        log: [{ id: `p${Date.now()}`, sectionId: room.section.id, action, actor, note: note.trim(), at, previous, entries: lines }, ...current.log].slice(0, 300),
      }));
      store.recordRoomResults(room.section.id, rows);
    }
  };

  if (sections.length === 0) return <div className="issue-board"><section className="panel"><div className="schedule-empty"><span className="upload-illustration"><Icon name="ballot" size={30}/></span><h3>Build the schedule first</h3><p>Paper ballots are entered room by room. Build the schedule on the Setup tab, then come back here.</p></div></section></div>;

  return <div className="pb-board">
    <p className="pb-live" aria-live="polite">{announce}</p>
    <section className="panel pb-list-panel" aria-labelledby="pb-list-title">
      <div className="panel-head pb-head"><div><h2 id="pb-list-title">Ballots by room</h2><p>{done} of {rooms.length} rooms in · {counts.ebal} e-ballot{counts.ebal === 1 ? '' : 's'} · {counts.paper} paper</p></div>
        {counts.missing > 0 ? <Badge tone="warning" icon="warning">{counts.missing} missing</Badge> : <Badge tone="success" icon="check">All in</Badge>}</div>
      <div className="pb-progress"><Progress value={rooms.length ? Math.round(done / rooms.length * 100) : 0} label="Rooms with a ballot"/></div>
      {loadError && <p className="pb-error-banner" role="alert"><Icon name="warning" size={16}/> {loadError}</p>}
      <div className="pb-filters">
        <div className="pb-filter"><label htmlFor="pb-round">Round</label><select id="pb-round" value={roundFilter} onChange={event => setRoundFilter(event.target.value)}><option value="all">All rounds</option>{rounds.map(round => <option key={round} value={String(round)}>Round {round}</option>)}{hasFinals && <option value="final">Finals</option>}</select></div>
        <div className="pb-filter"><label htmlFor="pb-status">Status</label><select id="pb-status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | Status)}><option value="all">Any status</option><option value="missing">Missing ({counts.missing})</option><option value="paper">Paper entered ({counts.paper})</option><option value="ebal">E-ballot in ({counts.ebal})</option></select></div>
        <label className="search-box pb-search"><Icon name="search" size={16}/><input type="search" aria-label="Search rooms, judges, or events" placeholder="Room, judge, or event" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <label className="pb-toggle"><input type="checkbox" checked={doubleEntry} onChange={event => setDoubleEntry(event.target.checked)}/><span><strong>Double-entry check</strong><small>Type every rank twice to catch typos.</small></span></label>
      </div>
      {shown.length === 0 ? <div className="schedule-empty pb-empty"><h3>No rooms match</h3><p>Try another round, status, or search.</p></div> :
      <ul className="pb-rooms" aria-label="Rooms">
        {shown.map(room => <li key={room.section.id}><button className={`pb-room ${room.status}`} aria-current={openId === room.section.id ? 'true' : undefined} onClick={() => choose(room.section.id)}>
          <span className="pb-room-round">{room.final ? 'F' : `R${room.section.round}`}</span>
          <span className="pb-room-main"><strong>{room.event} · {room.section.label.replace('Novice · ', '')}</strong><small>{room.round} · {room.section.room} · {room.judge || 'No judge'}</small></span>
          <Badge tone={room.status === 'missing' ? 'warning' : room.status === 'paper' ? 'info' : 'success'} icon={room.status === 'missing' ? 'warning' : room.status === 'paper' ? 'file' : 'check'}>{statusText[room.status]}</Badge>
        </button></li>)}
      </ul>}
    </section>
    <div className="pb-form-slot" ref={formRef}>
      {open ? <PaperEntryForm key={`${open.section.id}|${open.status}`} room={open} speakers={speakersOf(open.section)} doubleEntry={doubleEntry}
        locked={tournament.status === 'finished'} history={log.filter(row => row.sectionId === open.section.id)} names={new Map(entries.map(entry => [entry.id, entry.student]))}
        loadExisting={() => loadExisting(open)} onClose={() => setOpenId(null)}
        onSave={async (lines, override, note, goNext) => {
          await save(open, lines, override, note);
          const next = goNext ? nextMissing(open.section.id) : null;
          setAnnounce(`Saved ${open.round}, ${open.event}, ${open.section.room}.${goNext ? next ? ` Next: ${next.round}, ${next.event}, ${next.section.room}.` : ' No rooms are missing.' : ''}`);
          if (goNext) choose(next?.section.id ?? null);
        }}/>
      : <section className="panel pb-pick"><Icon name="ballot" size={26}/><div><strong>Choose a room to enter its paper ballot</strong><small>Ranks, points and times go in speaking order. Enter moves to the next box; Ctrl+Enter saves. Saved paper ballots count in breaks, finals and placings exactly like e-ballots.</small></div>
        {counts.missing > 0 && <Button icon="arrow" onClick={() => choose((shown.find(room => room.status === 'missing') ?? rooms.find(room => room.status === 'missing'))!.section.id)}>Start with the first missing room</Button>}</section>}
    </div>
  </div>;
}

type FormProps = {
  room: Room; speakers: { code: string; name: string; school: string }[]; doubleEntry: boolean; locked: boolean;
  history: PaperLogRow[]; names: Map<string, string>;
  loadExisting: () => Promise<PaperEntry[] | null>;
  onSave: (lines: PaperEntry[], override: boolean, note: string, goNext: boolean) => Promise<void>;
  onClose: () => void;
};

const fieldLabel: Record<PaperField, string> = { rank: 'Rank', confirm: 'Rank again', points: 'Points', marks: 'Section marks', time: 'Time' };

function PaperEntryForm({ room, speakers, doubleEntry, locked, history, names, loadExisting, onSave, onClose }: FormProps) {
  const event = ballotEvents.find(item => item.id === room.section.eventId);
  const [rows, setRows] = useState<PaperRow[]>(() => speakers.map(speaker => blankRow(speaker.code, speaker.name)));
  const [useMarks, setUseMarks] = useState(false);
  const [ready, setReady] = useState(room.status === 'missing');
  const [attempted, setAttempted] = useState(false);
  const [override, setOverride] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [loadFailed, setLoadFailed] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (room.status === 'missing') return;
    let active = true;
    loadExisting().then(saved => {
      if (!active) return;
      if (saved) { const typed = fromEntries(speakers, saved); setRows(typed.rows); setUseMarks(typed.useMarks); }
      setReady(true);
    }).catch(caught => { if (active) { setLoadFailed(caught instanceof Error ? caught.message : 'Could not load the ballot on file.'); setReady(true); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ready to type as soon as the room opens.
  useEffect(() => { if (ready) wrap.current?.querySelector<HTMLInputElement>('input[data-step]:not(:disabled)')?.focus({ preventScroll: true }); }, [ready]);

  const problems = checkPaper(rows, { doubleEntry, useMarks });
  const visible = problems.filter(problem => attempted || !problem.required);
  const needsOverride = room.status === 'ebal' && !override;
  const patch = (code: string, change: Partial<PaperRow>) => { setServerError(''); setRows(all => all.map(row => row.code === code ? { ...row, ...change } : row)); };
  const setNoShow = (code: string, noShow: boolean) => patch(code, noShow ? { noShow, rank: '', confirm: '', points: '', marks: ['', '', '', '', ''], time: '', penalty: false } : { noShow });
  const idFor = (code: string, field: string) => `pb-${room.section.id}-${code}-${field}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const invalid = (code: string, field: PaperField) => visible.some(problem => problem.code === code && problem.field === field);
  const focusField = (code: string, field: PaperField) => document.getElementById(idFor(code, field === 'marks' ? 'mark0' : field))?.focus();

  const submit = async (goNext: boolean) => {
    if (locked || saving) return;
    setAttempted(true); setServerError('');
    if (problems.length > 0 || needsOverride) {
      requestAnimationFrame(() => { const first = problems[0]; if (first) focusField(first.code, first.field); else summaryRef.current?.querySelector<HTMLInputElement>('input')?.focus(); });
      return;
    }
    setSaving(true);
    try { await onSave(toEntries(rows, useMarks), override, note, goNext); }
    catch (caught) { setServerError(caught instanceof Error ? caught.message : 'The ballot could not be saved. Try again.'); }
    finally { setSaving(false); }
  };

  // Enter moves to the next box (checkboxes are reached with Tab); Enter in the last box, or Ctrl+Enter anywhere, saves.
  const onKeyDown = (keyEvent: KeyboardEvent<HTMLDivElement>) => {
    if (keyEvent.key !== 'Enter') return;
    const target = keyEvent.target as HTMLElement;
    if (target.tagName !== 'INPUT' || (target as HTMLInputElement).type === 'checkbox') return;
    keyEvent.preventDefault();
    if (keyEvent.ctrlKey || keyEvent.metaKey) { submit(true); return; }
    const fields = [...(wrap.current?.querySelectorAll<HTMLInputElement>('input[data-step]:not(:disabled)') ?? [])];
    const index = fields.indexOf(target as HTMLInputElement);
    if (index >= 0 && index < fields.length - 1) { fields[index + 1].focus(); fields[index + 1].select(); }
    else if (index === fields.length - 1) submit(true);
  };

  const present = rows.filter(row => !row.noShow).length;
  const describe = (row: PaperRow) => visible.some(problem => problem.code === row.code) || timeHint(row, event) ? idFor(row.code, 'msg') : undefined;
  const nameOf = (code: string) => names.get(code) ?? 'A speaker';
  const changes = (entry: PaperLogRow) => {
    if (!entry.previous) return '';
    const before = new Map(entry.previous.map(line => [line.code, line]));
    return entry.entries.filter(line => { const old = before.get(line.code); return !old || old.rank !== line.rank || (old.rating ?? null) !== (line.rating ?? null) || (old.present !== false) !== line.present; })
      .map(line => { const old = before.get(line.code); const text = (value?: Partial<PaperEntry>) => !value ? '—' : value.present === false ? 'no-show' : `${value.rank ?? '—'}${value.rating ? ` (${value.rating})` : ''}`; return `${nameOf(line.code)} ${text(old)} → ${text(line)}`; }).join('; ');
  };

  return <section className="panel pb-form" aria-labelledby="pb-form-title" ref={wrap} onKeyDown={onKeyDown}>
    <div className="panel-head pb-form-head">
      <div><h2 id="pb-form-title">{room.round} · {room.event} · {room.section.label.replace('Novice · ', '')}</h2><p>{room.section.room} · {room.judge ? `Judge ${room.judge}` : 'No judge assigned'} · {speakers.length} speakers in speaking order</p></div>
      <button className="icon-button pb-close" aria-label="Close this ballot" onClick={onClose}><Icon name="close"/></button>
    </div>

    {room.status === 'paper' && <div className="pb-banner info"><Icon name="file" size={18}/><div><strong>Paper ballot entered{room.source?.enteredBy || room.record?.enteredBy ? ` by ${room.source?.enteredBy || room.record?.enteredBy}` : ''}{room.source?.enteredAt || room.record?.enteredAt ? `, ${when(room.source?.enteredAt ?? room.record?.enteredAt ?? null)}` : ''}</strong><small>Saving again corrects it. Every correction is logged with who made it and when.</small>
      <label className="pb-note">Reason for the correction (optional)<input value={note} maxLength={200} onChange={change => setNote(change.target.value)} placeholder="Typo: ranks 2 and 3 swapped"/></label></div></div>}
    {room.status === 'ebal' && <div className="pb-banner warn" ref={summaryRef}><Icon name="warning" size={18}/><div><strong>{room.judge || 'The judge'} already submitted an e-ballot for this room{room.source?.submittedAt ? ` (${when(room.source.submittedAt)})` : ''}</strong><small>Its ranks are filled in below. Paper entry is blocked unless the paper ballot is the one that counts. Overriding replaces the e-ballot, and the change is logged.</small>
      <label className="pb-override"><input type="checkbox" checked={override} onChange={change => { setOverride(change.target.checked); setServerError(''); }} aria-invalid={attempted && needsOverride ? true : undefined}/> Override the e-ballot with this paper ballot</label>
      {override && <label className="pb-note">Why? (optional)<input value={note} maxLength={200} onChange={change => setNote(change.target.value)} placeholder="Judge also filled in a paper ballot"/></label>}</div></div>}
    {locked && <div className="pb-banner warn"><Icon name="lock" size={18}/><div><strong>The tournament has ended, so ballots are locked.</strong><small>Reopen the tournament on the Setup tab to enter or correct a ballot.</small></div></div>}
    {loadFailed && <p className="pb-error-banner" role="alert"><Icon name="warning" size={16}/> {loadFailed}</p>}

    <div className="pb-options">
      <label className="pb-toggle"><input type="checkbox" checked={useMarks} onChange={change => setUseMarks(change.target.checked)}/><span><strong>Enter section marks</strong><small>Five marks of 1–10 per speaker instead of a points total.</small></span></label>
      <span className="pb-hint"><kbd>Enter</kbd> next box · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> save · {present} of {rows.length} performed</span>
    </div>

    {attempted && (visible.length > 0 || needsOverride) && <div className="pb-summary" role="alert">
      <strong>{visible.length + (needsOverride ? 1 : 0)} {visible.length + (needsOverride ? 1 : 0) === 1 ? 'thing to fix' : 'things to fix'} before saving</strong>
      <ul>{needsOverride && <li>Tick “Override the e-ballot” to replace the judge’s e-ballot, or close this room.</li>}
        {visible.map((problem, index) => <li key={index}><button onClick={() => focusField(problem.code, problem.field)}>{rows.find(row => row.code === problem.code)?.name}, {fieldLabel[problem.field].toLowerCase()}:</button> {problem.message}</li>)}</ul>
    </div>}

    {!ready ? <p className="pb-loading"><span className="spinner"/> Loading the ballot on file…</p> :
    <ol className="pb-rows">
      {rows.map((row, index) => {
        const speaker = speakers[index]; const messages = visible.filter(problem => problem.code === row.code); const hint = timeHint(row, event);
        const total = useMarks ? marksTotal(row.marks) : null;
        const common = (field: string) => ({ id: idFor(row.code, field), disabled: row.noShow || locked, 'aria-describedby': describe(row), autoComplete: 'off' as const });
        return <li key={row.code} className={`pb-row${row.noShow ? ' no-show' : ''}${messages.length ? ' has-error' : ''}`}>
          <span className="pb-order" aria-hidden="true">{index + 1}</span>
          <div className="pb-speaker"><strong id={idFor(row.code, 'name')}>{row.name}</strong><small>{speaker?.school}</small></div>
          <div className="pb-fields" role="group" aria-labelledby={idFor(row.code, 'name')}>
            <label className="pb-field pb-rank"><span>Rank</span><input {...common('rank')} data-step inputMode="numeric" maxLength={2} aria-label={`Rank, ${row.name}`} aria-invalid={invalid(row.code, 'rank') || undefined} value={row.rank} onChange={change => patch(row.code, { rank: change.target.value.replace(/\D/g, '') })}/></label>
            {doubleEntry && <label className="pb-field pb-rank"><span>Again</span><input {...common('confirm')} data-step inputMode="numeric" maxLength={2} aria-label={`Rank again, ${row.name}`} aria-invalid={invalid(row.code, 'confirm') || undefined} value={row.confirm} onChange={change => patch(row.code, { confirm: change.target.value.replace(/\D/g, '') })}/></label>}
            {useMarks ? <fieldset className="pb-marks" disabled={row.noShow || locked}><legend>Marks</legend>
              {row.marks.map((mark, markIndex) => <input key={markIndex} {...common(`mark${markIndex}`)} data-step inputMode="numeric" maxLength={2} aria-label={`${event?.criteria[markIndex]?.name ?? `Section ${markIndex + 1}`} mark, ${row.name}`} aria-invalid={invalid(row.code, 'marks') || undefined} value={mark} onChange={change => patch(row.code, { marks: row.marks.map((value, at) => at === markIndex ? change.target.value.replace(/\D/g, '') : value) })}/>)}
              <output aria-label={`Points, ${row.name}`}>{row.noShow ? '—' : total ?? '·'}</output></fieldset>
            : <label className="pb-field pb-points"><span>Points</span><input {...common('points')} data-step inputMode="numeric" maxLength={2} placeholder="35–50" aria-label={`Points, ${row.name}`} aria-invalid={invalid(row.code, 'points') || undefined} value={row.points} onChange={change => patch(row.code, { points: change.target.value.replace(/\D/g, '') })}/></label>}
            <label className="pb-field pb-time"><span>Time</span><input {...common('time')} data-step inputMode="decimal" maxLength={5} placeholder="m:ss" aria-label={`Time, ${row.name}`} aria-invalid={invalid(row.code, 'time') || undefined} value={row.time} onChange={change => patch(row.code, { time: change.target.value.replace(/[^\d:.]/g, '') })} onBlur={() => { const typed = row.time.trim(); if (/^\d{3,4}$/.test(typed) || /^\d{1,2}\.\d{2}$/.test(typed)) { const digits = typed.replace('.', ''); const seconds = Number(digits.slice(-2)); if (seconds < 60) patch(row.code, { time: clock(Number(digits.slice(0, -2)) * 60 + seconds) }); } }}/></label>
            <label className="pb-check"><input type="checkbox" disabled={row.noShow || locked} checked={row.penalty} onChange={change => patch(row.code, { penalty: change.target.checked })}/><span>Time penalty</span></label>
            <label className="pb-check"><input type="checkbox" disabled={locked} checked={row.noShow} onChange={change => setNoShow(row.code, change.target.checked)}/><span>No-show</span></label>
          </div>
          {(messages.length > 0 || hint) && <ul className="pb-row-msgs" id={idFor(row.code, 'msg')}>
            {messages.map((problem, at) => <li key={at} className="pb-msg-error"><Icon name="warning" size={14}/> {problem.message}</li>)}
            {hint && <li className="pb-msg-hint"><Icon name="clock" size={14}/> {hint}</li>}
          </ul>}
        </li>;
      })}
    </ol>}

    {serverError && <p className="pb-error-banner" role="alert"><Icon name="warning" size={16}/> {serverError}</p>}
    <div className="pb-actions">
      <Button icon="check" disabled={locked || saving || !ready} onClick={() => submit(true)}>{saving ? 'Saving…' : 'Save and go to next missing room'}</Button>
      <Button variant="secondary" disabled={locked || saving || !ready} onClick={() => submit(false)}>Save</Button>
      <Button variant="ghost" onClick={onClose}>Close</Button>
    </div>

    {history.length > 0 && <div className="pb-history"><h3>History for this room</h3><ol>
      {history.map(entry => { const diff = changes(entry); return <li key={entry.id}><strong>{actionText[entry.action]}</strong> by {entry.actor || 'the director'} · {when(entry.at)}{entry.note && <> · “{entry.note}”</>}{diff && <small>{diff}</small>}</li>; })}
    </ol></div>}
  </section>;
}
