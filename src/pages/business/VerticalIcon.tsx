import { VerticalKey } from './shared'

// The exact stroke icons used in the design mockup, as inline SVGs so they
// match pixel-for-pixel (lucide-react has close-but-not-identical variants).
export default function VerticalIcon({ vertical, size = 28 }: { vertical: VerticalKey; size?: number }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style: { width: size, height: size },
  }
  switch (vertical) {
    case 'doctors':
      return <svg {...common}><path d="M6 3v5a4 4 0 0 0 8 0V3" /><path d="M10 15a5 5 0 0 0 5 5 4 4 0 0 0 4-4v-2" /><circle cx="19" cy="10" r="2" /></svg>
    case 'hospital':
      return <svg {...common}><path d="M4 21V7l8-4 8 4v14" /><path d="M9 21v-4h6v4" /><path d="M12 8v4M10 10h4" /></svg>
    case 'pharmacy':
      return <svg {...common}><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z" /><path d="m8 8 8 8" /></svg>
    case 'lab':
      return <svg {...common}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /><path d="M7.5 14h9" /></svg>
    case 'insurance':
      return <svg {...common}><path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="M12 8v6M9 11h6" /></svg>
    case 'ambulance':
      return <svg {...common}><path d="M3 8h10v7H3z" /><path d="M13 11h4l3 3v1h-7z" /><circle cx="7" cy="17" r="1.8" /><circle cx="17" cy="17" r="1.8" /><path d="M6.5 10v2M5 11h3" /></svg>
  }
}
