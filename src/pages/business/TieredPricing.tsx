import { BIZ } from './shared'
import { money } from '../../lib/format'
import type { PlanCatalogue, PlanTier } from '../../hooks/usePlanCatalogue'

// The /business pricing section under the plans by number of doctors (0272):
// four core plans, the add-ons, then the plans for labs and pharmacies.
//
// Every figure comes from the catalogue — the rows sehat_plan_quote charges
// from — so an admin's price change shows here with no deploy. BusinessLanding
// draws this only while plan_settings.tiered_live is on.

// Add-ons a clinic or hospital can buy. 'opd' is the pathology lab's own
// add-on (0278), shown with the lab plans instead.
const CORE_ADDONS = ['ipd', 'pathology', 'diagnostics', 'pharmacy']

const LAB_NOTES: Record<string, string> = {
  lab_pathology: 'Patient registration, samples, signed reports and report history',
  lab_diagnostic: 'Imaging and heart, lung and nerve tests — with OPD for your doctors',
  lab_both: 'Everything in both labs, with OPD for your doctors',
  pharmacy: 'Medicine orders from patients near you, stock, batches and GST bills',
}

export default function TieredPricing({ catalogue, gstNote, ambulancePrice }: {
  catalogue: PlanCatalogue
  /** "+ 18% GST" or "incl. 18% GST", or null when tax is off. */
  gstNote: string | null
  /** Ambulance services are not on these plans; they keep the listing fee. Null hides the line. */
  ambulancePrice: number | null
}) {
  const { settings: s, tiers, addons } = catalogue
  const core = tiers.filter(t => t.family === 'core')
  const others = tiers.filter(t => t.family !== 'core')
  const coreAddons = addons.filter(a => CORE_ADDONS.includes(a.code))
  const labOpd = addons.find(a => a.code === 'opd')
  const top = core[core.length - 1]

  // The worked example: the biggest plan with every add-on, at the bundle rate.
  const allAddons = coreAddons.reduce((n, a) => n + a.monthly_price, 0)
  const complete = top && coreAddons.length >= 3
    ? Math.round(top.monthly_price + allAddons * (1 - s.bundle3_pct / 100)) : null

  const pct = (n: number) => `${Number(n)}%`

  return (
    <>
      {/* ── core plans ── */}
      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {core.map((t, i) => {
          const hot = i === 0
          return (
            <div key={t.code} style={{
              background: hot ? BIZ.green : '#fff', border: hot ? 'none' : `1px solid ${BIZ.border}`,
              borderRadius: 18, padding: 'clamp(22px,5vw,28px)',
              boxShadow: hot ? '0 30px 60px -30px rgba(14,159,110,.6)' : 'none',
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: hot ? '#fff' : BIZ.green, marginBottom: 4 }}>{t.label}</div>
              <div style={{ fontSize: 13, color: hot ? '#d6f2e6' : BIZ.mutedWarm, marginBottom: 16 }}>
                Up to {t.max_doctors} doctor{t.max_doctors === 1 ? '' : 's'}
              </div>
              <div style={{ fontSize: 'clamp(28px,7vw,34px)', fontWeight: 800, color: hot ? '#fff' : BIZ.ink, letterSpacing: '-.02em' }}>
                {money(t.monthly_price)}
                <span style={{ fontSize: 15, fontWeight: 600, color: hot ? '#d6f2e6' : BIZ.mutedWarm }}>/month</span>
              </div>
              <ul style={{ margin: '16px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 7, fontSize: 13.5, color: hot ? '#eafaf3' : BIZ.muted }}>
                <li>✓ {t.staff_included} staff logins</li>
                <li>✓ OPD system, listing and WhatsApp bookings</li>
                {t.extra_doctor_price > 0 && <li>+ {money(t.extra_doctor_price)}/month for each doctor beyond {t.max_doctors}</li>}
              </ul>
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: 13.5, color: BIZ.mutedWarm, textAlign: 'center', marginTop: 18, lineHeight: 1.6 }}>
        Every plan covers every pincode you pick. Need more staff logins? {money(s.staff_pack_price)}/month for each {s.staff_pack_size} more.
      </p>

      {/* ── add-ons ── */}
      {coreAddons.length > 0 && (
        <div style={{ marginTop: 44 }}>
          <h3 style={{ fontSize: 'clamp(20px,5vw,24px)', fontWeight: 800, color: BIZ.ink, textAlign: 'center', margin: '0 0 8px', letterSpacing: '-.02em' }}>
            Add what your clinic runs
          </h3>
          <p style={{ fontSize: 15, color: BIZ.muted, textAlign: 'center', margin: '0 auto 24px', maxWidth: 620, lineHeight: 1.6 }}>
            Two add-ons: {pct(s.bundle2_pct)} off the add-ons. Three or more: {pct(s.bundle3_pct)} off.
          </p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {coreAddons.map(a => (
              <div key={a.code} style={{ background: BIZ.cream, border: `1px solid ${BIZ.border}`, borderRadius: 16, padding: 'clamp(18px,4vw,22px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: BIZ.ink }}>{a.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: BIZ.green, whiteSpace: 'nowrap' }}>{money(a.monthly_price)}/month</span>
                </div>
                {a.description && <div style={{ fontSize: 13, color: BIZ.muted, lineHeight: 1.55, marginTop: 8 }}>{a.description}</div>}
                {a.code === 'ipd' && (
                  <div style={{ fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 8 }}>
                    {s.ipd_beds_included} beds included · {money(s.ipd_bed_price)}/month a bed beyond
                  </div>
                )}
                {a.logins_included > 0 && (
                  <div style={{ fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 8 }}>+ {a.logins_included} technician logins</div>
                )}
              </div>
            ))}
          </div>
          {complete !== null && (
            <p style={{ fontSize: 14, color: BIZ.ink, textAlign: 'center', marginTop: 18 }}>
              <strong>{top.label} with every add-on: {money(complete)}/month</strong>
              <span style={{ color: BIZ.mutedWarm }}> — {money(top.monthly_price + allAddons)} before the {pct(s.bundle3_pct)} bundle discount.</span>
            </p>
          )}
        </div>
      )}

      {/* ── labs and pharmacies ── */}
      {others.length > 0 && (
        <div style={{ marginTop: 44 }}>
          <h3 style={{ fontSize: 'clamp(20px,5vw,24px)', fontWeight: 800, color: BIZ.ink, textAlign: 'center', margin: '0 0 24px', letterSpacing: '-.02em' }}>
            Labs and pharmacies
          </h3>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {others.map(t => <OtherPlan key={t.code} t={t} />)}
          </div>
          {labOpd && (
            <p style={{ fontSize: 13.5, color: BIZ.mutedWarm, textAlign: 'center', marginTop: 16 }}>
              A pathology lab can add OPD for its doctors at {money(labOpd.monthly_price)}/month.
            </p>
          )}
        </div>
      )}

      <p style={{ fontSize: 13.5, color: BIZ.mutedWarm, textAlign: 'center', marginTop: 30, maxWidth: 680, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
        6 months for the price of {Number(s.months6_factor)}; 12 months for the price of {Number(s.months12_factor)}.
        {' '}Your price is held for the term you pay for, and you see the total before you pay.
        {gstNote && ` Prices are ${gstNote.startsWith('incl') ? gstNote : `shown before GST; ${gstNote.replace(/^\+ /, '')} is added`}, with a tax invoice for every payment.`}
        {ambulancePrice !== null && ` Ambulance services: ${money(ambulancePrice)}/month listing fee.`}
      </p>
    </>
  )
}

function OtherPlan({ t }: { t: PlanTier }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 16, padding: 'clamp(18px,4vw,22px)' }}>
      <div style={{ fontSize: 15.5, fontWeight: 800, color: BIZ.ink }}>{t.label}</div>
      <div style={{ fontSize: 'clamp(22px,6vw,26px)', fontWeight: 800, color: BIZ.ink, letterSpacing: '-.02em', margin: '8px 0' }}>
        {money(t.monthly_price)}<span style={{ fontSize: 14, fontWeight: 600, color: BIZ.mutedWarm }}>/month</span>
      </div>
      {LAB_NOTES[t.code] && <div style={{ fontSize: 13, color: BIZ.muted, lineHeight: 1.55 }}>{LAB_NOTES[t.code]}</div>}
      <div style={{ fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 8 }}>
        {t.max_doctors > 0 && `${t.family === 'lab_pathology' ? `${t.max_doctors} pathologist${t.max_doctors === 1 ? '' : 's'}` : `Up to ${t.max_doctors} doctors`} · `}{t.staff_included} staff logins
        {t.extra_doctor_price > 0 && ` · ${money(t.extra_doctor_price)}/month a doctor beyond`}
      </div>
    </div>
  )
}
