import { type ReactNode } from 'react';

export type IconName =
  | 'archive' | 'arrow' | 'ballot' | 'camera' | 'check' | 'chevron' | 'clock'
  | 'close' | 'comment' | 'download' | 'drag' | 'edit' | 'file' | 'growth'
  | 'home' | 'info' | 'lock' | 'menu' | 'moon' | 'plus' | 'search' | 'settings'
  | 'sparkle' | 'sun' | 'upload' | 'users' | 'warning' | 'wifi' | 'bell' | 'eye' | 'send';

const paths: Record<IconName, ReactNode> = {
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  send: <path d="m4 12 16-8-6 16-3-7z"/>,
  archive: <><path d="M4 7h16v13H4z"/><path d="M3 3h18v4H3zM9 11h6"/></>,
  arrow: <path d="m9 18 6-6-6-6"/>,
  ballot: <><path d="M7 3h10a2 2 0 0 1 2 2v16H5V5a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  chevron: <path d="m6 9 6 6 6-6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  comment: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M5 21h14"/></>,
  drag: <><circle cx="9" cy="6" r=".7" fill="currentColor"/><circle cx="15" cy="6" r=".7" fill="currentColor"/><circle cx="9" cy="12" r=".7" fill="currentColor"/><circle cx="15" cy="12" r=".7" fill="currentColor"/><circle cx="9" cy="18" r=".7" fill="currentColor"/><circle cx="15" cy="18" r=".7" fill="currentColor"/></>,
  edit: <><path d="m14 5 5 5L9 20H4v-5z"/><path d="m12 7 5 5"/></>,
  file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
  growth: <><path d="M4 20V5M4 20h17"/><path d="m7 16 4-5 3 2 5-7"/></>,
  home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-2-2.2-2.2-2 .9-1.7-.7-.7-2h-3l-.7 2-1.7.7-2-.9L1 6.1l.9 2-.7 1.7-2 .7v3l2 .7.7 1.7-.9 2 2.2 2.2 2-.9 1.7.7.7 2h3l.7-2 1.7-.7 2 .9 2.2-2.2-.9-2 .7-1.7z"/></>,
  sparkle: <><path d="m12 2 1.2 4.8L18 8l-4.8 1.2L12 14l-1.2-4.8L6 8l4.8-1.2z"/><path d="m18.5 15 .6 2.4 2.4.6-2.4.6-.6 2.4-.6-2.4-2.4-.6 2.4-.6z"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4M5 20h14"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/></>,
  warning: <><path d="M12 3 2 21h20z"/><path d="M12 9v5M12 17h.01"/></>,
  wifi: <><path d="M2 8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r=".8" fill="currentColor"/></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function Button({ children, icon, variant = 'primary', onClick, disabled, className = '' }: {
  children: ReactNode; icon?: IconName; variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  onClick?: () => void; disabled?: boolean; className?: string;
}) {
  return <button className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon}/>}<span>{children}</span></button>;
}

export function Badge({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'pink'; icon?: IconName }) {
  return <span className={`badge badge-${tone}`}>{icon && <Icon name={icon} size={14}/>} {children}</span>;
}

export function Avatar({ initials, size = 'md' }: { initials: string; size?: 'sm' | 'md' }) {
  return <span className={`avatar avatar-${size}`}>{initials}</span>;
}

export function Progress({ value }: { value: number }) {
  return <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }}/></div>;
}

export function Logo() {
  return <div className="logo"><span className="logo-mark"><Icon name="comment" size={19}/></span><strong>Orator</strong></div>;
}
