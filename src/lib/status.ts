// What a status looks like, decided once.
//
// The same appointment used to render in two different colour systems
// depending on which tab you were on: Today used the badge-* classes
// (teal / red / amber) and Appointments used a Tailwind palette of its own
// (teal / GREY / amber), so a cancelled appointment was red on one screen and
// grey on the next. A doctor scanning for cancellations had to know which tab
// they were on to read the colour.
//
// Listing status was mapped in three places in the admin dashboard alone — once
// as a component, then twice more inlined a few hundred lines below it, each
// bypassing the component above.
//
// Semantic, not decorative: good / warning / bad carry meaning here and are
// deliberately separate from the brand green.

export interface StatusLook {
  label: string
  /** Tailwind classes for a pill. Uses the badge-* classes from index.css. */
  className: string
}

const GOOD = 'badge-active'
const WARN = 'badge-pending'
const BAD = 'badge-suspended'

/** A listing: pending review, live, or taken down. */
export function listingStatus(status: string | null | undefined): StatusLook {
  switch (status) {
    case 'active': return { label: 'active', className: GOOD }
    case 'suspended': return { label: 'suspended', className: BAD }
    case 'pending': return { label: 'pending', className: WARN }
    default: return { label: status || 'unknown', className: WARN }
  }
}

/**
 * An appointment.
 *
 * no_show reads as "no show" — the underscore is a column name, not something
 * to show a doctor. Cancelled is red rather than grey: it is the outcome a
 * clinic most needs to spot in a list, and grey reads as "inactive".
 */
export function appointmentStatus(status: string | null | undefined): StatusLook {
  switch (status) {
    case 'completed': return { label: 'completed', className: GOOD }
    case 'cancelled': return { label: 'cancelled', className: BAD }
    case 'no_show': return { label: 'no show', className: BAD }
    case 'confirmed': return { label: 'confirmed', className: GOOD }
    case 'pending': return { label: 'pending', className: WARN }
    default: return { label: status || 'unknown', className: WARN }
  }
}

/** A payment or invoice. */
export function paymentStatus(status: string | null | undefined): StatusLook {
  switch (status) {
    case 'paid': return { label: 'paid', className: GOOD }
    case 'failed': return { label: 'failed', className: BAD }
    case 'refunded': return { label: 'refunded', className: BAD }
    case 'pending': return { label: 'pending', className: WARN }
    default: return { label: status || 'unknown', className: WARN }
  }
}
