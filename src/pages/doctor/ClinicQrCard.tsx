import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { clinicWaLink, qrDataUrl } from '../../lib/qr'

// Clinic → Patient QR code (0141). Patients scan it at reception or from the
// OPD slip, WhatsApp opens with this clinic's code, and the bot shows this
// clinic's doctors to book.

export default function ClinicQrCard({ businessId, name, code }: { businessId: string; name: string; code: string | null }) {
  const [wa, setWa] = useState<string | null>(null)
  const [img, setImg] = useState<string | null>(null)

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
          <div className="text-gray-500">Opens WhatsApp {wa === '917015399355' ? 'to Sehatsandhi (+91 70153 99355)' : `to your number +${wa}`}</div>
          <div className="flex gap-2 flex-wrap">
            <a href={`/business/print/qr/${businessId}`} target="_blank" rel="noreferrer" className="btn-teal text-sm px-4 py-2">Print poster</a>
            {img && <a href={img} download={`${code}-qr.png`} className="btn-outline text-sm px-4 py-2">Download QR image</a>}
            {link && <a href={link} target="_blank" rel="noreferrer" className="text-teal-700 underline self-center">Try it</a>}
          </div>
        </div>
      </div>
    </div>
  )
}
