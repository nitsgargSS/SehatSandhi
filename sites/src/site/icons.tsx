// Line icons from the design, drawn inline so they take the text colour.
// All are decorative (aria-hidden); the text beside them carries the meaning.

type P = { size?: number; color?: string };
const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

export const Clock = ({ size = 20 }: P) => (<svg {...base(size)}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>);
export const Calendar = ({ size = 22 }: P) => (<svg {...base(size)}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>);
export const Whatsapp = ({ size = 22 }: P) => (<svg {...base(size)}><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.5A8.4 8.4 0 1 1 21 11.5z" /></svg>);
export const Phone = ({ size = 20 }: P) => (<svg {...base(size)}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>);
export const Eye = ({ size = 18 }: P) => (<svg {...base(size)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>);
export const User = ({ size = 20 }: P) => (<svg {...base(size)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>);
export const Pin = ({ size = 22 }: P) => (<svg {...base(size)}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>);
export const Arrow = ({ size = 22 }: P) => (<svg {...base(size)} stroke="var(--brand)"><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
export const Check = ({ size = 22, color = 'var(--accent)' }: P) => (<svg {...base(size)} stroke={color} strokeWidth={2.5} className="tick"><path d="M20 6 9 17l-5-5" /></svg>);
export const Plus = ({ size = 24 }: P) => (<svg {...base(size)} stroke="var(--brand)" strokeWidth={2.4} style={{ flex: 'none' }}><path d="M12 5v14M5 12h14" /></svg>);
export const MenuIcon = ({ size = 24 }: P) => (<svg {...base(size)} strokeWidth={2.4}><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
export const Back = ({ size = 24 }: P) => (<svg {...base(size)} strokeWidth={2.4}><path d="M15 6l-6 6 6 6" /></svg>);
export const Warn = ({ size = 30 }: P) => (<svg {...base(size)} stroke="var(--danger)" strokeWidth={2.2} style={{ flex: 'none', marginTop: 2 }}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>);
export const Star = ({ size = 22 }: P) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>);
