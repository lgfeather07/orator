import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import { Badge, Button, Icon, Logo, type IconName } from './ui';

export type Role = 'student' | 'judge' | 'coach' | 'director';
export const allRoles: Role[] = ['student', 'judge', 'coach', 'director'];

export type Profile = { name: string; email: string; school: string; roles: Role[]; initials: string };

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null until a Supabase project is configured in .env.local; the app then runs as a demo without accounts. */
export const supabase = url && key ? createClient(url, key) : null;
export const authConfigured = supabase !== null;

type AuthState = {
  loading: boolean;
  profile: Profile | null;
  /** True after the user follows a password-reset email, until they choose a new password. */
  recovering: boolean;
  finishRecovery: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({ loading: false, profile: null, recovering: false, finishRecovery: () => undefined, signOut: async () => undefined });
export const useAuth = () => useContext(AuthContext);

const cleanRoles = (value: unknown): Role[] => Array.isArray(value) ? allRoles.filter(role => value.includes(role)) : [];
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';

async function loadProfile(session: Session): Promise<Profile> {
  const user = session.user;
  const meta = user.user_metadata ?? {};
  let name: string = meta.full_name || user.email?.split('@')[0] || 'Orator user';
  let school: string = meta.school || '';
  let roles = cleanRoles(meta.roles);
  // The profiles table is the source of truth once supabase/schema.sql has been run.
  const { data } = await supabase!.from('profiles').select('full_name, school, roles').eq('id', user.id).maybeSingle();
  if (data) { name = data.full_name || name; school = data.school ?? school; roles = cleanRoles(data.roles); }
  return { name, email: user.email ?? '', school, roles: roles.length ? roles : ['student'], initials: initialsOf(name) };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(authConfigured);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const apply = async (session: Session | null) => {
      const next = session ? await loadProfile(session).catch(() => null) : null;
      if (active) { setProfile(next); setLoading(false); }
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      // Defer so we never call back into Supabase from inside its own auth callback.
      setTimeout(() => apply(session), 0);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  const signOut = async () => { await supabase?.auth.signOut(); setProfile(null); };
  return <AuthContext.Provider value={{ loading, profile, recovering, finishRecovery: () => setRecovering(false), signOut }}>{children}</AuthContext.Provider>;
}

const roleCards: { id: Role; icon: IconName; title: string; description: string }[] = [
  { id: 'student', icon: 'growth', title: 'Student', description: 'I compete' },
  { id: 'judge', icon: 'ballot', title: 'Judge', description: 'I judge rounds' },
  { id: 'coach', icon: 'users', title: 'Coach', description: 'I coach a team' },
  { id: 'director', icon: 'settings', title: 'Director', description: 'I run tournaments' },
];

const friendly = (message: string) => {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account. Check them and try again.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first. Open the link we sent you, then sign in.';
  if (/already registered|already been registered/i.test(message)) return 'An account with that email already exists. Sign in instead.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  if (/failed to fetch|network/i.test(message)) return 'We couldn’t reach the server. Check your connection and try again.';
  return message;
};

type Mode = 'signin' | 'signup' | 'forgot' | 'sent-confirm' | 'sent-reset' | 'reset';

export function AuthPage({ onDemo }: { onDemo?: () => void }) {
  const { recovering, finishRecovery } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [school, setSchool] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current: Mode = recovering ? 'reset' : mode;
  const go = (next: Mode) => { setMode(next); setError(''); setPassword(''); };
  const toggleRole = (role: Role) => setRoles(list => list.includes(role) ? list.filter(item => item !== role) : [...list, role]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!supabase) { setError('Accounts aren’t connected yet. This is the demo, so use “Explore the demo” below.'); return; }
    if (current === 'signup' && roles.length === 0) { setError('Choose at least one role.'); return; }
    if ((current === 'signup' || current === 'reset') && password.length < 8) { setError('Use a password with at least 8 characters.'); return; }
    setBusy(true);
    try {
      if (current === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (current === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin, data: { full_name: name.trim(), school: school.trim(), roles } } });
        if (error) throw error;
        if (!data.session) go('sent-confirm');
      } else if (current === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        go('sent-reset');
      } else if (current === 'reset') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        finishRecovery();
      }
    } catch (caught) {
      setError(friendly(caught instanceof Error ? caught.message : 'Something went wrong. Try again.'));
    } finally { setBusy(false); }
  };

  const titles: Record<Mode, [string, string]> = {
    signin: ['Sign in to Orator', 'One account for every tournament role.'],
    signup: ['Create your account', 'Students, judges, coaches, and directors all start here.'],
    forgot: ['Reset your password', 'Enter your email and we’ll send you a reset link.'],
    'sent-confirm': ['Check your email', `We sent a confirmation link to ${email}. Open it to finish creating your account.`],
    'sent-reset': ['Check your email', `If ${email} has an account, a reset link is on its way.`],
    reset: ['Choose a new password', 'You’ll stay signed in after saving it.'],
  };
  const passwordField = (label: string, autoComplete: string) => <label className="auth-field"><span>{label}</span><div className="auth-password"><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={autoComplete} required/><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}><Icon name="eye" size={16}/>{showPassword ? 'Hide' : 'Show'}</button></div></label>;

  return <div className="signin-page auth-page">
    <header className="signin-header"><Logo/>{!authConfigured && <div><Badge tone="warning" icon="info">Demo mode · accounts not connected</Badge></div>}</header>
    <main className="auth-main">
      <aside className="auth-pitch">
        <span className="eyebrow">Speech tournament software</span>
        <h2>Every round, every ballot, <em>one place.</em></h2>
        <p>Orator runs the tournament day for students, judges, coaches, and directors, on the official NSAA ballot.</p>
        <ul>
          <li><b>01</b><span>E-ballots with criteria, timing, and ranking built in</span></li>
          <li><b>02</b><span>Check-in for judges and speakers, live for the tab room</span></li>
          <li><b>03</b><span>Feedback and growth that follow each student all season</span></li>
        </ul>
      </aside>
      <section className="auth-card">
        <h1>{titles[current][0]}</h1><p className="auth-lead">{titles[current][1]}</p>
        {current === 'sent-confirm' || current === 'sent-reset' ? <div className="auth-sent"><span className="success-icon"><Icon name="check" size={26}/></span><p>Didn’t get it? Check your spam folder, or go back and try again.</p><Button variant="secondary" onClick={() => go('signin')}>Back to sign in</Button></div> : <form onSubmit={submit} noValidate={false}>
          {current === 'signup' && <>
            <label className="auth-field"><span>Full name</span><input value={name} onChange={event => setName(event.target.value)} autoComplete="name" required/></label>
            <label className="auth-field"><span>School or organization <small>Optional</small></span><input value={school} onChange={event => setSchool(event.target.value)} autoComplete="organization"/></label>
            <fieldset className="auth-roles"><legend>How will you use Orator? <small>Choose all that apply</small></legend>{roleCards.map(role => <label key={role.id} className={roles.includes(role.id) ? 'on' : ''}><input type="checkbox" checked={roles.includes(role.id)} onChange={() => toggleRole(role.id)}/><Icon name={role.icon} size={18}/><span><strong>{role.title}</strong><small>{role.description}</small></span></label>)}</fieldset>
          </>}
          {current !== 'reset' && <label className="auth-field"><span>Email</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required/></label>}
          {current === 'signin' && passwordField('Password', 'current-password')}
          {current === 'signup' && passwordField('Password · at least 8 characters', 'new-password')}
          {current === 'reset' && passwordField('New password · at least 8 characters', 'new-password')}
          {error && <p className="auth-error" role="alert"><Icon name="warning" size={15}/> {error}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? 'One moment…' : current === 'signin' ? 'Sign in' : current === 'signup' ? 'Create account' : current === 'forgot' ? 'Send reset link' : 'Save new password'}</button>
          {current === 'signin' && <div className="auth-links"><button type="button" onClick={() => go('forgot')}>Forgot password?</button><button type="button" onClick={() => go('signup')}>Create an account</button></div>}
          {current === 'signup' && <div className="auth-links"><span>Already have an account?</span><button type="button" onClick={() => go('signin')}>Sign in</button></div>}
          {current === 'forgot' && <div className="auth-links"><button type="button" onClick={() => go('signin')}>Back to sign in</button></div>}
        </form>}
      </section>
      {onDemo && <button className="auth-demo" onClick={onDemo}><Icon name="sparkle" size={16}/><span><strong>Explore the demo</strong><small>Look around every role with sample data. No account needed.</small></span><Icon name="arrow" size={16}/></button>}
      <p className="signin-security"><Icon name="lock" size={14}/> Your school and tournament permissions determine what you can access.</p>
    </main>
  </div>;
}
