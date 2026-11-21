import { useStore } from './store';
import { timeFor } from './tournament';

/** "8:00 AM" ↔ "08:00", for the browser's time picker. */
const toInput = (label: string) => { const m = label.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i); if (!m) return ''; let hour = Number(m[1]) % 12; if (m[3].toUpperCase() === 'PM') hour += 12; return `${String(hour).padStart(2, '0')}:${m[2]}`; };
const toLabel = (value: string) => { const [h, m] = value.split(':').map(Number); if (Number.isNaN(h) || Number.isNaN(m)) return ''; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

/**
 * The director's start time for each round. Postings, room lists, ballots, printouts and alert texts all use these.
 * Rounds after the preliminary rounds are the final (or, with semifinals, the semifinal and then the final).
 */
export function RoundTimes() {
  const { tournament, updateTournament } = useStore();
  const semis = Object.keys(tournament.semisByContest ?? {}).length > 0;
  const slots = [...Array.from({ length: tournament.rounds }, (_, index) => ({ round: index + 1, label: `Round ${index + 1}` })),
    ...(tournament.format === 'prelims' ? [] : [{ round: tournament.rounds + 1, label: semis ? 'Semifinals (or a final, where there are no semifinals)' : 'Finals' }]),
    ...(tournament.format !== 'prelims' && semis ? [{ round: tournament.rounds + 2, label: 'Finals after semifinals' }] : [])];
  const set = (round: number, value: string) => {
    const times = Array.from({ length: Math.max(tournament.roundTimes?.length ?? 0, round) }, (_, index) => tournament.roundTimes?.[index] ?? '');
    times[round - 1] = value ? toLabel(value) : '';
    updateTournament({ roundTimes: times });
  };
  return <fieldset className="round-times">
    <legend>Round times <small>Shown on postings, room lists, ballots, printouts and alert texts</small></legend>
    <div className="round-times-grid">{slots.map(slot => <label key={slot.round}><span>{slot.label}</span>
      <input type="time" value={toInput(timeFor(tournament, slot.round))} onChange={event => set(slot.round, event.target.value)}/></label>)}</div>
  </fieldset>;
}
