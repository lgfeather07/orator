import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './ui';

/**
 * Business details shown in the footer and the legal pages. Fill these in before launch:
 * a privacy policy needs a working way to contact you.
 */
export const BUSINESS = {
  name: 'Orator',
  /** Legal name of whoever runs Orator, e.g. "Orator LLC" or the student team's names. */
  operator: 'Logan Feather',
  contactEmail: 'lgfeather07@gmail.com',
  mailingAddress: 'Lincoln, NE',
  state: 'Nebraska',
  effective: 'November 18, 2026',
};

export type LegalPage = 'privacy' | 'terms' | 'cookies' | 'refunds' | 'accessibility';
export const legalPages: { id: LegalPage; label: string }[] = [
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms' },
  { id: 'cookies', label: 'Cookies & storage' },
  { id: 'refunds', label: 'Refunds' },
  { id: 'accessibility', label: 'Accessibility' },
];

/** Legal pages live at #/privacy and so on, so they can be linked to and opened without signing in. */
export function useLegalRoute(): [LegalPage | null, (page: LegalPage | null) => void] {
  const read = () => { const id = window.location.hash.replace(/^#\/?/, ''); return legalPages.some(page => page.id === id) ? id as LegalPage : null; };
  const [page, setPage] = useState<LegalPage | null>(read);
  useEffect(() => { const sync = () => setPage(read()); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  const go = (next: LegalPage | null) => {
    if (next) window.location.hash = `/${next}`;
    else history.replaceState(null, '', window.location.pathname + window.location.search);
    setPage(next); window.scrollTo(0, 0);
  };
  return [page, go];
}

const contact = BUSINESS.contactEmail
  ? <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a>
  : <em>a contact address that will be listed here before Orator launches</em>;

export function LegalFooter({ onOpen }: { onOpen: (page: LegalPage) => void }) {
  return <footer className="legal-footer">
    <nav aria-label="Explore Orator"><a href="#/calendar">Tournament calendar</a><a href="#/results">Tournament results</a></nav>
    <nav aria-label="Legal">{legalPages.map(page => <a key={page.id} href={`#/${page.id}`} onClick={event => { event.preventDefault(); onOpen(page.id); }}>{page.label}</a>)}</nav>
    <p>© 2026 {BUSINESS.operator || BUSINESS.name}{BUSINESS.contactEmail && <> · <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a></>}{BUSINESS.mailingAddress && <> · {BUSINESS.mailingAddress}</>}</p>
    <p>Orator is not affiliated with or endorsed by the Nebraska School Activities Association (NSAA). Demo data, including people, results and payments, is fictional.</p>
  </footer>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2>{title}</h2>{children}</section>;
}

const pages: Record<LegalPage, { title: string; intro: string; body: ReactNode }> = {
  privacy: {
    title: 'Privacy policy',
    intro: 'What Orator collects, why, who can see it, and how to have it changed or deleted.',
    body: <>
      <Section title="Who we are">
        <p>{BUSINESS.operator || BUSINESS.name} runs Orator, software for high school speech tournaments in {BUSINESS.state}. You can reach us at {contact}.</p>
      </Section>
      <Section title="What we collect">
        <ul>
          <li><strong>Your account:</strong> name, email address, school or organization (optional), and the roles you choose. Passwords are handled by our sign-in provider and are never visible to us.</li>
          <li><strong>Tournament information:</strong> entries (student names, schools and events), schedules, judge assignments, judges’ event preferences, and ballots (ranks, ratings, times, section marks, comments and reasons for decision).</li>
          <li><strong>Private judge notes:</strong> notes a judge writes to remember speakers. Only that judge can read them.</li>
          <li><strong>Issue reports:</strong> what you report and where. Please don’t include medical details; staff will follow up in person.</li>
          <li><strong>Payments:</strong> Orator does not collect or store card numbers. Payments are currently simulated; real payments will be handled by a payment processor.</li>
          <li><strong>Technical data:</strong> our hosting and database providers keep standard server logs, such as IP address and browser type, to run and secure the service.</li>
        </ul>
      </Section>
      <Section title="What we don’t do">
        <p>No advertising, no analytics or tracking scripts, no third-party embeds, and we do not sell or share personal information for advertising.</p>
      </Section>
      <Section title="How it is used and who can see it">
        <ul>
          <li>Tournament directors see their own tournament: entries, schedule, ballots and payments.</li>
          <li>Coaches see entries and submitted ballots for their own school, once the director has approved them.</li>
          <li>Judges see the rooms they are assigned, and their own ballots and notes.</li>
          <li>Students see their own events and rooms. They see their own rankings and comments only after the tournament has ended and their coach releases them, never during the tournament.</li>
          <li>Once a tournament has ended, its director may publish its final results: each final’s placings (student name, school, event and place) and team points. Anyone can see published results, without an account. Ballots, judges’ comments and preliminary rankings are never published.</li>
        </ul>
        <p>We use this information only to run tournaments and show results. Access rules are enforced by the database, not just by the screens.</p>
      </Section>
      <Section title="Students and minors">
        <p>Orator is for high school students aged 13 and over. We do not knowingly collect information from children under 13. Students under 18 should use Orator with the knowledge of their coach and a parent or guardian. When a school or team uses Orator, we handle student records on its behalf and only to provide the service; schools may ask us for a written data agreement. A parent or guardian can ask to see, correct or delete a student’s information.</p>
      </Section>
      <Section title="Keeping and deleting information">
        <p>We keep tournament records so coaches and students can review past ballots. You can ask us to correct or delete your account and personal information at {contact}. Results that are part of another school’s official tournament record may be kept with your name removed.</p>
      </Section>
      <Section title="Security">
        <p>Connections are encrypted, and access to tournament data is restricted by role in the database. No system is perfectly secure; tell us right away if you think an account has been misused.</p>
      </Section>
      <Section title="Service providers">
        <p>Supabase (database and sign-in) and Vercel (website hosting) process data on our behalf. A payment processor will be added before real payments are taken.</p>
      </Section>
      <Section title="Your choices and rights">
        <p>You can ask to access, correct or delete your personal information, and residents of states with privacy laws may have further rights. Contact us at {contact}. We will not treat you differently for asking.</p>
      </Section>
      <Section title="Changes">
        <p>If we change this policy we will update the date above and, for significant changes, tell signed-in users.</p>
      </Section>
    </>,
  },
  terms: {
    title: 'Terms of use',
    intro: 'The rules for using Orator.',
    body: <>
      <Section title="Who can use Orator">
        <p>You must be at least 13. If you are under 18, you confirm that your coach and a parent or guardian know you are using Orator. Coaches and directors confirm that they are allowed to enter their students’ information.</p>
      </Section>
      <Section title="Your account">
        <p>Keep your password private and your information accurate. Tournament directors approve who joins their tournament and are responsible for how they run it.</p>
      </Section>
      <Section title="Fair use">
        <ul>
          <li>Judge honestly, and keep comments constructive and about the performance.</li>
          <li>Don’t harass anyone, post someone else’s private information, or file false issue reports.</li>
          <li>Don’t try to access data you aren’t permitted to see, or interfere with the service.</li>
        </ul>
      </Section>
      <Section title="Results and the NSAA">
        <p>Orator follows the NSAA ballot format and the procedures in the NSAA Speech Manual, but it is not affiliated with or endorsed by the NSAA. Each tournament’s director is responsible for its official results and rules. In an emergency, call 911 and find tournament staff; don’t rely on Orator.</p>
      </Section>
      <Section title="Your content">
        <p>You keep ownership of what you enter. You allow us to store it and show it to the people the tournament’s access rules permit, only to run the service.</p>
      </Section>
      <Section title="Fees">
        <p>Tournament hosts set entry fees. Schools are invoiced after the tournament, based on their final entries and the judges they brought, and pay digitally. Orator keeps a fee per tournament from what is collected, sized by the number of entries and including card processing, and the rest goes to the host school. Schools can add the coach plan, $99 per school for a season, for season-long growth stats and team comparisons; a 30-day trial is free, and each tournament’s own ballots and results never need the plan. See the <a href="#/refunds">refund policy</a>. Payments are currently simulated and no money is taken.</p>
      </Section>
      <Section title="The service">
        <p>Orator is provided as is, while it is being developed. The demo uses fictional people, results and payments. To the extent the law allows, we are not liable for indirect losses, or for tournament decisions made using Orator.</p>
      </Section>
      <Section title="Ending use">
        <p>You can stop using Orator at any time and ask us to delete your account. We may suspend accounts that break these terms.</p>
      </Section>
      <Section title="Law and changes">
        <p>These terms are governed by the laws of {BUSINESS.state}. We will post changes here and update the date above.</p>
      </Section>
      <Section title="Credits">
        <p>Orator’s typefaces, Instrument Serif, Plus Jakarta Sans and JetBrains Mono, are used under the SIL Open Font License. The logo and icons were made for Orator.</p>
      </Section>
    </>,
  },
  cookies: {
    title: 'Cookies & storage',
    intro: 'Orator does not use cookies. It stores a few things in your browser, each needed for something you ask for.',
    body: <>
      <Section title="What is stored">
        <table className="legal-table">
          <thead><tr><th>Name</th><th>Purpose</th><th>Kept until</th></tr></thead>
          <tbody>
            <tr><td><code>sb-…-auth-token</code></td><td>Keeps you signed in.</td><td>You sign out</td></tr>
            <tr><td><code>orator-register-tournament</code></td><td>Remembers the tournament you chose on the calendar while you sign in, so you land back on it.</td><td>You register, or two days pass</td></tr>
            <tr><td><code>orator-demo-v5</code></td><td>Saves your changes to the demo so they survive a reload.</td><td>You reset the demo or clear site data</td></tr>
          </tbody>
        </table>
      </Section>
      <Section title="Why there is no consent banner">
        <p>Each item is strictly necessary for something you chose to do, and neither is used for tracking, analytics or advertising. We don’t use analytics or advertising cookies, so there is nothing to opt in to. If that changes, we will ask for consent first.</p>
      </Section>
      <Section title="Removing it">
        <p>Sign out to remove the sign-in token, use “Reset demo” on the director’s Details step, or clear this site’s data in your browser settings.</p>
      </Section>
    </>,
  },
  refunds: {
    title: 'Refund policy',
    intro: 'Schools pay after the tournament, not before. Payments in Orator are currently simulated and no money is taken; this policy applies once real payments start.',
    body: <>
      <Section title="Entry fees">
        <p>Entry fees are set by the host school. Each school is invoiced when the tournament ends, based on its final entries and the judges it brought, so entries dropped before the tournament are not charged. If a school is charged in error or overpays, the host refunds the difference.</p>
      </Section>
      <Section title="Orator’s tournament fee">
        <p>If a tournament is cancelled before its schedule is published, for example because of weather, Orator does not charge its fee, and refunds it in full if it was already paid. Once the tournament has taken place, the fee is not refunded.</p>
      </Section>
      <Section title="How to ask">
        <p>Contact the tournament host about entry fees, and Orator at {contact} about Orator’s fee. Refunds go back to the original payment method.</p>
      </Section>
    </>,
  },
  accessibility: {
    title: 'Accessibility',
    intro: 'We aim for Orator to meet the Web Content Accessibility Guidelines (WCAG) 2.1 at level AA.',
    body: <>
      <Section title="What we do">
        <ul>
          <li>Every screen is checked with an automated accessibility tool, in light and dark mode.</li>
          <li>Everything can be done with a keyboard, with a visible focus outline. Drag-and-drop ranking also has arrow buttons and menus.</li>
          <li>Charts include a text description, and icon-only buttons have spoken labels.</li>
          <li>Text meets AA colour contrast, and motion is turned off when your device asks for reduced motion.</li>
        </ul>
      </Section>
      <Section title="Known limits">
        <p>Orator is still being built and hasn’t been tested with every screen reader. The paper-ballot scanning screens are a preview.</p>
      </Section>
      <Section title="Tell us">
        <p>If something is hard to use, contact {contact}. Tell us the page and what you were trying to do.</p>
      </Section>
    </>,
  },
};

export function LegalView({ page, onClose, onOpen }: { page: LegalPage; onClose: () => void; onOpen: (page: LegalPage) => void }) {
  const content = pages[page];
  return <div className="legal-page">
    <header className="legal-head"><a href="#" className="legal-back" onClick={event => { event.preventDefault(); onClose(); }}><Icon name="arrow" size={15}/> Back to Orator</a></header>
    <main id="main" className="legal-main">
      <span className="eyebrow">{BUSINESS.name} · effective {BUSINESS.effective}</span>
      <h1>{content.title}</h1>
      <p className="legal-intro">{content.intro}</p>
      <p className="legal-draft" role="note"><Icon name="info" size={15}/><span><strong>Draft.</strong> Written for review; it has not yet been checked by a lawyer.</span></p>
      {content.body}
    </main>
    <LegalFooter onOpen={onOpen}/>
  </div>;
}
