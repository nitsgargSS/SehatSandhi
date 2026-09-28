import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getUploadedFile } from '../lib/labApi'

// An uploaded lab report (0169), at /lab/file/<token> — the WhatsApp link.
//
// The file is shown exactly as the lab uploaded it: a PDF in the browser's own
// viewer, a photo as a photo, and a download button either way. Nothing is
// re-typed or re-printed. The link lasts as long as the lab keeps the report
// (its retention); after that the page says so.

export default function LabFilePage() {
  const { token } = useParams()
  const [f, setF] = useState<Awaited<ReturnType<typeof getUploadedFile>> | null>(null)

  useEffect(() => { if (token) getUploadedFile(token).then(setF).catch(() => setF({ missing: true })) }, [token])

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: '#f6f4ee', fontFamily: 'system-ui, Arial, sans-serif', color: '#14201c' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '18px 14px 40px' }}>{children}</div>
    </div>
  )
  if (!f) return shell(<p>Loading…</p>)
  if ('expired' in f) return shell(<p>{f.message || 'This report is no longer kept online. Please ask the lab for a copy.'}</p>)
  if ('missing' in f) return shell(<p>We could not find this report. Please check the link, or ask the lab to send it again.</p>)

  const isPdf = f.mime_type === 'application/pdf'
  return shell(
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{f.title}</div>
          <div style={{ fontSize: 13, color: '#5b6b63' }}>
            {[f.lab_name, f.patient_name ? `for ${f.patient_name}` : null,
              f.report_date ? new Date(f.report_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <a href={f.url} target="_blank" rel="noreferrer" download
          style={{ background: '#0f6b4a', color: '#fff', fontWeight: 700, padding: '10px 18px', borderRadius: 10, textDecoration: 'none' }}>
          Download report
        </a>
      </div>
      <div style={{ background: '#fff', border: '1px solid #e2ddd0', borderRadius: 12, overflow: 'hidden' }}>
        {isPdf
          ? <iframe src={f.url} title={f.title} style={{ width: '100%', height: '80vh', border: 'none' }} />
          : <img src={f.url} alt={f.title} style={{ width: '100%', display: 'block' }} />}
      </div>
      <p style={{ fontSize: 12, color: '#8a8172', marginTop: 10 }}>
        Shared by {f.lab_name ?? 'the lab'} exactly as issued. Available online until {new Date(f.expires_on).toLocaleDateString('en-IN', { dateStyle: 'medium' })}.
        Please save a copy if you need it after that.
      </p>
    </>,
  )
}
