import { useStore } from './store';
import { NSAA_CLASSES, STATE_QUALIFYING_DEFAULT, type NsaaClass, type StateQualifying as Rule } from './tournament';

/**
 * Mark this tournament as an NSAA district contest. Results then show who qualifies for State and who is an
 * alternate, on the results screen, the download, the awards script and the public results.
 */
export function StateQualifying() {
  const { tournament, updateTournament } = useStore();
  const rule = tournament.stateQualifying;
  const set = (patch: Partial<Rule>) => updateTournament({ stateQualifying: { ...(rule ?? STATE_QUALIFYING_DEFAULT), ...patch } });
  return <fieldset className="state-qualifying">
    <legend>District contest <small>NSAA district-to-State qualifying</small></legend>
    <label className="check-setting"><input type="checkbox" checked={!!rule} onChange={event => updateTournament({ stateQualifying: event.target.checked ? { ...STATE_QUALIFYING_DEFAULT } : undefined })}/>
      <span><strong>This is a district contest</strong><small>Final placings show who qualifies for State and who is an alternate. Novice divisions don’t qualify.</small></span></label>
    {rule && <div className="state-qualifying-grid">
      <label><span>Class</span><select value={rule.nsaaClass ?? ''} onChange={event => set({ nsaaClass: (event.target.value || undefined) as NsaaClass | undefined })}><option value="">Not set</option>{NSAA_CLASSES.map(item => <option key={item} value={item}>Class {item}</option>)}</select></label>
      <label><span>Qualify for State in each event</span><select value={rule.qualifiers} onChange={event => set({ qualifiers: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map(count => <option key={count} value={count}>Top {count}</option>)}</select></label>
      <label><span>Alternates in each event</span><select value={rule.alternates} onChange={event => set({ alternates: Number(event.target.value) })}>{[0, 1, 2, 3].map(count => <option key={count} value={count}>{count === 0 ? 'None' : `${count} (${ordinalRange(rule.qualifiers, count)})`}</option>)}</select></label>
    </div>}
  </fieldset>;
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 > 3 ? 0 : n % 10]}`;
const ordinalRange = (qualifiers: number, count: number) => count === 1 ? `${ordinal(qualifiers + 1)} place` : `${ordinal(qualifiers + 1)}–${ordinal(qualifiers + count)}`;
