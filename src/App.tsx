import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Avatar, Badge, Button, Icon, Logo, Progress, downloadText, type IconName } from './ui';
import { StoreProvider, useStore, releaseLabels } from './store';
import { JudgeBallot, SpeakerCheckIn } from './JudgeBallot';
import { ballotEvents } from './ballots';
import { DirectorSetup, CheckInBoard } from './DirectorSetup';
import { HelpModal, type HelpKind } from './HelpModal';
import { StudentRecordExtras, PracticeChecklist, ReminderSettings } from './CoachTools';
import { AuthPage, AuthProvider, authConfigured, useAuth, type Role } from './auth';

type Page = 'auth' | 'signin' | 'student' | 'judge' | 'coach' | 'director' | 'components' | 'styles' | 'states';

const NavigationContext = createContext<(page: Page) => void>(() => undefined);

const rolePages: { id: Page; label: string; icon: IconName }[] = [
  { id: 'auth', label: 'Sign in', icon: 'lock' },
  { id: 'signin', label: 'Choose role', icon: 'users' },
  { id: 'student', label: 'Student', icon: 'growth' },
  { id: 'judge', label: 'Judge', icon: 'ballot' },
  { id: 'coach', label: 'Coach', icon: 'users' },
  { id: 'director', label: 'Director', icon: 'settings' },
];

const utilityPages: { id: Page; label: string; description: string }[] = [
  { id: 'components', label: 'Components', description: 'Reusable UI inventory' },
  { id: 'styles', label: 'Styles', description: 'Tokens and typography' },
  { id: 'states', label: 'System states', description: 'Offline, error, and loading' },
];

function PrototypeNav({ page, setPage, dark, setDark }: { page: Page; setPage: (p: Page) => void; dark: boolean; setDark: (v: boolean) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const utilityPage = utilityPages.find(item => item.id === page);
  return <div className="prototype-nav">
    <div className="preview-brand"><span>Orator</span><small>Interactive preview</small></div>
    <nav className="preview-roles" aria-label="Preview a role">{rolePages.map(item =>
      <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setMoreOpen(false); }}><Icon name={item.icon} size={15}/><span>{item.label}</span></button>
    )}</nav>
    <div className="preview-actions">
      <div className="preview-more"><button className={utilityPage ? 'active' : ''} onClick={() => setMoreOpen(!moreOpen)}><Icon name="menu" size={16}/><span>{utilityPage?.label || 'More'}</span><Icon name="chevron" size={14}/></button>
        {moreOpen && <div className="preview-menu"><span>Prototype resources</span>{utilityPages.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setMoreOpen(false); }}><strong>{item.label}</strong><small>{item.description}</small></button>)}</div>}
      </div>
      <button className="theme-button" aria-label="Toggle light or dark theme" onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'}/></button>
    </div>
  </div>;
}

/** Top bar for signed-in users: only the workspaces their account has, plus sign out. */
function AccountNav({ page, setPage, dark, setDark }: { page: Page; setPage: (p: Page) => void; dark: boolean; setDark: (v: boolean) => void }) {
  const { profile, signOut } = useAuth();
  if (!profile) return null;
  const mine = rolePages.filter(item => profile.roles.includes(item.id as Role));
  return <div className="prototype-nav account-nav">
    <div className="preview-brand"><span>Orator</span></div>
    <nav className="preview-roles" aria-label="Your workspaces">{mine.length > 1 && mine.map(item =>
      <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><Icon name={item.icon} size={15}/><span>{item.label}</span></button>
    )}</nav>
    <div className="preview-actions">
      <span className="account-name"><Avatar initials={profile.initials} size="sm"/><span>{profile.name}</span></span>
      <button className="account-signout" onClick={signOut}>Sign out</button>
      <button className="theme-button" aria-label="Toggle light or dark theme" onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'}/></button>
    </div>
  </div>;
}

function MobileHeader({ title, subtitle, back, initials = 'JL' }: { title: string; subtitle?: string; back?: boolean; initials?: string }) {
  const navigate = useContext(NavigationContext);
  return <header className="mobile-header">
    <button className="icon-button" aria-label={back ? 'Go back' : 'Choose workspace'} onClick={() => back ? window.history.back() : navigate('signin')}><Icon name={back ? 'chevron' : 'menu'}/></button>
    <div className="mobile-title"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
    <Avatar initials={initials} size="sm"/>
  </header>;
}

function Rating({ value, setValue }: { value: number; setValue: (n: number) => void }) {
  return <div className="rating" aria-label="Rating from 1 to 5">{[1,2,3,4,5].map(n =>
    <button key={n} onClick={() => setValue(n)} className={n === value ? 'selected' : ''} aria-label={`Rate ${n}`}>{n}</button>
  )}</div>;
}

function PaperBallot() {
  const [step, setStep] = useState<'choose' | 'camera' | 'preview' | 'uploading' | 'success'>('choose');
  const [flash, setFlash] = useState(false);
  if (step === 'camera') return <div className="camera-screen">
    <div className="camera-top"><button className="icon-button inverse" onClick={() => setStep('choose')}><Icon name="close"/></button><span>Align ballot within frame</span><button className={`icon-button inverse ${flash ? 'active' : ''}`} aria-label="Toggle camera flash" onClick={() => setFlash(!flash)}><Icon name="sparkle"/></button></div>
    <div className="viewfinder"><span className="corner tl"/><span className="corner tr"/><span className="corner bl"/><span className="corner br"/>
      <div className="paper-ghost"><strong>OFFICIAL BALLOT</strong><i/><i/><i/><i/><i/></div>
    </div>
    <div className="camera-help"><Icon name="info"/> Hold steady in good light</div>
    <button className="shutter" aria-label="Take photo" onClick={() => setStep('preview')}><span/></button>
  </div>;
  if (step === 'preview' || step === 'uploading' || step === 'success') return <div className="scan-preview">
    <div className="preview-art"><div className="scanned-paper"><span>ROUND 2 · INFORMATIVE</span><strong>Judge Ballot</strong>{[1,2,3,4,5].map(n => <i key={n}/>)}</div></div>
    {step === 'preview' && <><h2>Is everything readable?</h2><p>Make sure ranks, signatures, and comments are visible.</p><div className="preview-actions"><Button variant="secondary" onClick={() => setStep('camera')}>Retake</Button><Button icon="upload" onClick={() => setStep('uploading')}>Use photo</Button></div></>}
    {step === 'uploading' && <div className="upload-panel"><span className="spinner"/><h2>Uploading ballot…</h2><Progress value={68}/><p>Keep Orator open. We’ll finish if your connection drops.</p><Button variant="secondary" onClick={() => setStep('success')}>Simulate complete</Button></div>}
    {step === 'success' && <div className="success-panel"><span className="success-icon"><Icon name="check" size={26}/></span><h2>Ballot uploaded</h2><p>Round 2 is filed and available to the tournament director.</p><Button onClick={() => setStep('choose')}>Done</Button></div>}
  </div>;
  return <div className="paper-content">
    <div className="paper-intro"><span className="illustration"><Icon name="file" size={38}/></span><h2>Add a paper ballot</h2><p>Upload a saved file or scan a paper ballot with your camera.</p></div>
    <button className="choice-card" onClick={() => setStep('camera')}><span className="choice-icon"><Icon name="camera"/></span><span><strong>Scan with camera</strong><small>Fastest · PDF created automatically</small></span><Icon name="arrow"/></button>
    <button className="choice-card" onClick={() => setStep('uploading')}><span className="choice-icon"><Icon name="upload"/></span><span><strong>Upload file</strong><small>PDF, JPG, or PNG · up to 10 MB</small></span><Icon name="arrow"/></button>
    <div className="offline-note"><Icon name="wifi"/><span><strong>Weak connection?</strong> Scans save on this device and upload when you’re back online.</span></div>
  </div>;
}

function BallotPage() {
  const [format, setFormat] = useState<'e' | 'paper'>('e');
  return <MobileFrame>
    <MobileHeader title="Judge Leather" subtitle="Gothenburg Invitational"/>
    <div className="segmented ballot-toggle"><button className={format === 'e' ? 'active' : ''} onClick={() => setFormat('e')}>E-ballot</button><button className={format === 'paper' ? 'active' : ''} onClick={() => setFormat('paper')}>Paper</button></div>
    {format === 'e' ? <JudgeBallot/> : <PaperBallot/>}
  </MobileFrame>;
}

function MobileFrame({ children }: { children: ReactNode }) {
  return <div className="mobile-stage"><div className="phone-frame">{children}</div></div>;
}

const rounds = [
  { round: 1, time: 'Completed · 8:00 AM', locked: true, chips: ['submitted','submitted','submitted','submitted','submitted','submitted'] },
  { round: 2, time: 'In progress · 9:30 AM', locked: false, chips: ['submitted','submitted','draft','submitted','missing','draft'] },
  { round: 3, time: 'Starts at 11:00 AM', locked: false, chips: ['missing','missing','missing','missing','missing','missing'] },
  { round: 4, time: 'Starts at 1:30 PM', locked: false, chips: ['missing','missing','missing','missing','missing','missing'] },
];

function RoundsPage({ director = false }: { director?: boolean }) {
  const [expanded, setExpanded] = useState(1);
  const navigate = useContext(NavigationContext);
  return <MobileFrame><MobileHeader title={director ? 'Round control' : 'My ballots'} subtitle={director ? 'Gothenburg Invitational' : 'Saturday, Oct 19'} initials={director ? 'DD' : 'JL'}/>
    <div className="mobile-page">
      <div className="page-lead"><div><span className="eyebrow">VARSITY INFORMATIVE</span><h1>Four prelim rounds</h1></div><Badge tone="success" icon="check">On track</Badge></div>
      <div className="completion-card"><div className="ring">8<span>/24</span></div><div><strong>Ballots complete</strong><p>2 drafts need your attention</p></div></div>
      <div className="round-list">{rounds.map((item, idx) => <article className={`round-card ${item.locked ? 'locked' : ''}`} key={item.round}>
        <button className="round-head" onClick={() => setExpanded(expanded === idx ? -1 : idx)}>
          <span><span className="round-number">{item.locked ? <Icon name="lock" size={16}/> : item.round}</span><span><strong>Round {item.round}</strong><small>{item.time}</small></span></span>
          <Icon name="chevron"/>
        </button>
        {expanded === idx && <div className="round-body">
          <div className="competitor-grid">{item.chips.map((status, i) => <div className={`competitor ${status}`} key={i}><span>C{i+1}</span><small>{status}</small></div>)}</div>
          {item.locked ? <div className="locked-note"><Icon name="lock"/><span><strong>Round closed</strong><small>Ballots locked by director at 9:20 AM</small></span></div> :
            <Button variant="secondary" icon="edit" className="full" onClick={() => navigate('judge')}>Edit round ballots</Button>}
        </div>}
      </article>)}</div>
    </div>
    {!director && <MobileTab active="ballots"/>}
  </MobileFrame>;
}

function MobileTab({ active }: { active: string }) {
  const navigate = useContext(NavigationContext);
  return <nav className="mobile-tab"><button onClick={() => navigate('judge')}><Icon name="home"/><span>Home</span></button><button className={active === 'ballots' ? 'active' : ''} onClick={() => navigate('judge')}><Icon name="ballot"/><span>Ballots</span></button><button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><Icon name="clock"/><span>Schedule</span></button></nav>;
}

type Persona = 'student' | 'judge' | 'coach' | 'director';

const personaDetails: Record<Persona, { name: string; detail: string; initials: string }> = {
  student: { name: 'Maya Rodriguez', detail: 'Student · Lincoln HS', initials: 'MR' },
  judge: { name: 'Judge Leather', detail: 'Community judge', initials: 'JL' },
  coach: { name: 'Erin Johnson', detail: 'Head coach · Lincoln HS', initials: 'EJ' },
  director: { name: 'Dan Miller', detail: 'Tournament director', initials: 'DD' },
};

const sidebarItems: Record<Persona, [IconName, string][]> = {
  student: [['home','Overview'],['archive','Archive']],
  judge: [['home','Overview'],['ballot','Ballots'],['archive','Archive']],
  coach: [['home','Overview'],['users','Entries'],['growth','Analytics'],['archive','Archive']],
  director: [['home','Overview'],['settings','Tournament setup']],
};

function DesktopShell({ active, children, title, subtitle, persona = 'coach' }: { active: string; children: ReactNode; title: string; subtitle: string; persona?: Persona }) {
  const [section, setSection] = useState(active);
  const [headerPanel, setHeaderPanel] = useState<'search' | 'help' | null>(null);
  const [helpModal, setHelpModal] = useState<HelpKind | null>(null);
  const navigate = useContext(NavigationContext);
  const { profile: account } = useAuth();
  const profile = account ? { name: account.name, detail: account.school || `${persona[0].toUpperCase()}${persona.slice(1)}`, initials: account.initials } : personaDetails[persona];
  const showingPrimary = section === active;
  const sectionSubtitles: Record<string,string> = {
    Overview: 'A live view of today’s tournament activity.',
    Entries: 'Manage students, judges, events, and registration status.',
    Ballots: 'Review assignments, drafts, submissions, and feedback.',
    Analytics: 'Track performance, feedback quality, and tournament trends.',
    Archive: 'Find historical ballots, tournaments, and downloadable records.',
    'Tournament setup': 'Configure events, rounds, rooms, criteria, and permissions.',
  };
  return <div className="desktop-shell">
    <aside className="sidebar"><Logo/><div className="tournament-chip"><span className="tiny-logo">GI</span><span><strong>Gothenburg Invitational</strong><small>Oct 19, 2025</small></span><Icon name="chevron" size={15}/></div>
      {(persona === 'coach' || persona === 'judge') && <div className="role-switcher"><span>Working as</span><div><button className={persona === 'coach' ? 'active' : ''} onClick={() => navigate('coach')}><Icon name="users" size={15}/> Coach</button><button className={persona === 'judge' ? 'active' : ''} onClick={() => navigate('judge')}><Icon name="ballot" size={15}/> Judge</button></div><small>Switch roles without signing out</small></div>}
      <span className="sidebar-section-label">{persona} workspace</span>
      <nav>
        {sidebarItems[persona].map(([icon,label]) =>
          <button key={label} className={section === label ? 'active' : ''} onClick={() => setSection(label)}><Icon name={icon}/><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><div className="save-chip"><Icon name="check"/> All changes saved</div><button className="profile" onClick={() => navigate('signin')}><Avatar initials={profile.initials}/><span><strong>{profile.name}</strong><small>{profile.detail}</small></span><Icon name="chevron" size={15}/></button></div>
    </aside>
    <main className="desktop-main"><header className="desktop-header"><div><span className="workspace-context">{persona} <Icon name="arrow" size={12}/> {showingPrimary ? active : section}</span><h1>{showingPrimary ? title : section}</h1><p>{showingPrimary ? subtitle : sectionSubtitles[section]}</p></div><div className="header-actions"><button className="header-tool" aria-label="Search" onClick={() => setHeaderPanel(headerPanel === 'search' ? null : 'search')}><Icon name="search"/><span>Search</span></button><button className="header-tool" aria-label="Help and notifications" onClick={() => setHeaderPanel(headerPanel === 'help' ? null : 'help')}><Icon name="info"/><span>Help</span></button><Avatar initials={profile.initials}/></div>{headerPanel === 'search' && <div className="header-popover"><label className="search-box"><Icon name="search"/><input autoFocus placeholder="Search this workspace"/></label><span>Try a student, event, ballot, or tournament.</span></div>}{headerPanel === 'help' && <div className="header-popover help-popover"><strong>How can we help?</strong><button onClick={() => { setHeaderPanel(null); setHelpModal('guide'); }}><Icon name="file"/> View quick-start guide</button><button onClick={() => { setHeaderPanel(null); setHelpModal('support'); }}><Icon name="comment"/> Report an issue to the tab room</button></div>}</header>
      <nav className="mobile-workspace-nav" aria-label={`${persona} workspace navigation`}>{sidebarItems[persona].map(([icon,label]) => <button key={label} className={section === label ? 'active' : ''} onClick={() => setSection(label)}><Icon name={icon}/><span>{label}</span></button>)}{(persona === 'coach' || persona === 'judge') && <button onClick={() => navigate(persona === 'coach' ? 'judge' : 'coach')}><Icon name={persona === 'coach' ? 'ballot' : 'users'}/><span>Switch to {persona === 'coach' ? 'Judge' : 'Coach'}</span></button>}</nav>
      {showingPrimary ? children : <SidebarTopicView topic={section} persona={persona}/>}</main>
    {helpModal && <HelpModal kind={helpModal} persona={persona} onClose={() => setHelpModal(null)}/>}
  </div>;
}

const topicContent: Record<string, { eyebrow: string; title: string; description: string; metrics: [string,string,string,IconName][]; rows: [string,string,string][] }> = {
  Overview: { eyebrow: 'LIVE TOURNAMENT', title: 'Everything is on track', description: 'Monitor rounds, rooms, entries, and ballots from one place.', metrics: [['Round','2 of 4','In progress','clock'],['Entries','184','6 events','users'],['Ballots','68%','Submitted','ballot'],['Conflicts','2','Need review','warning']], rows: [['Varsity Informative','Round 2 · 12 ballots','On time'],['Original Oratory','Round 2 · 10 ballots','On time'],['Poetry Interpretation','Round 1 · 2 missing','Review']] },
  Entries: { eyebrow: 'REGISTRATION', title: 'Entries and participants', description: 'Search and manage every student, judge, and event registration.', metrics: [['Students','126','4 waitlisted','users'],['Judges','42','39 confirmed','users'],['Schools','18','All checked in','home'],['Imports','12','Ready to review','upload']], rows: [['Maya Rodriguez','Lincoln HS · Informative','Confirmed'],['Eli Thompson','Lincoln HS · Extemp','Confirmed'],['Nora Patel','Lincoln HS · Oratory','Needs form']] },
  Ballots: { eyebrow: 'BALLOT CONTROL', title: 'Ballots without the paper chase', description: 'Open, review, edit, and follow up on every tournament ballot.', metrics: [['Submitted','82','68% complete','check'],['Drafts','11','Autosaved','edit'],['Missing','4','Need attention','warning'],['Quality','92%','Useful feedback','comment']], rows: [['Round 2 · Informative','Judge Leather · 6 competitors','Open ballot'],['Round 2 · Extemp','Maria Chen · Draft saved','Continue'],['Round 1 · Poetry','David Ross · Submitted','View feedback']] },
  Analytics: { eyebrow: 'PERFORMANCE', title: 'Trends that lead to better coaching', description: 'Compare event performance and feedback quality across rounds.', metrics: [['Avg. score','4.2','+0.4 today','growth'],['Top event','Info','4 finalists','sparkle'],['Feedback','146','Comments','comment'],['Win rate','68%','+6% season','growth']], rows: [['Delivery','Average 4.5 of 5','Strongest'],['Organization','Average 4.1 of 5','Improving'],['Thesis','Average 3.7 of 5','Coach next']] },
  Archive: { eyebrow: 'RECORDS', title: 'Every result, ready when you need it', description: 'Search completed tournaments, ballots, and exported records.', metrics: [['Ballots','1,248','Since 2023','archive'],['Tournaments','26','12 wins','ballot'],['Students','84','Historical','users'],['Exports','18','PDF & CSV','download']], rows: [['Millard West Classic','Oct 12 · 48 ballots','Download'],['Norfolk Invitational','Oct 5 · 52 ballots','Open'],['Lincoln East Open','Sep 28 · 44 ballots','Open']] },
  'Tournament setup': { eyebrow: 'CONFIGURATION', title: 'Tournament setup', description: 'Keep events, rooms, rounds, and permissions ready for competition.', metrics: [['Events','10','8 complete','ballot'],['Rooms','24','All assigned','home'],['Rounds','4','Published','clock'],['Criteria','4/10','Needs work','settings']], rows: [['Tournament details','Dates, location, contact','Complete'],['Ballot criteria','4 of 10 events configured','Continue setup'],['Judge permissions','42 judges invited','Complete']] },
};

const personaArchives: Partial<Record<Persona, typeof topicContent.Archive>> = {
  student: { eyebrow: 'MY HISTORY', title: 'Your previous tournaments', description: 'Revisit your ballots, rankings, and feedback from every competition.', metrics: [['Tournaments','8','This season','archive'],['Ballots','32','All available','ballot'],['Finals','6','Personal best','sparkle'],['Feedback','94','Judge comments','comment']], rows: [['Millard West Classic','Informative · 3rd place · Oct 12','View ballots'],['Norfolk Invitational','Informative · 2nd place · Oct 5','View feedback'],['Lincoln East Open','Informative · 1st place · Sep 28','View results']] },
  judge: { eyebrow: 'JUDGING HISTORY', title: 'Tournaments you judged', description: 'Review your submitted ballots and assignments from previous tournaments.', metrics: [['Tournaments','12','This season','archive'],['Ballots','86','Submitted','ballot'],['Events','7','Judged','sparkle'],['On time','98%','Submission rate','check']], rows: [['Millard West Classic','18 ballots · Informative & Extemp','View ballots'],['Norfolk Invitational','16 ballots · Oratory & Poetry','View ballots'],['Lincoln East Open','20 ballots · Informative','View summary']] },
  coach: { eyebrow: 'TEAM HISTORY', title: 'Lincoln Speech tournament archive', description: 'Find team ballots, results, and exports from every previous tournament.', metrics: [['Tournaments','26','Since 2023','archive'],['Team ballots','1,248','Searchable','ballot'],['Students','84','Historical records','users'],['Team wins','12','Across all events','sparkle']], rows: [['Millard West Classic','18 students · 48 ballots · Oct 12','Download team file'],['Norfolk Invitational','16 students · 52 ballots · Oct 5','Open results'],['Lincoln East Open','14 students · 44 ballots · Sep 28','Open results']] },
};

function SidebarTopicView({ topic, persona }: { topic: string; persona: Persona }) {
  const data = topic === 'Archive' && personaArchives[persona] ? personaArchives[persona]! : topicContent[topic] || topicContent.Overview;
  const [search, setSearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<[string,string,string] | null>(null);
  const rows = data.rows.filter(row => row.join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className="topic-page">
    <section className="topic-hero"><div><span className="eyebrow">{data.eyebrow}</span><h2>{data.title}</h2><p>{data.description}</p></div><Button icon={topic === 'Entries' ? 'plus' : topic === 'Archive' ? 'download' : 'arrow'} onClick={() => setSelectedRecord(data.rows[0])}>{topic === 'Entries' ? 'Add entry' : topic === 'Archive' ? 'Export records' : 'Open workspace'}</Button></section>
    <div className="metric-grid">{data.metrics.map(([label,value,note,icon]) => <Metric key={label} label={label} value={value} note={note} icon={icon}/>)}</div>
    <section className="panel topic-panel"><div className="panel-head"><div><h2>{topic === 'Overview' ? 'Live event status' : topic}</h2><p>Gothenburg Invitational · Updated just now</p></div><label className="search-box"><Icon name="search"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${topic.toLowerCase()}`}/></label></div>
      <div className="topic-list">{rows.map(([name,detail,status]) => <button className="topic-row" key={name} onClick={() => setSelectedRecord([name,detail,status])}><span className="topic-row-icon"><Icon name={topic === 'Entries' ? 'users' : topic === 'Ballots' ? 'ballot' : topic === 'Analytics' ? 'growth' : topic === 'Archive' ? 'archive' : 'settings'}/></span><span><strong>{name}</strong><small>{detail}</small></span><Badge tone={status.includes('missing') || status.includes('Needs') ? 'warning' : 'success'}>{status}</Badge><Icon name="arrow"/></button>)}</div>
      {selectedRecord && <div className="topic-record"><span className="topic-row-icon"><Icon name={topic === 'Archive' ? 'archive' : topic === 'Ballots' ? 'ballot' : 'info'}/></span><div><span className="eyebrow">SELECTED RECORD</span><strong>{selectedRecord[0]}</strong><p>{selectedRecord[1]}</p></div><Badge tone="success">{selectedRecord[2]}</Badge><Button variant="secondary" icon={topic === 'Archive' ? 'download' : 'edit'} onClick={() => setSelectedRecord(null)}>{topic === 'Archive' ? 'Download record' : 'Done'}</Button></div>}
    </section>
    <div className="desktop-hint"><Icon name="info"/><span>This {topic.toLowerCase()} view is tailored for the {persona} workspace. Use the sidebar to explore another topic.</span></div>
  </div>;
}

function SignInPage() {
  const navigate = useContext(NavigationContext);
  const { profile } = useAuth();
  const [selected, setSelected] = useState<Persona>(profile ? profile.roles[0] : 'coach');
  const destination: Record<Persona, Page> = { student: 'student', judge: 'judge', coach: 'coach', director: 'director' };
  const roles: { id: Persona; icon: IconName; title: string; description: string; name: string; detail: string }[] = [
    { id: 'student', icon: 'growth', title: 'Student', description: 'Rounds, results, feedback, and growth.', name: 'Maya Rodriguez', detail: 'Lincoln High School' },
    { id: 'judge', icon: 'ballot', title: 'Judge', description: 'Assignments, ballots, and preferences.', name: 'Judge Leather', detail: 'Community judge' },
    { id: 'coach', icon: 'users', title: 'Coach', description: 'Entries, analytics, and team records.', name: 'Erin Johnson', detail: 'Lincoln High School' },
    { id: 'director', icon: 'settings', title: 'Director', description: 'Tournament setup and operations.', name: 'Dan Miller', detail: 'Gothenburg Invitational' },
  ].filter(role => !profile || profile.roles.includes(role.id as Role)).map(role => profile ? { ...role, name: profile.name, detail: profile.school || profile.email } : role) as { id: Persona; icon: IconName; title: string; description: string; name: string; detail: string }[];
  const selectedRole = roles.find(role => role.id === selected)!;
  return <div className="signin-page">
    <header className="signin-header"><Logo/>{!profile && <div><Badge tone="success" icon="check">Demo accounts ready</Badge></div>}</header>
    <main className="signin-main">
      <section className="signin-intro"><Badge tone="info" icon="sparkle">One account, every tournament role</Badge><h1>How are you joining today?</h1><p>Choose a role to enter the right workspace. You can switch roles later without signing out.</p></section>
      <div className="role-card-grid">{roles.map(role => <button key={role.id} className={`signin-role-card ${selected === role.id ? 'selected' : ''}`} onClick={() => setSelected(role.id)}>
        <span className="signin-role-icon"><Icon name={role.icon} size={24}/></span><span className="role-check">{selected === role.id && <Icon name="check" size={15}/>}</span><strong>{role.title}</strong><p>{role.description}</p><div><Avatar initials={role.name.split(' ').map(part => part[0]).join('').slice(0,2)} size="sm"/><span><strong>{role.name}</strong><small>{role.detail}</small></span></div>
      </button>)}</div>
      {!profile && <section className="multi-role-callout"><span className="multi-role-icon"><Icon name="users" size={25}/></span><div><Badge tone="success" icon="check">Coach + Judge account</Badge><h2>Wearing more than one hat?</h2><p>Erin can coach her team and judge a round at the same tournament. Orator keeps both workspaces separate and lets her switch in one click.</p><div className="mini-role-switch"><span className="active"><Icon name="users"/> Coach workspace</span><Icon name="arrow"/><span><Icon name="ballot"/> Judge workspace</span></div></div></section>}
      <div className="signin-action"><div><span>Continuing as</span><strong>{selectedRole.name} · {selectedRole.title}</strong></div><Button icon="arrow" onClick={() => navigate(destination[selected])}>Continue to {selectedRole.title}</Button></div>
      <p className="signin-security"><Icon name="lock" size={14}/> Your school and tournament permissions determine what you can access.</p>
    </main>
  </div>;
}

function DirectorPage() {
  const [uploaded, setUploaded] = useState(false);
  const [view, setView] = useState<'setup' | 'checkin' | 'rounds'>('setup');
  const titles = { setup: ['Tournament setup', 'Details, ballot criteria, judges, and what each role can see.'], checkin: ['Check-in', 'See who has arrived and find any judge, room, or event.'], rounds: ['Round management', 'Monitor ballot completion and make round-level corrections.'] };
  return <DesktopShell active="Tournament setup" title={titles[view][0]} subtitle={titles[view][1]} persona="director">
    <div className="director-workspace"><div className="role-tabs director-tabs"><button className={view === 'setup' ? 'active' : ''} onClick={() => setView('setup')}>Setup</button><button className={view === 'checkin' ? 'active' : ''} onClick={() => setView('checkin')}>Check-in</button><button className={view === 'rounds' ? 'active' : ''} onClick={() => setView('rounds')}>Mobile rounds</button></div>
    {view === 'rounds' ? <div className="director-rounds"><RoundsPage director/></div> : view === 'checkin' ? <CheckInBoard/> : <div className="setup-layout">
      <DirectorSetup judges={<JudgeAssignments/>} criteria={!uploaded ? <section className="upload-card">
          <span className="upload-illustration"><Icon name="upload" size={30}/></span><h2>Bring in your ballot PDFs</h2><p>The 11 NSAA ballots are built in. Upload a PDF only if your tournament uses different criteria.</p>
          <button className="dropzone" onClick={() => setUploaded(true)}><Icon name="file" size={26}/><strong>Drop PDFs here, or click to browse</strong><small>Up to 20 PDFs · 25 MB each</small></button>
          <div className="or"><span/>or<span/></div><Button variant="secondary" icon="archive" onClick={() => setUploaded(true)}>Use existing PDFs</Button>
        </section> : <ParsedCriteria/>}/>
      <aside className="setup-aside">
        <div className="progress-card"><div className="progress-top"><span className="progress-ring">4<small>/10</small></span><div><strong>Criteria added</strong><p>4 of 10 events ready</p></div></div><Progress value={40}/></div>
        <div className="alert-card"><span><Icon name="warning"/></span><div><strong>2 events are missing</strong><p>OID and POI don’t have ballot criteria yet.</p><button onClick={() => setUploaded(true)}>Review missing events <Icon name="arrow" size={15}/></button></div></div>
        <div className="tip-card"><Icon name="sparkle"/><div><strong>Built for better feedback</strong><p>Judges see criteria one section at a time, with prompts that work on mobile.</p></div></div>
      </aside>
    </div>}
    </div>
  </DesktopShell>;
}

function ParsedCriteria() {
  const [selected, setSelected] = useState('Informative');
  const [editing, setEditing] = useState(false);
  const [approved, setApproved] = useState(false);
  return <section className="parsed-card">
    <div className="parsed-head"><span className="file-success"><Icon name="check"/></span><div><h2>NSAA criteria ready for 4 events</h2><p>Review each event before adding it to your tournament.</p></div><Badge tone="success" icon="check">4 PDFs imported</Badge></div>
    <div className="event-tabs">{['Informative','Extemp','Persuasive','Humorous'].map(e => <button className={selected === e ? 'active' : ''} onClick={() => setSelected(e)} key={e}>{e}<Badge tone="success" icon="check">Ready</Badge></button>)}</div>
    <div className="criteria-review"><div className="review-title"><div><span className="eyebrow">OFFICIAL NSAA BALLOT</span><h3>{selected}</h3></div><Button variant="ghost" icon={editing ? 'check' : 'edit'} onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit criteria'}</Button></div>
      {editing && <div className="edit-notice"><Icon name="edit"/><span>Editing is on. Select a criterion row to revise its guide or scale.</span></div>}
      <div className="criteria-table"><div className="table-head"><span>Criterion</span><span>Judges are asked</span><span>Scored by</span></div>{(ballotEvents.find(event => event.short === selected) || ballotEvents[0]).criteria.map(item => <div className="table-row" key={item.name}><strong>{item.name}</strong><span>{item.questions[0]}</span><Badge tone="neutral">Rating 35–50</Badge></div>)}</div>
      <div className="review-footer"><Badge tone={approved ? 'success' : 'info'} icon={approved ? 'check' : 'sparkle'}>{approved ? 'Approved for tournament' : 'Matches the NSAA ballot · Review recommended'}</Badge><Button icon="check" disabled={approved} onClick={() => setApproved(true)}>{approved ? 'Event added' : 'Approve & add event'}</Button></div>
    </div>
  </section>;
}

const prefEvents = [
  { name: 'Dramatic Interpretation', code: 'DI', level: 'top' },
  { name: 'Informative Speaking', code: 'INFO', level: 'top' },
  { name: 'Extemporaneous Speaking', code: 'EXT', level: 'willing' },
  { name: 'Original Oratory', code: 'OO', level: 'willing' },
  { name: 'Poetry Interpretation', code: 'POE', level: 'avoid' },
];

function JudgeAssignments() {
  const [events, setEvents] = useState(prefEvents);
  const [dragged, setDragged] = useState<number | null>(null);
  const [autoAssigned, setAutoAssigned] = useState(false);
  const move = (index: number, dir: -1 | 1) => {
    const copy = [...events]; const target = index + dir;
    if (target < 0 || target >= copy.length) return;
    [copy[index], copy[target]] = [copy[target], copy[index]]; setEvents(copy);
  };
  return <div className="preferences-layout">
      <section className="preference-builder">
        <div className="builder-head"><div><h2>Judge Leather</h2><p>Lincoln High School · 8 years judging</p></div><Badge tone="success" icon="check">Preferences complete</Badge></div>
        <div className="preference-note"><Icon name="drag"/><span>Drag to reorder events. The top of each group is the strongest preference.</span></div>
        <div className="pref-groups">
          {(['top','willing','avoid'] as const).map(level => <div className={`pref-group ${level}`} key={level}>
            <div className="pref-label"><span>{level === 'top' ? 'Top choices' : level === 'willing' ? 'Willing to judge' : 'Prefer to avoid'}</span><Badge tone={level === 'top' ? 'success' : level === 'avoid' ? 'pink' : 'neutral'}>{events.filter(e => e.level === level).length}</Badge></div>
            {events.map((event,index) => event.level === level && <div className="event-row" key={event.code} draggable onDragStart={() => setDragged(index)} onDragOver={e => e.preventDefault()} onDrop={() => {
              if (dragged === null || dragged === index) return;
              const copy = [...events]; const [item] = copy.splice(dragged, 1); copy.splice(index, 0, item); setEvents(copy); setDragged(null);
            }}>
              <Icon name="drag"/><span className="event-code">{event.code}</span><span><strong>{event.name}</strong><small>{level === 'avoid' ? 'Low confidence' : level === 'top' ? 'Highly experienced' : 'Comfortable'}</small></span>
              <div className="reorder"><button aria-label="Move up" onClick={() => move(index,-1)}>↑</button><button aria-label="Move down" onClick={() => move(index,1)}>↓</button></div>
            </div>)}
          </div>)}
        </div>
      </section>
      <section className="assignment-panel">
        <div className="assignment-head"><div><h2>Round 2 assignments</h2><p>42 judges · {autoAssigned ? '2' : '7'} conflicts to resolve</p></div><Button variant="secondary" disabled={autoAssigned} onClick={() => setAutoAssigned(true)}>{autoAssigned ? 'Assignments updated' : 'Auto-assign'}</Button></div>
        <div className="assignment-stats"><div><strong>35</strong><span>Good fit</span></div><div className="warn"><strong>5</strong><span>Preference mismatch</span></div><div className="bad"><strong>2</strong><span>School conflict</span></div></div>
        <div className="assignment-list">{[
          ['Judge Leather','Informative','Strong preference','success'],
          ['Maria Chen','Poetry','Prefers to avoid','warning'],
          ['David Ross','Extemp','School conflict','danger'],
          ['Alyssa Ford','Oratory','Willing to judge','neutral'],
        ].map(([name,event,note,tone]) => <div className="assignment-row" key={name}><Avatar initials={name.split(' ').map(n=>n[0]).join('')} size="sm"/><span><strong>{name}</strong><small>{event}</small></span><Badge tone={tone as 'success'|'warning'|'danger'|'neutral'} icon={tone === 'danger' ? 'warning' : tone === 'success' ? 'check' : undefined}>{note}</Badge><button className="icon-button" aria-label={`Resolve ${name} assignment`} onClick={() => setAutoAssigned(true)}><Icon name="menu"/></button></div>)}</div>
      </section>
    </div>;
}

function CoachPage() {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'team' | 'growth' | 'ballots' | 'entries' | 'import' | 'student'>('team');
  const [selectedStudent, setSelectedStudent] = useState('Maya Rodriguez');
  const ballots = [
    ['Maya Rodriguez','Judge Leather','Informative','Gothenburg Invitational','1st','Oct 19'],
    ['Eli Thompson','Maria Chen','Extemp','Millard West Classic','3rd','Oct 12'],
    ['Maya Rodriguez','David Ross','Informative','Norfolk Invitational','2nd','Oct 05'],
    ['Nora Patel','Alyssa Ford','Original Oratory','Lincoln East Open','1st','Sep 28'],
  ].filter(row => row.join(' ').toLowerCase().includes(query.toLowerCase()));
  return <DesktopShell active="Overview" title="Good morning, Erin" subtitle="Your team, ballots, and coaching priorities are ready." persona="coach">
    <div className="role-dashboard">
      <section className="role-hero coach-hero"><div><Badge tone="warning" icon="warning">3 items need attention</Badge><h2>Lincoln Speech is on track</h2><p>Gothenburg Invitational · Round 2 underway · 18 students competing</p><div className="hero-actions"><Button icon="users" onClick={() => setView('entries')}>View team entries</Button><Button variant="secondary" icon="upload" onClick={() => setView('import')}>Import student CSV</Button></div></div><div className="hero-stat"><span>Team win rate</span><strong>68%</strong><small>up 6% this season</small></div></section>
      <div className="metric-grid"><Metric label="Active students" value="46" note="+8 this season" icon="users"/><Metric label="Ballots received" value="128" note="92% useful feedback" icon="ballot"/><Metric label="Students competing" value="18" note="6 events today" icon="sparkle"/><Metric label="Next round" value="24m" note="Round 2 · 9:30" icon="clock"/></div>
      <div className="role-tabs"><button className={view === 'team' || view === 'entries' || view === 'import' ? 'active' : ''} onClick={() => setView('team')}>Team overview</button><button className={view === 'growth' ? 'active' : ''} onClick={() => setView('growth')}>Student growth</button><button className={view === 'ballots' ? 'active' : ''} onClick={() => setView('ballots')}>Ballot review</button></div>
      {view === 'team' ? <div className="role-grid">
        <section className="panel coach-team-panel"><div className="panel-head"><div><h2>Team at Gothenburg</h2><p>Live status across all six events</p></div><Badge tone="success" icon="check">18 checked in</Badge></div>
          <div className="coach-student-list">{[
            ['MR','Maya Rodriguez','Informative · Round 2','Competing','success'],
            ['ET','Eli Thompson','Extemp · Prep room','Preparing','info'],
            ['NP','Nora Patel','Original Oratory · Round 2','Competing','success'],
            ['SW','Sam Wilson','Poetry · Ballot posted','Feedback ready','warning'],
          ].map(([initials,name,detail,status,tone]) => <button key={name} onClick={() => { setSelectedStudent(name); setView('student'); }}><Avatar initials={initials} size="sm"/><span><strong>{name}</strong><small>{detail}</small></span><Badge tone={tone as 'success'|'info'|'warning'}>{status}</Badge><Icon name="arrow"/></button>)}</div>
        </section>
        <aside className="panel coach-priorities"><div className="panel-head"><div><h2>Coach priorities</h2><p>What needs attention now</p></div><Badge tone="warning">3</Badge></div>{[
          ['warning','Review disputed rank','Maya · Round 1 ballot'],
          ['comment','Low-comment ballot','Sam · Poetry'],
          ['upload','CSV ready to import','12 new students'],
        ].map(([icon,title,note],i) => <button key={title} onClick={() => i < 2 ? setView('ballots') : setView('import')}><span><Icon name={icon as IconName}/></span><span><strong>{title}</strong><small>{note}</small></span><Icon name="arrow"/></button>)}</aside>
      </div> : view === 'entries' ? <section className="panel action-workspace"><div className="panel-head"><div><h2>Team entries</h2><p>Gothenburg Invitational · 18 students across 6 events</p></div><Button variant="secondary" icon="arrow" onClick={() => setView('team')}>Back to overview</Button></div>
        <div className="entry-summary"><div><Badge tone="success" icon="check">18 confirmed</Badge><strong>All students are checked in</strong><p>Entry changes remain open until Round 3 begins.</p></div><Button icon="plus" onClick={() => setView('import')}>Add student</Button></div>
        <div className="entry-table">{[['Maya Rodriguez','Informative','V42','Confirmed'],['Eli Thompson','Extemp','E18','In prep'],['Nora Patel','Original Oratory','O07','Confirmed'],['Sam Wilson','Poetry','P31','Feedback ready'],['Iris Chen','Dramatic Interpretation','D12','Confirmed']].map(([name,event,code,status]) => <button key={name} onClick={() => { setSelectedStudent(name); setView('student'); }}><Avatar initials={name.split(' ').map(part => part[0]).join('')} size="sm"/><span><strong>{name}</strong><small>{event}</small></span><Badge tone="neutral">{code}</Badge><Badge tone={status === 'Confirmed' ? 'success' : status === 'In prep' ? 'info' : 'warning'}>{status}</Badge><Icon name="arrow"/></button>)}</div>
      </section> : view === 'student' ? <section className="panel action-workspace student-record"><div className="panel-head"><div><h2>{selectedStudent}</h2><p>Student record · Lincoln High School</p></div><Button variant="secondary" icon="arrow" onClick={() => setView('entries')}>Back to entries</Button></div><div className="student-record-hero"><Avatar initials={selectedStudent.split(' ').map(part => part[0]).join('')} /><div><Badge tone="success" icon="check">Checked in</Badge><h3>{selectedStudent}</h3><p>Varsity Informative · Code V42 · Junior</p></div><div><strong>4.3</strong><small>Season average</small></div><Button icon="comment" onClick={() => setView('ballots')}>View ballots</Button></div><div className="student-record-grid"><div><span>Next round</span><strong>Round 2 · 9:30 AM</strong><small>Room 214 · Speaks third</small></div><div><span>Season results</span><strong>6 finals · 2 wins</strong><small>8 tournaments entered</small></div><div><span>Coaching focus</span><strong>Delivery & pacing</strong><small>Based on recent ballots</small></div></div><StudentRecordExtras student={selectedStudent}/></section> : view === 'import' ? <section className="panel action-workspace"><div className="panel-head"><div><h2>Import student CSV</h2><p>Add or update team entries from PowerSchool or your roster file.</p></div><Button variant="secondary" icon="close" onClick={() => setView('team')}>Cancel</Button></div>
        <div className="csv-import"><span className="upload-illustration"><Icon name="upload" size={30}/></span><h3>Drop your student CSV here</h3><p>We’ll preview every change before anything is added. Required columns: student name, graduation year, and event.</p><label className="dropzone"><input type="file" accept=".csv" onChange={() => setView('entries')}/><Icon name="file" size={25}/><strong>Choose CSV file</strong><small>CSV only · up to 10 MB</small></label><div className="import-actions"><Badge tone="info" icon="info">No changes are made without review</Badge><Button icon="arrow" onClick={() => setView('entries')}>Use sample file</Button></div></div>
      </section> : view === 'growth' ? <div className="role-grid">
        <section className="panel growth-panel"><div className="panel-head"><div><h2>Student growth</h2><p>Average ballot criteria across the last five tournaments</p></div><select><option>Maya Rodriguez</option><option>Eli Thompson</option><option>Nora Patel</option></select></div>
          <div className="student-summary"><Avatar initials="MR"/><div><strong>Maya Rodriguez</strong><span>Informative · Junior</span></div><Badge tone="success" icon="growth">+18% growth</Badge></div>
          <div className="chart"><div className="chart-y"><span>5</span><span>4</span><span>3</span><span>2</span></div><svg viewBox="0 0 580 170" preserveAspectRatio="none"><defs><linearGradient id="coach-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--indigo)" stopOpacity=".22"/><stop offset="100%" stopColor="var(--indigo)" stopOpacity="0"/></linearGradient></defs><path className="gridline" d="M0 20H580M0 65H580M0 110H580M0 155H580"/><path className="area coach-area" d="M15 130C75 125 105 115 145 100S220 108 280 78 370 66 425 48 520 36 565 24V170H15Z"/><path className="line" d="M15 130C75 125 105 115 145 100S220 108 280 78 370 66 425 48 520 36 565 24"/>{[[15,130],[145,100],[280,78],[425,48],[565,24]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="5"/>)}</svg></div>
          <div className="chart-labels"><span>Lincoln East</span><span>Norfolk</span><span>Millard W.</span><span>Gothenburg</span><span>Creighton</span></div>
        </section>
        <aside className="panel focus-panel"><div className="panel-head"><div><h2>Coaching opportunity</h2><p>Suggested from ballot trends</p></div><Icon name="sparkle"/></div><div className="focus-content"><span className="state-icon"><Icon name="growth"/></span><blockquote>Maya’s content scores are rising quickly. Delivery is now the clearest opportunity for targeted practice.</blockquote><div className="focus-tags"><Badge tone="success" icon="check">Content: 4.7</Badge><Badge tone="pink" icon="growth">Delivery: 3.8</Badge></div><Button icon="plus" onClick={() => { setSelectedStudent('Maya Rodriguez'); setView('student'); }}>Create practice goal</Button></div></aside>
      </div> : <section className="panel archive-panel coach-archive"><div className="panel-head"><div><h2>Ballot review</h2><p>Search feedback, resolve flags, and export team records.</p></div><Button icon="download" variant="secondary" onClick={() => downloadText('orator-ballots.csv','Student,Judge,Event,Rank\nMaya Rodriguez,Judge Leather,Informative,1')}>Export</Button></div>
        <div className="archive-tools"><label className="search-box"><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search student, judge, event, or tournament"/></label><select aria-label="Filter by event" onChange={event => setQuery(event.target.value)}><option value="">All events</option>{ballotEvents.slice(0,6).map(event => <option value={event.short} key={event.id}>{event.short}</option>)}</select><select aria-label="Filter by season"><option>This season</option><option>Last season</option><option>All time</option></select></div>
        <div className="archive-table"><div className="archive-head"><span>Student</span><span>Judge</span><span>Event & tournament</span><span>Rank</span><span>Date</span><span/></div>{ballots.map(row => <div className="archive-row" key={row.join()}><span><Avatar initials={row[0].split(' ').map(n=>n[0]).join('')} size="sm"/><strong>{row[0]}</strong></span><span>{row[1]}</span><span><strong>{row[2]}</strong><small>{row[3]}</small></span><Badge tone={row[4]==='1st' ? 'success':'neutral'}>{row[4]}</Badge><span>{row[5]}</span><button className="icon-button" aria-label={`Open ${row[0]} record`} onClick={() => { setSelectedStudent(row[0]); setView('student'); }}><Icon name="arrow"/></button></div>)}</div>
      </section>}
    </div>
  </DesktopShell>;
}

function StudentPage() {
  const [view, setView] = useState<'today' | 'feedback' | 'round' | 'prep'>('today');
  const [prepSection, setPrepSection] = useState('Opening');
  const store = useStore();
  const rankVisible = store.rankRelease === 'after-round';
  const commentsVisible = store.commentRelease === 'after-round';
  const coachNote = store.focusNotes[0];
  const [ready, setReady] = useState(false);
  const prepNotes: Record<string,string> = {
    Opening: 'Pause after the opening story.\n\nMake eye contact before stating the thesis.\n\nSlow down on the Nebraska groundwater statistic.',
    Transitions: 'Name the next section before moving.\n\nTake one full beat between the problem and solution.',
    Evidence: 'Emphasize the date and source for each statistic.\n\nConnect the Ogallala example back to the thesis.',
    Closing: 'Return to the image of the empty well.\n\nHold eye contact on the final sentence.',
  };
  return <DesktopShell active="Overview" title="Good morning, Maya" subtitle="Your rounds, feedback, and progress are ready in one place." persona="student">
    <div className="role-dashboard">
      <section className="role-hero student-hero"><div><Badge tone="info">Round 2 starts in 24 minutes</Badge><h2>Varsity Informative</h2><p>Room 214 · Speak third · Code V42</p><div className="hero-actions"><Button icon="clock" onClick={() => setView('round')}>View round details</Button><Button variant="secondary" icon="file" onClick={() => setView('prep')}>Open prep notes</Button></div></div><div className="hero-stat"><span>Season average</span><strong>4.3</strong><small>out of 5 · up 0.6</small></div></section>
      <div className="metric-grid"><Metric label="Next round" value="9:30" note="Room 214" icon="clock"/><Metric label="Current rank" value={rankVisible ? '2nd' : 'Hidden'} note={rankVisible ? 'After Round 1' : `Shown ${releaseLabels[store.rankRelease].short}`} icon={rankVisible ? 'growth' : 'lock'}/><Metric label="Feedback" value={commentsVisible ? '18' : '94'} note={commentsVisible ? 'New comments today' : 'From past tournaments'} icon="comment"/><Metric label="Season finals" value="6" note="Across 8 tournaments" icon="sparkle"/></div>
      <div className="role-tabs"><button className={view === 'today' || view === 'round' || view === 'prep' ? 'active' : ''} onClick={() => setView('today')}>Today’s schedule</button><button className={view === 'feedback' ? 'active' : ''} onClick={() => setView('feedback')}>Recent feedback</button></div>
      {view === 'today' ? <div className="role-grid">
        <section className="panel role-panel"><div className="panel-head"><div><h2>Today’s rounds</h2><p>Gothenburg Invitational · Varsity Informative</p></div><Badge tone="success" icon="check">Checked in</Badge></div>
          <div className="timeline-list">{[['8:00 AM','Round 1','Room 108','Completed'],['9:30 AM','Round 2','Room 214','Up next'],['11:00 AM','Round 3','Room 301','Scheduled'],['1:30 PM','Round 4','Room 122','Scheduled']].map(([time,round,room,status],i)=><div className={`timeline-row ${i===1?'current':''}`} key={round}><span className="timeline-dot">{i<1?<Icon name="check" size={14}/>:i+1}</span><span><small>{time}</small><strong>{round}</strong></span><span>{room}</span><Badge tone={i===0?'success':i===1?'info':'neutral'}>{status}</Badge></div>)}</div>
        </section>
        <aside className="panel focus-panel"><div className="panel-head"><div><h2>Coach focus</h2><p>From Erin · {coachNote.sent}</p></div><Avatar initials="EJ" size="sm"/></div><div className="focus-content">{coachNote.urgent ? <Badge tone="danger" icon="bell">Urgent from your coach</Badge> : <span className="state-icon"><Icon name="sparkle"/></span>}<blockquote>“{coachNote.text}”</blockquote><Button variant="secondary" icon="check" disabled={coachNote.seen} onClick={() => store.markNoteSeen(coachNote.id)}>{coachNote.seen ? 'Reviewed · Erin can see this' : 'Mark as reviewed'}</Button></div><div className="focus-checklist"><PracticeChecklist/></div></aside>
      </div> : view === 'round' ? <section className="panel action-workspace round-detail"><div className="panel-head"><div><h2>Round 2 details</h2><p>Varsity Informative · Starts at 9:30 AM</p></div><Button variant="secondary" icon="arrow" onClick={() => setView('today')}>Back to schedule</Button></div><div className="round-detail-grid"><div><span><Icon name="clock"/></span><small>Start time</small><strong>9:30 AM</strong><p>Arrive by 9:20 AM</p></div><div><span><Icon name="home"/></span><small>Location</small><strong>Room 214</strong><p>Second floor, east wing</p></div><div><span><Icon name="users"/></span><small>Speaking order</small><strong>Third of six</strong><p>Code V42</p></div><div><span><Icon name="ballot"/></span><small>Event</small><strong>Informative</strong><p>10-minute time limit</p></div></div><div className="round-callout"><Icon name="info"/><span><strong>{ready ? 'You’re checked in and ready.' : 'Check in with your judge when you arrive.'}</strong><small>Your visual aids are already marked as approved.</small></span><Button icon="check" disabled={ready} onClick={() => setReady(true)}>{ready ? 'Ready' : 'I’m ready'}</Button></div><ReminderSettings/>
      </section> : view === 'prep' ? <section className="panel action-workspace prep-notes"><div className="panel-head"><div><h2>Prep notes</h2><p>Private notes for “When the well runs dry”</p></div><Button variant="secondary" icon="close" onClick={() => setView('today')}>Close notes</Button></div><div className="prep-layout"><aside><Badge tone="success" icon="check">Saved</Badge><h3>Round 2 focus</h3><p>Use these reminders during your final preparation.</p>{['Opening','Transitions','Evidence','Closing'].map((item,index) => <button className={prepSection===item?'active':''} key={item} onClick={() => setPrepSection(item)}><span>{index+1}</span>{item}</button>)}</aside><div><label className="field-label"><span>{prepSection} reminders</span><small>Autosaved just now</small></label><textarea key={prepSection} defaultValue={prepNotes[prepSection]}/><div className="prep-footer"><Badge tone="info" icon="lock">Only you and Coach Erin can see this</Badge><Button icon="check" onClick={() => setView('today')}>Done</Button></div></div></div>
      </section> : <section className="panel feedback-desktop"><div className="panel-head"><div><h2>Feedback library</h2><p>Actionable notes from your latest ballots</p></div><Button variant="secondary" icon="download" onClick={() => downloadText('maya-feedback.txt','Orator feedback for Maya Rodriguez\nDelivery: Strong pacing and confidence.\nOrganization: Clarify the transition into point two.')}>Download all</Button></div>
        {!commentsVisible && <div className="held-banner"><Icon name="lock"/><span><strong>Today’s ballots are shown {releaseLabels[store.commentRelease].short}</strong><small>Set by the tournament director so you can stay focused between rounds. Your coach can still send you focus notes. Feedback below is from earlier tournaments.</small></span></div>}
        <div className="feedback-columns">{[['Delivery','Your pacing felt confident and natural through the evidence section.','Judge Leather','success'],['Organization','Make the transition into point two more explicit for the audience.','Maria Chen','pink'],['Content','Excellent specificity in the water policy examples.','David Ross','success']].map(([title,text,judge,tone])=><article key={title}><Badge tone={tone as 'success'|'pink'} icon={tone==='success'?'check':'growth'}>{tone==='success'?'Strength':'Coaching note'}</Badge><h3>{title}</h3><p>{text}</p><small>{judge} · {commentsVisible ? 'Gothenburg Invitational · today' : 'Norfolk Invitational · Oct 5'}</small></article>)}</div>
      </section>}
    </div>
  </DesktopShell>;
}

function JudgePage() {
  const [action, setAction] = useState<'assignments' | 'ballots' | 'preferences' | 'mobileBallot' | 'competitors'>('assignments');
  const [judgeEvents, setJudgeEvents] = useState(prefEvents);
  const [draggedPreference, setDraggedPreference] = useState<number | null>(null);
  const [preferencesSaved, setPreferencesSaved] = useState(true);
  return <DesktopShell active="Overview" title="Welcome back, Judge Leather" subtitle="Your assignments and ballots are ready for today." persona="judge">
    <div className="role-dashboard">
      <section className="role-hero judge-hero"><div><Badge tone="success" icon="check">Checked in</Badge><h2>Your next panel is ready</h2><p>Round 2 · Varsity Informative · Room 214 · 9:30 AM</p><div className="hero-actions"><Button icon="ballot" onClick={() => setAction('mobileBallot')}>Open e-ballot</Button><Button variant="secondary" icon="file" onClick={() => setAction('competitors')}>View competitors</Button></div></div><div className="hero-stat"><span>Starts in</span><strong>24m</strong><small>Walk time: 4 minutes</small></div></section>
      <div className="metric-grid"><Metric label="Assignments" value="4" note="Today" icon="clock"/><Metric label="Submitted" value="6" note="All on time" icon="check"/><Metric label="Drafts" value="2" note="Autosaved" icon="edit"/><Metric label="Top preference" value="INFO" note="Strong event fit" icon="sparkle"/></div>
      <div className="role-tabs" aria-label="Judge workspace sections"><button className={action === 'assignments' || action === 'competitors' ? 'active' : ''} onClick={() => setAction('assignments')}>Assignments</button><button className={action === 'ballots' || action === 'mobileBallot' ? 'active' : ''} onClick={() => setAction('ballots')}>Ballot desk</button><button className={action === 'preferences' ? 'active' : ''} onClick={() => setAction('preferences')}>Preferences</button></div>
      {action === 'assignments' ? <div className="role-grid">
        <section className="panel role-panel"><div className="panel-head"><div><h2>Today’s assignments</h2><p>Preferences and conflicts already checked</p></div><Badge tone="success" icon="check">Great fit</Badge></div>
          <div className="assignment-desktop">{[['8:00 AM','Round 1','Informative','Room 108','Complete'],['9:30 AM','Round 2','Informative','Room 214','Open ballot'],['11:00 AM','Round 3','Extemp','Room 301','Upcoming'],['1:30 PM','Round 4','Oratory','Room 122','Upcoming']].map(([time,round,event,room,status],i)=><button key={round} className={i===1?'featured':''} onClick={() => i===1 && setAction('mobileBallot')}><span className="event-code">{event.slice(0,4).toUpperCase()}</span><span><strong>{round} · {event}</strong><small>{time} · {room}</small></span><Badge tone={i===0?'success':i===1?'info':'neutral'}>{status}</Badge><Icon name="arrow"/></button>)}</div>
        </section>
        <aside className="panel judge-note"><div className="panel-head"><div><h2>Before you judge</h2><p>A quick Round 2 checklist</p></div></div>{[['wifi','Offline backup is ready'],['users','No school conflicts found'],['ballot','Criteria updated for INFO'],['check','Judge philosophy shared']].map(([icon,text])=><div key={text}><span><Icon name={icon as IconName}/></span><strong>{text}</strong><Icon name="check" size={16}/></div>)}</aside>
      </div> : action === 'competitors' ? <section className="panel competitor-panel"><div className="panel-head"><div><h2>Round 2 competitors</h2><p>Varsity Informative · Speaking order · Room 214 · Check speakers in as they arrive</p></div><Button variant="secondary" icon="arrow" onClick={() => setAction('assignments')}>Back to assignments</Button></div>
        <div className="competitor-roster">{[
          ['C1','Nora Patel','Lincoln East','“Small acts, lasting change”'],
          ['C2','Eli Thompson','Millard West','“The attention economy”'],
          ['C3','Sam Wilson','Norfolk High','“Beyond the final bell”'],
          ['C4','Maya Rodriguez','Lincoln High','“When the well runs dry”'],
          ['C5','Iris Chen','Gothenburg High','“Designed to disappear”'],
          ['C6','Leo Brooks','Creighton Prep','“The quiet infrastructure”'],
        ].map(([code,name,school,title],index) => <article key={code}><span className="speaker-order">{index + 1}</span><Avatar initials={name.split(' ').map(part => part[0]).join('')} size="sm"/><span><strong>{name}</strong><small>{code} · {school}</small></span><span className="speech-title">{title}</span><SpeakerCheckIn code={code} compact/></article>)}</div>
      </section> : action === 'ballots' ? <section className="panel ballot-desk"><div className="panel-head"><div><h2>Round 2 ballot desk</h2><p>Varsity Informative · 6 competitors · Room 214</p></div><Badge tone="warning" icon="edit">2 drafts</Badge></div>
        <div className="ballot-desk-grid">{['C1','C2','C3','C4','C5','C6'].map((code,i)=><article key={code}><div><span className={`status-dot ${i<3?'complete':''}`}/><Badge tone={i<3?'success':i<5?'warning':'danger'}>{i<3?'Submitted':i<5?'Draft':'Missing'}</Badge></div><strong>{code}</strong><p>{['Nora Patel','Eli Thompson','Sam Wilson','Maya Rodriguez','Iris Chen','Leo Brooks'][i]}</p><Button variant={i<3?'secondary':'primary'} icon={i<3?'archive':'edit'} onClick={() => setAction('mobileBallot')}>{i<3?'View ballot':'Continue ballot'}</Button></article>)}</div>
      </section> : action === 'preferences' ? <section className="panel embedded-preferences"><div className="panel-head"><div><h2>Event preferences</h2><p>Drag events to rank where you feel most confident judging.</p></div><Badge tone="success" icon="check">Preferences complete</Badge></div>
        <div className="preference-note"><Icon name="drag"/><span>Your preferences help the director build stronger panels and avoid poor event matches.</span></div>
        <div className="embedded-pref-grid">{(['top','willing','avoid'] as const).map(level => <div className={`pref-group ${level}`} key={level}>
          <div className="pref-label"><span>{level === 'top' ? 'Top choices' : level === 'willing' ? 'Willing to judge' : 'Prefer to avoid'}</span><Badge tone={level === 'top' ? 'success' : level === 'avoid' ? 'pink' : 'neutral'}>{judgeEvents.filter(event => event.level === level).length}</Badge></div>
          {judgeEvents.map((event,index) => event.level === level && <div className="event-row" key={event.code} draggable onDragStart={() => setDraggedPreference(index)} onDragOver={e => e.preventDefault()} onDrop={() => {
            if (draggedPreference === null || draggedPreference === index) return;
            const copy = [...judgeEvents]; const [item] = copy.splice(draggedPreference, 1); copy.splice(index, 0, item); setJudgeEvents(copy); setDraggedPreference(null); setPreferencesSaved(false);
          }}><Icon name="drag"/><span className="event-code">{event.code}</span><span><strong>{event.name}</strong><small>{level === 'avoid' ? 'Low confidence' : level === 'top' ? 'Highly experienced' : 'Comfortable'}</small></span><Badge tone={level === 'top' ? 'success' : level === 'avoid' ? 'pink' : 'neutral'}>{level === 'top' ? 'Top' : level === 'avoid' ? 'Avoid' : 'Willing'}</Badge></div>)}
        </div>)}</div>
        <div className="preference-save"><span><Icon name={preferencesSaved ? 'check' : 'clock'}/> {preferencesSaved ? 'All preferences saved' : 'Unsaved changes'}</span><Button icon="check" disabled={preferencesSaved} onClick={() => setPreferencesSaved(true)}>{preferencesSaved ? 'Saved' : 'Save preferences'}</Button></div>
      </section> : <section className="embedded-ballot"><div className="embedded-ballot-head"><div><span className="eyebrow">JUDGE WORKSPACE</span><h2>Edit Round 2 ballot</h2><p>Changes autosave to your ballot desk.</p></div><Button variant="secondary" icon="arrow" onClick={() => setAction('ballots')}>Back to ballot desk</Button></div><BallotPage/></section>}
    </div>
  </DesktopShell>;
}

function Metric({label,value,note,icon}:{label:string;value:string;note:string;icon:IconName}) {
  return <div className="metric"><span className="metric-icon"><Icon name={icon}/></span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></div>;
}

function ComponentsPage() {
  const [demoAction, setDemoAction] = useState('Select a component to preview its interaction.');
  return <div className="docs-page"><DocsHeader title="Components" subtitle="Reusable patterns for Orator’s tournament experiences."/>
    <section className="doc-section"><h2>Buttons</h2><div className="component-row"><Button onClick={() => setDemoAction('Primary action selected')}>Primary action</Button><Button variant="secondary" onClick={() => setDemoAction('Secondary action selected')}>Secondary</Button><Button variant="ghost" icon="edit" onClick={() => setDemoAction('Edit action selected')}>Ghost</Button><Button variant="danger" onClick={() => setDemoAction('Destructive action selected')}>Destructive</Button><Button disabled>Disabled</Button><Badge tone="info" icon="info">{demoAction}</Badge></div></section>
    <section className="doc-section"><h2>Status badges</h2><div className="component-row"><Badge tone="success" icon="check">Submitted</Badge><Badge tone="warning" icon="clock">Draft</Badge><Badge tone="danger" icon="warning">Missing</Badge><Badge tone="pink" icon="growth">Coaching note</Badge><Badge tone="info">Round 2</Badge></div></section>
    <section className="doc-section"><h2>Inputs and scoring</h2><div className="component-grid"><div><label className="field-label"><span>Student search</span></label><label className="search-box"><Icon name="search"/><input placeholder="Search by name or code"/></label></div><div><label className="field-label"><span>Rating</span><small>Selected: 4</small></label><Rating value={4} setValue={()=>{}}/></div></div></section>
    <section className="doc-section"><h2>Feedback and alerts</h2><div className="component-grid"><div className="alert-strip warning"><span><Icon name="warning"/></span><div><strong>Action needed</strong><p>Two ballots are missing required comments.</p></div></div><div className="offline-note"><Icon name="wifi"/><span><strong>Saved offline</strong> Changes will sync automatically.</span></div></div></section>
  </div>;
}

function StylesPage() {
  const colors = [['Primary','Indigo'],['Success','Green'],['Constructive','Pink'],['Warning','Amber'],['Surface','Warm white'],['Text','Ink']];
  return <div className="docs-page"><DocsHeader title="Styles" subtitle="Warm, legible foundations designed for high-pressure tournament days."/>
    <section className="doc-section"><h2>Color tokens</h2><div className="swatches">{colors.map(([name,value],i)=><div className={`swatch swatch-${i}`} key={name}><span/><strong>{name}</strong><small>{value}</small></div>)}</div></section>
    <section className="doc-section"><h2>Typography</h2><div className="type-specimens"><div><small>DISPLAY / INTER SEMIBOLD</small><strong className="display-type">Feedback that moves students forward.</strong></div><div><small>HEADING / INTER SEMIBOLD</small><strong className="heading-type">Varsity Informative</strong></div><div><small>BODY / INTER REGULAR</small><p>Clear prompts help judges give specific, actionable feedback even when time and Wi-Fi are limited.</p></div></div></section>
    <section className="doc-section"><h2>Spacing, radius & accessibility</h2><div className="style-cards"><div><span className="radius-demo"/><strong>12–20 radius</strong><small>Friendly, not playful</small></div><div><span className="tap-demo">44</span><strong>44 minimum target</strong><small>Reliable mobile tapping</small></div><div><span className="contrast-demo">Aa</span><strong>WCAG AA</strong><small>4.5:1 body contrast</small></div></div></section>
  </div>;
}

function StatesPage() {
  const navigate = useContext(NavigationContext);
  const [retrying, setRetrying] = useState(false);
  return <div className="docs-page"><DocsHeader title="System states" subtitle="Resilient patterns for weak Wi‑Fi and busy tournament workflows."/>
    <div className="states-grid">
      <section className="state-card"><Badge tone="warning" icon="wifi">Offline</Badge><span className="state-icon amber"><Icon name="wifi" size={28}/></span><h2>You’re working offline</h2><p>Your ballot is safe on this device. We’ll sync it when you reconnect.</p><Button variant="secondary" onClick={() => navigate('judge')}>Keep judging</Button></section>
      <section className="state-card"><Badge tone={retrying ? 'success' : 'danger'} icon={retrying ? 'check' : 'warning'}>{retrying ? 'Reconnected' : 'Error'}</Badge><span className="state-icon red"><Icon name={retrying ? 'check' : 'warning'} size={28}/></span><h2>{retrying ? 'Upload resumed' : 'Upload paused'}</h2><p>{retrying ? 'Your saved scan is uploading now.' : 'We couldn’t reach the server. Your scan is saved and ready to retry.'}</p><Button disabled={retrying} onClick={() => setRetrying(true)}>{retrying ? 'Uploading' : 'Try again'}</Button></section>
      <section className="state-card"><Badge tone="neutral">Empty</Badge><span className="state-icon"><Icon name="archive" size={28}/></span><h2>No ballots yet</h2><p>Submitted ballots will appear here after your first tournament round.</p><Button variant="secondary" onClick={() => navigate('student')}>View schedule</Button></section>
      <section className="state-card"><Badge tone="info">Loading</Badge><div className="skeleton-state"><i/><i/><i/><i/></div><h2>Loading assignments</h2><p>Finding the best event fit for each judge.</p><Progress value={62}/></section>
    </div>
  </div>;
}

function DocsHeader({title,subtitle}:{title:string;subtitle:string}) {
  return <header className="docs-header"><Logo/><div><span className="eyebrow">ORATOR DESIGN SYSTEM</span><h1>{title}</h1><p>{subtitle}</p></div></header>;
}

function Workspace() {
  const { loading, profile, recovering } = useAuth();
  const [page, setPage] = useState<Page>('auth');
  const [dark, setDark] = useState(false);
  const signedIn = authConfigured && profile !== null && !recovering;
  // Signed-in users land on their workspace, or the role chooser if they have several, and can only open their own roles.
  const allowed = (target: Page) => !signedIn || target === 'signin' || profile!.roles.includes(target as Role);
  const home: Page = signedIn ? (profile!.roles.length === 1 ? profile!.roles[0] : 'signin') : 'auth';
  const current = signedIn && (page === 'auth' || !allowed(page)) ? home : page;
  const navigate = (target: Page) => setPage(allowed(target) ? target : home);
  const content = useMemo(() => ({
    auth: <AuthPage onDemo={authConfigured ? undefined : () => setPage('signin')}/>,
    signin: <SignInPage/>,
    student: <StudentPage/>, judge: <JudgePage/>, coach: <CoachPage/>,
    director: <DirectorPage/>,
    components: <ComponentsPage/>, styles: <StylesPage/>, states: <StatesPage/>
  })[current], [current]);
  if (authConfigured && loading) return <div className="app auth-loading"><span className="spinner"/><p>Loading Orator…</p></div>;
  if (authConfigured && !signedIn) return <div className={dark ? 'app dark' : 'app'}><AuthPage/></div>;
  return <NavigationContext.Provider value={navigate}><div className={dark ? 'app dark' : 'app'}>{signedIn ? <AccountNav page={current} setPage={navigate} dark={dark} setDark={setDark}/> : <PrototypeNav page={current} setPage={navigate} dark={dark} setDark={setDark}/>}{content}</div></NavigationContext.Provider>;
}

export default function App() {
  return <AuthProvider><StoreProvider><Workspace/></StoreProvider></AuthProvider>;
}
