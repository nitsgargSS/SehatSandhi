import { phoneProblem } from '../lib/credentials'

/** The line under a mobile-number box: what is wrong, once something is typed. */
export default function PhoneError({ value, foreign = false, className = 'text-xs text-red-600 mt-1' }: { value: string | null | undefined; foreign?: boolean; className?: string }) {
  const p = (value ?? '').trim() ? phoneProblem(value, true, foreign) : null
  return p ? <p className={className}>{p}</p> : null
}
