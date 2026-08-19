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
  { name: 'business_pricing_overrides', purgeOrder: 70, pk: 'id' },
  { name: 'availability', purgeOrder: 80, pk: 'id' },
  { name: 'camps_offers', purgeOrder: 90, pk: 'id' },
  { name: 'business_practitioners', purgeOrder: 100, pk: 'id' },
  { name: 'practitioners', purgeOrder: 120, pk: 'id' },
  { name: 'insurance_leads', purgeOrder: 125, pk: 'id' },
  { name: 'businesses', purgeOrder: 130, pk: 'id' },
  { name: 'unmet_demand_log', purgeOrder: 150, pk: 'id' },
  { name: 'consultation_recordings', purgeOrder: 152, pk: 'id' },
  { name: 'patient_vitals', purgeOrder: 153, pk: 'id' },
  { name: 'patient_allergies', purgeOrder: 154, pk: 'id' },
  { name: 'patient_conditions', purgeOrder: 155, pk: 'id' },
  { name: 'patient_medications', purgeOrder: 156, pk: 'id' },
  { name: 'patient_record_access', purgeOrder: 157, pk: 'id' },
  { name: 'patient_visits', purgeOrder: 160, pk: 'id' },
  { name: 'patient_consents', purgeOrder: 170, pk: 'id' },
  { name: 'business_patients', purgeOrder: 172, pk: 'id' },
  { name: 'patient_members', purgeOrder: 174, pk: 'id' },
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
  { name: 'seed_clinics', purgeOrder: 270, pk: 'id' },
]
