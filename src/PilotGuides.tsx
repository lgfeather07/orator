import { useStore } from './store';

/**
 * Two one-page handouts for the Print center, written for first-time pilot directors and their judges:
 * the director's tournament-day guide (with the "internet goes down" backup plan) and a judge quick-start.
 * Every step names the real tab, step or button in Orator; nothing here depends on the schedule, so both
 * print before a tournament has entries. Keep each to one letter page (checked by the pilot-kit print test).
 */

/** The director's one-page guide: the day in order, getting help, what to do when things go wrong, and the backup plan. */
export function DirectorGuidePrint() {
  const { tournament } = useStore();
  return <div className="print-page print-guide">
    <header className="print-head"><strong>{tournament.name}</strong><span>Director guide</span></header>
    <h3 className="pg-title">Running your tournament on Orator</h3>
    <p className="pg-lead">Work top to bottom. Setup has five steps: Details, Entries, Judges, Schedule and Review. Keep this sheet in the tab room.</p>
    <div className="pg-cols">
      <section className="pg-block" aria-labelledby="dg-before">
        <h4 id="dg-before">Before the day</h4>
        <ol className="pg-steps">
          <li><b>Details.</b> Setup → Details: date, events, rounds, round times, fees, and Final round (finals, or no finals and place from prelims). The final-round choice locks once you start.</li>
          <li><b>Invite coaches.</b> Copy the invite link under Getting started on Setup and send it. Coaches make a free account and register their school. The link opens only if the tournament is listed under Public calendar on Details.</li>
          <li><b>Approve people.</b> People tab: approve coaches, judges with accounts and students who ask to join. Judges a coach enters are approved at once and get a private sign-in link from their coach.</li>
          <li><b>Entries close.</b> Press Close entries at the top of Setup. Changes after you build the schedule mean rebuilding it.</li>
          <li><b>Build the schedule.</b> Setup → Schedule: add your rooms (tick Accessible where it applies), then Build schedule. Fix every room flagged as needing a judge or with a school conflict.</li>
          <li><b>Publish.</b> Setup → Review → Publish. This closes registration and shows everyone their rooms and times. Then print the backup set (below).</li>
        </ol>
      </section>
      <section className="pg-block" aria-labelledby="dg-day">
        <h4 id="dg-day">On the day</h4>
        <ol className="pg-steps" start={7}>
          <li><b>Start.</b> Review → Start opens ballots for judges. Mark judges in on the Check-in tab as they arrive.</li>
          <li><b>Watch rooms.</b> Ballots tab: every room is e-ballot in, paper entered, or missing. Tab sheet: ranks as they arrive. Issues tab: reports, urgent first.</li>
          <li><b>Finals.</b> Results tab: when every preliminary room is in, press Create all finals (Create the final if there is one). Placings fill in as final ballots arrive. With no finals, events are placed from prelims. Print awards script is here too.</li>
          <li><b>End.</b> Once every final is placed and every paper ballot is entered: Review → End. This locks every ballot and sends each school its invoice. Coaches can then release results to their students.</li>
          <li><b>Publish results.</b> Results tab → Public results → Publish results. Only final placings and team points become public. After a correction, publish again.</li>
          <li><b>Payments.</b> Setup → Entries → Fees and payments: each school’s invoice and what is still owed. Mark check received when a check comes in. Card payment in Orator is a simulation for now.</li>
        </ol>
      </section>
      <section className="pg-block" aria-labelledby="dg-help">
        <h4 id="dg-help">Getting help</h4>
        <ul className="pg-list">
          <li>Anyone signed in can press <b>Report issue</b> at the top of their Orator page: no judge in the room, injury or medical concern, wrong room or schedule, ballot or scoring problem, or something else. Reports arrive on your <b>Issues</b> tab with the room and who sent them, urgent ones first. Press Mark resolved when it is handled.</li>
          <li>In an emergency, call 911 first.</li>
          <li>If Orator itself misbehaves, note the time, the page and what was pressed, carry on with paper, and pass the notes on after the tournament.</li>
        </ul>
      </section>
      <section className="pg-block" aria-labelledby="dg-wrong">
        <h4 id="dg-wrong">If something goes wrong</h4>
        <ul className="pg-list">
          <li><b>No judge in a room:</b> Setup → Schedule, pick another judge for that room. After publishing, changes go out right away as “Schedule updated”.</li>
          <li><b>A judge’s link won’t open:</b> their coach can make a new link on Team entries (the old one stops working). Or hand them that room’s paper ballot.</li>
          <li><b>A submitted ballot is wrong:</b> judges can’t edit after submitting. On the Ballots tab, enter the correct ballot for that room and tick Override the e-ballot. Every change is logged.</li>
          <li><b>Need to change rounds or events:</b> Review → Reopen registration. Judges lose ballot access until you publish again, so avoid it on the day.</li>
        </ul>
      </section>
      <section className="pg-block pg-box" aria-labelledby="dg-offline">
        <h4 id="dg-offline">If the internet goes down</h4>
        <p><b>Print ahead,</b> after you publish and the schedule is final. In the Print tab, choose All rounds:</p>
        <ul className="pg-list">
          <li><b>Postings</b> to tape up, and <b>Room signs</b> for doors.</li>
          <li><b>Paper ballots:</b> one NSAA-style sheet per room with the speakers filled in and score, time and rank left blank.</li>
          <li><b>Judge assignments:</b> one page per school.</li>
          <li>Reprint any round you change after printing, and keep copies of the judge quick-start.</li>
        </ul>
        <p><b>During the outage:</b> judges keep judging; their laptops save everything and send ballots by themselves when the connection is back (a room shows “Waiting for internet” until then). Phones on cellular data still work. Anyone who can’t get in uses their room’s paper ballot and returns it to the tab room.</p>
        <p><b>Afterward:</b> Ballots tab → Status: Missing → Start with the first missing room. Type ranks, points (35–50) or section marks, times, no-shows and time penalties in speaking order; Enter moves on, Ctrl+Enter saves. Tick Double-entry check to catch typos. Orator catches ties and ranks that don’t match points.</p>
        <p><b>Results still work:</b> saved paper ballots count in breaks, finals and placings exactly like e-ballots. Enter them before you create finals and before you end, because ending locks ballots. Comments stay on the paper; return the sheets to coaches.</p>
      </section>
    </div>
  </div>;
}

/** The judge's one-page quick-start: opening a ballot, check-in, scoring, comments, ranking, submitting, and the paper fallback. */
export function JudgeQuickStartPrint() {
  const { tournament } = useStore();
  return <div className="print-page print-guide pg-large">
    <header className="print-head"><strong>{tournament.name}</strong><span>Judge quick-start</span></header>
    <h3 className="pg-title">Judging on Orator</h3>
    <p className="pg-lead">Your ballot follows the NSAA ballot for your event. It works on a phone or a laptop. Questions? Ask at the tab room.</p>
    <div className="pg-cols">
      <section className="pg-block" aria-labelledby="jq-open">
        <h4 id="jq-open">1. Open your ballot</h4>
        <ul className="pg-list">
          <li><b>Private sign-in link:</b> open the link your coach texted or emailed you. No account or password needed. You see only your rooms. Bookmark the page and don’t share the link.</li>
          <li><b>Account:</b> sign in, open the Judge page and find Your rooms.</li>
          <li>Tap a room to open its ballot. Rooms appear when the director publishes the schedule; ballots open when the tournament starts.</li>
          <li>Switching devices? Open the same link (or sign in) there. Ballots you started come with you, and a link stops working on the first device.</li>
        </ul>
      </section>
      <section className="pg-block" aria-labelledby="jq-check">
        <h4 id="jq-check">2. Check in speakers</h4>
        <p>As each speaker arrives, tap <b>Present</b> or <b>No-show</b>. No-shows are left out of the ranking. Speakers tagged double or triple entered may arrive late or leave early. You can’t submit until everyone is marked.</p>
      </section>
      <section className="pg-block" aria-labelledby="jq-score">
        <h4 id="jq-score">3. Score each speaker</h4>
        <ul className="pg-list">
          <li>Under <b>1 · Score speakers</b>, give a <b>score out of 50</b>. Most scores fall between 35 and 50.</li>
          <li>Or mark each of the five criteria 1–10; when all five are marked they add up to the score. If the director requires section marks, mark all five.</li>
          <li>Enter the speaking <b>time</b> (minutes and seconds). More than 30 seconds outside the limit lowers the speaker one rank, applied for you.</li>
        </ul>
      </section>
      <section className="pg-block" aria-labelledby="jq-comments">
        <h4 id="jq-comments">4. Write comments</h4>
        <p>Write <b>Comments</b> for the speaker and a <b>Reason for decision</b> (why this rank and score), at least 40 characters between them. <b>Private notes</b> (outfit, topic) are never shared with anyone.</p>
      </section>
      <section className="pg-block" aria-labelledby="jq-rank">
        <h4 id="jq-rank">5. Rank the round</h4>
        <p>Under <b>2 · Rank the round</b>, drag speakers into order or use the arrows (Sort by score helps). 1 is best and there are no ties. You can’t rank a speaker above someone you scored higher, unless that speaker has a time penalty.</p>
      </section>
      <section className="pg-block" aria-labelledby="jq-submit">
        <h4 id="jq-submit">6. Submit</h4>
        <p>Press <b>Submit ballot</b>. A submitted ballot is locked and goes straight to the tab room. Until then your draft saves automatically.</p>
      </section>
      <section className="pg-block pg-box" aria-labelledby="jq-down">
        <h4 id="jq-down">If the laptop or wifi dies</h4>
        <ul className="pg-list">
          <li><b>Wifi drops (“No internet”):</b> keep judging. Everything is saved on your laptop and syncs when the connection is back. You can even press Submit ballot: it shows “Waiting for internet” and sends by itself later. Don’t clear your browser.</li>
          <li><b>Can’t get back in:</b> use the <b>paper ballot</b> for your room (in your packet or from the tab room). Fill in each speaker’s time, score out of 50 and rank (1 is best, no ties; “NS” for no-shows; anyone more than 30 seconds outside the time limit goes one place lower), write comments on the back, sign it and return it to the tab room.</li>
          <li>The director enters your paper ballot in Orator, and it counts exactly like an e-ballot.</li>
          <li>Already pressed Submit ballot? You’re done; don’t fill in a paper one too.</li>
        </ul>
      </section>
      <section className="pg-block" aria-labelledby="jq-help">
        <h4 id="jq-help">Something wrong?</h4>
        <p>No speakers, wrong room, or a ballot that won’t save: tell the tab room, or press <b>Report issue</b> at the top of the full judge page. In an emergency, call 911 first.</p>
      </section>
    </div>
  </div>;
}
