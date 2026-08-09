import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchInvoice, Invoice } from '../lib/invoiceApi'
import SiteFooter from '../components/SiteFooter'

// A GST-compliant tax invoice, rendered from stored data.
//
// This IS the PDF: the print stylesheet strips the page chrome so the business
// gets a clean document from their browser's "Save as PDF". That avoids a PDF
// library and a storage bucket, and means a corrected invoice is corrected
// everywhere rather than in a stale attachment.
//
// Reached without a login, by unguessable token, because the link goes out over
// WhatsApp and email. The invoice-view function returns exactly one row for a
// valid token and nothing else.
//
// Fields present here are the ones Rule 46 requires: supplier and recipient
// details with GSTINs, a consecutive invoice number, date, SAC code, taxable
// value, the tax split, place of supply, and the reverse-charge status.

const money = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function InvoicePage() {
  const { token } = useParams<{ token: string }>()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) { setError('No invoice specified.'); setLoading(false); return }
    fetchInvoice(token)
      .then(setInvoice)
      .catch(e => setError((e as Error).message.includes('404')
        ? 'This invoice link is not valid. Please check the link or contact us on WhatsApp.'
        : (e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <Centered>Loading invoice…</Centered>
  if (error || !invoice) return <Centered>{error || 'Invoice not found.'}</Centered>

  const interState = Number(invoice.igst_amount) > 0
  const cancelled = invoice.status === 'cancelled'

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 print:bg-white print:p-0 flex flex-col">
      {/* Screen-only actions — hidden in print */}
      <div className="max-w-3xl mx-auto mb-4 flex justify-between items-center print:hidden">
        <span className="text-sm text-gray-500">
          Use your browser's print dialog and choose "Save as PDF" to keep a copy.
        </span>
        <button onClick={() => window.print()}
          className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          Download / Print
        </button>
      </div>

      <div className="max-w-3xl mx-auto bg-white shadow-sm print:shadow-none border border-gray-200 print:border-0 p-8 print:p-0">
        {cancelled && (
          <div className="mb-6 border-2 border-red-300 bg-red-50 text-red-700 text-center font-bold py-2 rounded">
            CANCELLED{invoice.cancelled_reason ? ` — ${invoice.cancelled_reason}` : ''}
          </div>
        )}

        <div className="flex justify-between items-start gap-6 border-b border-gray-200 pb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {invoice.supplier_legal_name || invoice.supplier_trade_name || 'Sehatsandhi'}
            </h1>
            {invoice.supplier_address && (
              <p className="text-xs text-gray-500 mt-1 max-w-xs whitespace-pre-line">{invoice.supplier_address}</p>
            )}
            {invoice.supplier_gstin && (
              <p className="text-xs text-gray-700 mt-1">GSTIN: <span className="font-mono">{invoice.supplier_gstin}</span></p>
            )}
          </div>
          <div className="text-right">
            {/* Only a supply that actually carried GST may be called a tax invoice. */}
            <div className="text-lg font-bold text-gray-900">
              {Number(invoice.tax_total) > 0 ? 'TAX INVOICE' : 'INVOICE'}
            </div>
            <div className="text-sm font-mono text-gray-700 mt-1">{invoice.invoice_number}</div>
            <div className="text-xs text-gray-500 mt-0.5">Date: {fmtDate(invoice.invoice_date)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 py-5 border-b border-gray-200">
          <div>
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Billed to</div>
            <div className="font-semibold text-gray-900 text-sm">{invoice.recipient_name || '—'}</div>
            {invoice.recipient_address && (
              <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">{invoice.recipient_address}</p>
            )}
            {invoice.recipient_phone && <p className="text-xs text-gray-500 mt-0.5">{invoice.recipient_phone}</p>}
            <p className="text-xs text-gray-700 mt-1">
              GSTIN: {invoice.recipient_gstin
                ? <span className="font-mono">{invoice.recipient_gstin}</span>
                : <span className="text-gray-400">Unregistered</span>}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Details</div>
            <p className="text-xs text-gray-600">Place of supply: <strong>{invoice.place_of_supply || '—'}</strong></p>
            <p className="text-xs text-gray-600">Reverse charge: <strong>{invoice.reverse_charge ? 'Yes' : 'No'}</strong></p>
            {invoice.period_start && (
              <p className="text-xs text-gray-600">
                Period: {fmtDate(invoice.period_start)} – {fmtDate(invoice.period_end)}
              </p>
            )}
          </div>
        </div>

        <table className="w-full text-sm mt-5">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-200">
              <th className="pb-2">Description</th>
              <th className="pb-2">SAC</th>
              <th className="pb-2 text-right">Taxable value</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-3 text-gray-800">
                {invoice.description || 'Business listing services'}
                {invoice.months ? <span className="text-gray-500"> · {invoice.months} month{invoice.months === 1 ? '' : 's'}</span> : null}
                {invoice.pin_codes?.length ? (
                  <div className="text-xs text-gray-400 mt-1">
                    Pincodes: {invoice.pin_codes.join(', ')}
                  </div>
                ) : null}
              </td>
              <td className="py-3 font-mono text-xs text-gray-600">{invoice.sac_code || '—'}</td>
              <td className="py-3 text-right text-gray-800">{money(invoice.taxable_value)}</td>
            </tr>
          </tbody>
        </table>

        <div className="flex justify-end mt-4">
          <div className="w-full sm:w-72 text-sm">
            <Row label="Taxable value" value={money(invoice.taxable_value)} />
            {Number(invoice.tax_total) > 0 ? (
              interState ? (
                <Row label={`IGST @ ${invoice.gst_rate}%`} value={money(invoice.igst_amount)} />
              ) : (
                <>
                  <Row label={`CGST @ ${Number(invoice.gst_rate) / 2}%`} value={money(invoice.cgst_amount)} />
                  <Row label={`SGST @ ${Number(invoice.gst_rate) / 2}%`} value={money(invoice.sgst_amount)} />
                </>
              )
            ) : (
              <Row label="GST" value="Not applicable" />
            )}
            <div className="flex justify-between border-t-2 border-gray-800 mt-2 pt-2 font-bold text-gray-900">
              <span>Total</span>
              <span>{money(invoice.total_amount)}</span>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-gray-200 text-[11px] text-gray-500 leading-relaxed">
          <p>Amount received in full. This is a computer-generated invoice and does not require a signature.</p>
          {Number(invoice.tax_total) === 0 && (
            <p className="mt-1">GST is not charged on this invoice.</p>
          )}
        </div>
      </div>

      {/* Screen only — the footer is navigation, and a saved PDF of a tax
          invoice should carry nothing but the invoice. The negative margins
          undo this page's gutter so the band still runs edge to edge. */}
      <div className="print:hidden mt-auto pt-8 -mx-4 -mb-8">
        <SiteFooter />
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 text-gray-600">
      <span>{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <p className="text-gray-500 text-sm text-center max-w-sm">{children}</p>
    </div>
  )
}
