import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { MapPin, Clock, Phone, Star, CheckCircle2, ArrowLeft, Share2, Copy } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Doctor, SPECIALITIES, WA_NUMBER } from '../../types'

export default function DoctorProfile() {
  const { slug } = useParams()
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!slug) return
      // slug format: dr-priya-sharma-135001
      const namePart = slug.split('-').slice(0, -1).join(' ').replace('dr ', 'Dr. ')
      const { data } = await supabase
        .from('doctors')
        .select('*')
        .ilike('name', `%${namePart.replace('Dr. ', '')}%`)
        .eq('status', 'active')
        .single()
      setDoctor(data)
      setLoading(false)
    }
    load()
  }, [slug])

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const waMsg = encodeURIComponent(
    `Namaste! Main ${doctor?.name || 'aapke doctor'} se appointment book karna chahta hoon. Sehatsandhi se aa raha hoon.`
  )

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center pt-16">
      <div className="text-gray-400 text-sm">Loading...</div>
    </div>
  )

  if (!doctor) return (
    <div className="min-h-screen flex items-center justify-center pt-16 px-4">
      <div className="text-center">
        <div className="text-6xl mb-4">🏥</div>
        <h2 className="text-xl font-bold text-navy-700 mb-2">Doctor not found</h2>
        <p className="text-gray-500 text-sm mb-6">This profile may have moved or is no longer active.</p>
        <Link to="/" className="btn-teal">Find another doctor</Link>
      </div>
    </div>
  )

  const speciality = SPECIALITIES.find(s => s.id === doctor.speciality)

  return (
    <div className="min-h-screen bg-gray-50 pt-16">
      {/* Back */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-gray-500 hover:text-teal-600 text-sm transition">
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">

        {/* Main profile card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Teal header strip */}
          <div className="h-24 bg-gradient-to-r from-teal-600 to-navy-700" />

          <div className="px-6 pb-6">
            {/* Avatar */}
            <div className="flex items-end justify-between -mt-12 mb-4">
              <div className="w-24 h-24 rounded-2xl bg-white border-4 border-white shadow-md flex items-center justify-center text-3xl font-bold text-teal-600 bg-teal-50">
                {doctor.name.split(' ').pop()?.charAt(0)}
              </div>
              <div className="flex gap-2 mt-12">
                <button onClick={copyLink}
                  className="flex items-center gap-1.5 text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:border-teal-400 text-gray-500 hover:text-teal-600 transition">
                  {copied ? <><CheckCircle2 className="w-3.5 h-3.5 text-teal-500" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy link</>}
                </button>
                <button onClick={() => navigator.share?.({ title: doctor.name, url: window.location.href })}
                  className="flex items-center gap-1.5 text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:border-teal-400 text-gray-500 hover:text-teal-600 transition">
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
              </div>
            </div>

            {/* Name + verified */}
            <div className="flex items-start justify-between flex-wrap gap-2 mb-1">
              <div>
                <h1 className="text-2xl font-bold text-navy-700">{doctor.name}</h1>
                <p className="text-gray-500 text-sm">{doctor.qualification}</p>
              </div>
              <span className="flex items-center gap-1.5 bg-teal-50 text-teal-700 border border-teal-200 px-3 py-1.5 rounded-full text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sehatsandhi Verified
              </span>
            </div>

            {/* Speciality */}
            <p className="text-teal-600 font-semibold mb-4">
              {speciality ? `${speciality.en} — ${speciality.hi}` : doctor.speciality}
            </p>

            {/* Info grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-3">
                <MapPin className="w-4 h-4 text-teal-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Clinic Address</p>
                  <p className="text-sm text-gray-700">{doctor.clinic_name}</p>
                  <p className="text-xs text-gray-500">{doctor.address}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-3">
                <Clock className="w-4 h-4 text-teal-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Working Hours</p>
                  <p className="text-sm text-gray-700">{doctor.working_hours || 'Mon-Sat 10am-6pm'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-3">
                <span className="text-lg mt-0.5">💰</span>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Consultation Fee</p>
                  <p className="text-sm font-semibold text-navy-700">₹{doctor.consultation_fee}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-3">
                <span className="text-lg mt-0.5">📍</span>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Coverage Area</p>
                  <p className="text-sm text-gray-700">{doctor.pin_codes?.join(', ')}</p>
                </div>
              </div>
            </div>

            {/* Book button */}
            <a href={`https://wa.me/${WA_NUMBER}?text=${waMsg}`}
               target="_blank" rel="noreferrer"
               className="btn-teal w-full justify-center py-4 text-base shadow-lg shadow-teal-100">
              📱 WhatsApp par Appointment Book Karein
            </a>
            <p className="text-center text-xs text-gray-400 mt-2">Free booking • No registration • Reply in minutes</p>
          </div>
        </div>

        {/* How to book */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-bold text-navy-700 mb-4">Appointment kaise book karein?</h3>
          <div className="space-y-3">
            {[
              ['1', 'WhatsApp button dabayein', 'Niche diya button dabayein'],
              ['2', 'Message bhejein', 'Bot aapko guide karega'],
              ['3', 'Slot chunein', 'Available time select karein'],
              ['4', 'Confirm karein', 'Appointment confirm ho jayegi'],
            ].map(([n, t, d]) => (
              <div key={n} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold shrink-0">{n}</div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{t}</p>
                  <p className="text-xs text-gray-400">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Share card */}
        <div className="bg-navy-700 rounded-2xl p-6 text-white">
          <h3 className="font-bold mb-2">Is doctor ko dosto ke saath share karein</h3>
          <p className="text-white/60 text-sm mb-4">
            Apne dost ko iss doctor ke baare mein batayein aur Sehat Points kamayein
          </p>
          <button onClick={copyLink}
            className="bg-white text-navy-700 font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-gray-50 transition">
            {copied ? '✓ Link Copied!' : '🔗 Profile Link Copy Karein'}
          </button>
        </div>

        {/* Find more */}
        <div className="text-center py-4">
          <p className="text-gray-500 text-sm mb-3">Doosre doctors bhi dhundhen</p>
          <Link to="/" className="btn-navy text-sm">← Sab Doctors Dekhen</Link>
        </div>

      </div>
    </div>
  )
}
