import { listingStatus, appointmentStatus, paymentStatus } from '../lib/status'

// One pill for every status in the product.
//
// `kind` picks the vocabulary, because the same word means different things:
// "pending" on a listing is waiting for us to verify it, "pending" on an
// appointment is waiting for the patient to turn up, and "pending" on a payment
// is money in flight. They deserve the same shape and not necessarily the same
// colour.

type Kind = 'listing' | 'appointment' | 'payment'

const LOOKUP = {
  listing: listingStatus,
  appointment: appointmentStatus,
  payment: paymentStatus,
} as const

export default function StatusBadge(
  { kind, value }: { kind: Kind; value: string | null | undefined },
) {
  const { label, className } = LOOKUP[kind](value)
  return <span className={className}>{label}</span>
}
