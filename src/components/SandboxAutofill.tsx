import { useState } from 'react'
import { IS_STAGING } from '../lib/env'

// "Fill this form with valid test data" — sandbox only.
//
// Position is deliberate: fixed bottom-LEFT. The WhatsApp floater occupies
// bottom-right on every page except /business/register, so the right side would
// collide on /doctor and /partner. Magenta matches EnvBanner, so the sandbox
// affordances read as one system and never as part of the real UI.
//
// Fixed rather than inline so it survives step changes in the two wizards and
// stays reachable on the success screen for an immediate second run. It floats
// over the business wizard's dark rail, so it carries its own backdrop and
// contrast rather than relying on whatever sits behind it.
//
// The button only fills. It deliberately does NOT advance the wizard: the step
// gates, the debounced price fetch and the disabled-button logic are part of
// what is being tested, and skipping to the review step would skip exactly the
// code the test exists to exercise.

interface Props {
  /** Apply generated data to the form's own state. */
  onFill: () => void
  /** Optional context, e.g. the vertical the data will be shaped for. */
  hint?: string
}

export default function SandboxAutofill({ onFill, hint }: Props) {
  const [filled, setFilled] = useState(false)
  if (!IS_STAGING) return null

  const handle = () => {
    onFill()
    setFilled(true)
    // Brief confirmation, then back to the idle label so repeat fills are
    // obviously available.
    window.setTimeout(() => setFilled(false), 1400)
  }

  return (
    <button
      type="button"
      onClick={handle}
      title="Fill every field with valid generated test data"
      style={{
        position: 'fixed',
        bottom: 24,
        left: 24,
        zIndex: 60,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: filled ? '#15803d' : '#a21caf',
        color: '#fff',
        border: 'none',
        borderRadius: 999,
        padding: '12px 18px',
        minHeight: 44,
        fontSize: 14,
        fontWeight: 800,
        fontFamily: "'Manrope',system-ui,sans-serif",
        cursor: 'pointer',
        // Ring + strong shadow so it stays legible sitting on top of the
        // wizard's dark rail rather than blending into whatever is beneath.
        boxShadow: '0 0 0 3px rgba(255,255,255,.9), 0 8px 24px rgba(0,0,0,.3)',
        transition: 'background .2s ease',
      }}
    >
      {filled ? '✓ Filled' : '⚡ Autofill test data'}
      {hint && !filled && (
        <span style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.85 }}>{hint}</span>
      )}
    </button>
  )
}
