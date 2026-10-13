import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { clinicWaLink, reviewWaLink, qrDataUrl } from '../../lib/qr'
import { checkinLink } from '../../lib/checkinApi'

// Clinic → Patient QR code (0141). Patients scan it at reception or from the
// OPD slip, WhatsApp opens with this clinic's code, and the bot shows this
// clinic's doctors to book.

export default function ClinicQrCard({ businessId, name, code }: { businessId: string; name: string; code: string | null }) {
  const [wa, setWa] = useState<string | null>(null)
  const [img, setImg] = useState<string | null>(null)
  // 0251: the second code — it opens the register-yourself form, not WhatsApp.
  // 0254: the third code — a walk-in patient rates their visit.
  const [rev, setRev] = useState<string | null>(null)
  useEffect(() => { if (wa && code) qrDataUrl(reviewWaLink(wa, code, name)).then(setRev) }, [wa, code, name])
  const [desk, setDesk] = useState<string | null>(null)
  useEffect(() => { if (code) qrDataUrl(checkinLink(code)).then(setDesk) }, [code])

  useEffect(() => {
    supabase.rpc('sehat_business_wa_number', { p_business: businessId })
      .then(({ data }) => setWa((data as string | null) ?? '917015399355'))
  }, [businessId])
  useEffect(() => {
    if (!wa || !code) return
    qrDataUrl(clinicWaLink(wa, code, name)).then(setImg)
  }, [wa, code, name])

  if (!code) return null
  const link = wa ? clinicWaLink(wa, code, name) : ''
  return (
    <div className="card shadow-sm space-y-3">
      <div>
        <h3 className="font-bold text-navy-700">Patient QR code</h3>
        <p className="text-sm text-gray-500">
          Put this at reception and on your OPD slips. Patients scan it, WhatsApp opens with your code <b>{code}</b>,
          and they can book with your doctors. Patients who book, or who say yes to updates, join your patient list.
        </p>
      </div>
      <div className="flex gap-5 items-center flex-wrap">
        {img ? <img src={img} alt={`QR code for ${name}`} className="w-40 h-40 border rounded-lg" /> : <div className="w-40 h-40 border rounded-lg bg-gray-50" />}
        <div className="space-y-2 text-sm">
          <div>Code: <b className="font-mono">{code}</b></div>
          <div className="text-gray-500">Opens WhatsApp {wa === '917015399355' ? 'to the Sehatsandhi booking assistant' : `to your number +${wa}`}</div>
          <div className="flex gap-2 flex-wrap">
            <a href={`/business/print/qr/${businessId}`} target="_blank" rel="noreferrer" className="btn-teal text-sm px-4 py-2">Print poster</a>
            {img && <a href={img} download={`${code}-qr.png`} className="btn-outline text-sm px-4 py-2">Download QR image</a>}
            {link && <a href={link} target="_blank" rel="noreferrer" className="text-teal-700 underline self-center">Try it</a>}
          </div>
        </div>
      </div>
      {/* 0251 */}
      <div className="border-t pt-3">
        <h3 className="font-bold text-navy-700">Reception QR — patients register themselves</h3>
        <p className="text-sm text-gray-500">
          Keep this one on the reception desk. A patient scans it with their phone's camera, fills in their name, age and WhatsApp number,
          and appears on your <b>Queue</b> screen under "Registered themselves". You check the details, take the OPD fee and give the token — nothing is added to your patient list until you do.
        </p>
        <div className="flex gap-5 items-center flex-wrap mt-2">
          {desk ? <img src={desk} alt={`Reception QR code for ${name}`} className="w-40 h-40 border rounded-lg" /> : <div className="w-40 h-40 border rounded-lg bg-gray-50" />}
          <div className="space-y-2 text-sm">
            <div className="text-gray-500">Opens a short form — not WhatsApp, no app needed.</div>
            <div className="flex gap-2 flex-wrap">
              <a href={`/business/print/qr/${businessId}?kind=reception`} target="_blank" rel="noreferrer" className="btn-teal text-sm px-4 py-2">Print poster</a>
              {desk && <a href={desk} download={`${code}-reception-qr.png`} className="btn-outline text-sm px-4 py-2">Download QR image</a>}
              <a href={checkinLink(code)} target="_blank" rel="noreferrer" className="text-teal-700 underline self-center">Try it</a>
            </div>
          </div>
        </div>
      </div>
      {/* 0254 */}
      <div className="border-t pt-3">
        <h3 className="font-bold text-navy-700">Review QR — walk-in patients rate their visit</h3>
        <p className="text-sm text-gray-500">
          Keep this one where patients leave — the billing counter or the pharmacy. They scan it, WhatsApp opens, and they give stars and a line in their own words.
          It costs you nothing. Only a number your records show visiting in the last 30 days can rate, once — so every review is a real patient's.
        </p>
        <div className="flex gap-5 items-center flex-wrap mt-2">
          {rev ? <img src={rev} alt={`Review QR code for ${name}`} className="w-40 h-40 border rounded-lg" /> : <div className="w-40 h-40 border rounded-lg bg-gray-50" />}
          <div className="space-y-2 text-sm">
            <div className="text-gray-500">The patient must write from the number they gave at reception.</div>
            <div className="flex gap-2 flex-wrap">
              <a href={`/business/print/qr/${businessId}?kind=review`} target="_blank" rel="noreferrer" className="btn-teal text-sm px-4 py-2">Print poster</a>
              {rev && <a href={rev} download={`${code}-review-qr.png`} className="btn-outline text-sm px-4 py-2">Download QR image</a>}
              {wa && <a href={reviewWaLink(wa, code, name)} target="_blank" rel="noreferrer" className="text-teal-700 underline self-center">Try it</a>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
