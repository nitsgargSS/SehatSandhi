import { getEnv, switchEnv, SANDBOX_AVAILABLE } from '../lib/env'

// Toggle between the production and sandbox backends.
//
// Only renders where a sandbox is configured — on a production deployment
// without VITE_SANDBOX_* vars this is nothing at all, so there is no control to
// find and no way to reach a backend that was never built in.
//
// Switching reloads the page (see env.ts): every Supabase client and cached
// query has to be rebuilt against the new project, and a half-swapped client is
// worse than either endpoint.

export default function EnvSwitcher({ compact = false }: { compact?: boolean }) {
  if (!SANDBOX_AVAILABLE) return null

  const env = getEnv()
  const sandbox = env === 'sandbox'

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: '#f3f4f6',
        border: '1px solid #e5e7eb',
        borderRadius: 999,
        padding: 3,
        fontFamily: "'Manrope',system-ui,sans-serif",
      }}
    >
      {(['prod', 'sandbox'] as const).map(target => {
        const active = env === target
        return (
          <button
            key={target}
            onClick={() => !active && switchEnv(target)}
            aria-pressed={active}
            title={target === 'prod' ? 'Production database' : 'Sandbox database — test data and test payments'}
            style={{
              background: active ? (target === 'sandbox' ? '#a21caf' : '#0E9F6E') : 'transparent',
              color: active ? '#fff' : '#6b7280',
              border: 'none',
              borderRadius: 999,
              padding: compact ? '4px 10px' : '5px 14px',
              fontSize: compact ? 11.5 : 12.5,
              fontWeight: 800,
              cursor: active ? 'default' : 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {target === 'prod' ? 'Production' : 'Sandbox'}
          </button>
        )
      })}
      {sandbox && !compact && (
        <span style={{ fontSize: 11, color: '#a21caf', fontWeight: 700, paddingRight: 8 }}>
          test data
        </span>
      )}
    </div>
  )
}
