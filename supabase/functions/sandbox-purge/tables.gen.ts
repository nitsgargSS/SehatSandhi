// GENERATED FILE — do not edit.
//
// Source: supabase/tables.config.yaml
// Regenerate: node scripts/gen-purge-manifest.mjs
//
// Tables classified `isolated` (user-generated, safe to wipe in sandbox), in
// FK-safe delete order. Anything classified sync/view/never_purge is absent by
// construction, so reference data cannot be caught up in a purge.

export interface PurgeTable {
  name: string
  /** Ascending: children before parents. */
  purgeOrder: number
  /** Column used to build the "match every row" filter; PostgREST rejects an unfiltered delete. */
  pk: string
}

export const PURGE_TABLES: PurgeTable[] = [
  { name: 'discount_code_usage', purgeOrder: 10, pk: 'id' },
  { name: 'rating_responses', purgeOrder: 12, pk: 'id' },
  { name: 'review_flags', purgeOrder: 14, pk: 'id' },
  { name: 'ratings', purgeOrder: 20, pk: 'id' },
  { name: 'appointments', purgeOrder: 30, pk: 'id' },
  { name: 'payments', purgeOrder: 40, pk: 'id' },
  { name: 'premium_slots', purgeOrder: 50, pk: 'id' },
  { name: 'subscriptions', purgeOrder: 60, pk: 'id' },
  { name: 'doctor_pricing_overrides', purgeOrder: 70, pk: 'id' },
  { name: 'doctor_availability', purgeOrder: 80, pk: 'id' },
  { name: 'camps_offers', purgeOrder: 90, pk: 'id' },
  { name: 'clinic_users', purgeOrder: 100, pk: 'id' },
  { name: 'org_subscriptions', purgeOrder: 110, pk: 'id' },
  { name: 'org_specialities', purgeOrder: 120, pk: 'id' },
  { name: 'doctors', purgeOrder: 130, pk: 'id' },
  { name: 'organizations', purgeOrder: 140, pk: 'id' },
  { name: 'unmet_demand_log', purgeOrder: 150, pk: 'id' },
  { name: 'patient_visits', purgeOrder: 160, pk: 'id' },
  { name: 'patient_consents', purgeOrder: 170, pk: 'id' },
  { name: 'patient_import_rows', purgeOrder: 180, pk: 'id' },
  { name: 'patient_imports', purgeOrder: 190, pk: 'id' },
  { name: 'message_log', purgeOrder: 200, pk: 'id' },
  { name: 'rewards_redemptions', purgeOrder: 205, pk: 'id' },
  { name: 'sehat_points', purgeOrder: 210, pk: 'id' },
  { name: 'referrals', purgeOrder: 212, pk: 'id' },
  { name: 'patient_profiles', purgeOrder: 218, pk: 'id' },
  { name: 'patients', purgeOrder: 220, pk: 'id' },
  { name: 'wa_session_messages', purgeOrder: 230, pk: 'id' },
  { name: 'wa_sessions', purgeOrder: 240, pk: 'id' },
  { name: 'wa_contacts', purgeOrder: 250, pk: 'phone' },
  { name: 'site_visits', purgeOrder: 255, pk: 'id' },
  { name: 'opt_outs', purgeOrder: 260, pk: 'id' },
]
