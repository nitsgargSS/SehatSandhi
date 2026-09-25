import { supabase } from './supabase'
import type { Invoice } from './invoiceApi'

// Every invoice of a GST period, one PDF each, in one ZIP.
//
// The invoice page (InvoicePage.tsx) is still the invoice: this redraws the same
// fields in the same order, for the one case a browser's "Save as PDF" cannot
// serve — a CA asking for a quarter's worth as separate files. If a field is
// added to that page, add it here too; both read the same row.
//
// jsPDF and JSZip are imported on demand, so nobody but an admin pressing this
// button downloads them.
//
// ── TEXT, NOT PICTURES ──────────────────────────────────────────────────────
// Drawn with jsPDF's text calls rather than a screenshot of the page, so the
// numbers can be searched and copied — a scanned-looking tax invoice is the
// first thing an assessment asks to see again. The price of that is the
// built-in font, which covers Latin-1 only: ₹ is written "Rs." and a character
// outside Latin-1 (a name in Devanagari, say) is replaced, and counted, so the
// panel can say so instead of shipping a garbled document silently.

export interface InvoiceBundle {
  blob: Blob
  count: number
  cancelled: number
  /** Invoices where some text had to be replaced for the PDF font. */
  replacedText: string[]
}

export async function fetchInvoicesForPeriod(from: string, to: string): Promise<Invoice[]> {
  const { data, error } = await supabase.rpc('sehat_admin_invoices', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  return (data ?? []) as Invoice[]
}

/** SS/2026-27/0009 → SS-2026-27-0009.pdf */
export const invoiceFileName = (n: string) => `${n.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`

export async function buildInvoiceZip(
  invoices: Invoice[],
  extras: { name: string; content: string }[] = [],
  onProgress?: (done: number, total: number) => void,
): Promise<InvoiceBundle> {
  const [{ jsPDF }, { default: JSZip }] = await Promise.all([import('jspdf'), import('jszip')])
  const zip = new JSZip()
  const replaced: string[] = []
  const used = new Set<string>()

  invoices.forEach((inv, i) => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    if (drawInvoice(doc, inv)) replaced.push(inv.invoice_number)
    let name = invoiceFileName(inv.invoice_number)
    // Two invoices can never share a number within a year, but belt and braces.
    while (used.has(name)) name = name.replace(/\.pdf$/, '-dup.pdf')
    used.add(name)
    zip.file(name, doc.output('arraybuffer'))
    onProgress?.(i + 1, invoices.length)
  })
  extras.forEach(e => zip.file(e.name, e.content))

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return {
    blob,
    count: invoices.length,
    cancelled: invoices.filter(i => i.status === 'cancelled').length,
    replacedText: replaced,
  }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Not revoked synchronously: Safari can cancel a download whose blob is gone.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Drawing ─────────────────────────────────────────────────────────────────

type Doc = InstanceType<typeof import('jspdf').jsPDF>

const PAGE_W = 210
const M = 18                 // margin
const RIGHT = PAGE_W - M

const money = (n: number | string | null | undefined) =>
  `Rs. ${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// PostgREST sends a date as 'yyyy-mm-dd'; tolerate a timestamp or a Date too,
// so a changed column type prints a date rather than "Invalid Date".
const fmtDate = (d: unknown) => {
  if (!d) return '-'
  const day = d instanceof Date
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate())
    : new Date(`${String(d).slice(0, 10)}T00:00:00`)
  return isNaN(day.getTime()) ? String(d)
    : day.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Draws one invoice. Returns true if any text had to be altered for the font. */
function drawInvoice(doc: Doc, inv: Invoice): boolean {
  let altered = false
  // Latin-1 only; see the note at the top.
  const t = (s: unknown): string => {
    const raw = String(s ?? '')
      .replace(/₹/g, 'Rs.').replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    const safe = raw.replace(/[^\x00-\xFF]/g, '?')
    if (safe !== raw) altered = true
    return safe
  }
  const gray = (v: number) => doc.setTextColor(v, v, v)
  const rule = (y: number, w = 0.2) => { doc.setDrawColor(210); doc.setLineWidth(w); doc.line(M, y, RIGHT, y) }
  const lines = (s: string, width: number) => doc.splitTextToSize(t(s), width) as string[]

  const taxed = Number(inv.tax_total) > 0
  const interState = Number(inv.igst_amount) > 0
  let y = M

  if (inv.status === 'cancelled') {
    doc.setDrawColor(220, 38, 38); doc.setLineWidth(0.6)
    doc.rect(M, y, RIGHT - M, 9)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(185, 28, 28)
    doc.text(t(`CANCELLED${inv.cancelled_reason ? ` - ${inv.cancelled_reason}` : ''}`), PAGE_W / 2, y + 6, { align: 'center' })
    y += 15
  }

  // Header: supplier on the left, invoice title and number on the right.
  const top = y
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); gray(20)
  doc.text(t(inv.supplier_legal_name || inv.supplier_trade_name || 'Sehatsandhi'), M, y + 5)
  y += 10
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); gray(110)
  if (inv.supplier_address) { const l = lines(inv.supplier_address, 95); doc.text(l, M, y); y += l.length * 4 }
  if (inv.supplier_gstin) { gray(60); doc.text(t(`GSTIN: ${inv.supplier_gstin}`), M, y + 1); y += 5 }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); gray(20)
  doc.text(taxed ? 'TAX INVOICE' : 'INVOICE', RIGHT, top + 5, { align: 'right' })
  doc.setFont('courier', 'normal'); doc.setFontSize(10); gray(60)
  doc.text(t(inv.invoice_number), RIGHT, top + 11, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); gray(110)
  doc.text(t(`Date: ${fmtDate(inv.invoice_date)}`), RIGHT, top + 16, { align: 'right' })

  y = Math.max(y, top + 20) + 3
  rule(y); y += 7

  // Billed to, and the details a return is checked against.
  const block = y
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); gray(150)
  doc.text('BILLED TO', M, y)
  doc.text('DETAILS', RIGHT, y, { align: 'right' })
  y += 5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); gray(20)
  doc.text(t(inv.recipient_name || '-'), M, y); y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); gray(110)
  if (inv.recipient_address) { const l = lines(inv.recipient_address, 95); doc.text(l, M, y); y += l.length * 4 }
  if (inv.recipient_phone) { doc.text(t(inv.recipient_phone), M, y); y += 4 }
  gray(60)
  doc.text(t(`GSTIN: ${inv.recipient_gstin || 'Unregistered'}`), M, y + 1); y += 5

  let ry = block + 5
  const detail = (s: string) => { doc.text(t(s), RIGHT, ry, { align: 'right' }); ry += 4.5 }
  doc.setFontSize(8.5); gray(80)
  detail(`Place of supply: ${inv.place_of_supply || '-'}`)
  detail(`Reverse charge: ${inv.reverse_charge ? 'Yes' : 'No'}`)
  if (inv.period_start) detail(`Period: ${fmtDate(inv.period_start)} - ${fmtDate(inv.period_end)}`)

  y = Math.max(y, ry) + 3
  rule(y); y += 8

  // The line.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); gray(120)
  doc.text('DESCRIPTION', M, y)
  doc.text('SAC', 128, y)
  doc.text('TAXABLE VALUE', RIGHT, y, { align: 'right' })
  y += 2.5; rule(y); y += 5.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); gray(40)
  // Itemised since 0117 (subscription, WhatsApp, coupon); one line before that.
  const items = inv.line_items?.length
    ? inv.line_items.map(li => ({ desc: li.label, amount: li.amount }))
    : [{ desc: (inv.description || 'Business listing services')
        + (inv.months ? ` - ${inv.months} month${inv.months === 1 ? '' : 's'}` : ''), amount: Number(inv.taxable_value) }]
  for (const it of items) {
    const dl = lines(it.desc, 100)
    doc.text(dl, M, y)
    doc.setFont('courier', 'normal'); doc.setFontSize(8.5); gray(90)
    doc.text(t(inv.sac_code || '-'), 128, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); gray(40)
    doc.text(it.amount < 0 ? `- ${money(-it.amount)}` : money(it.amount), RIGHT, y, { align: 'right' })
    y += dl.length * 4.5 + 1
  }
  if (inv.pin_codes?.length) {
    doc.setFontSize(7.5); gray(150)
    const pl = lines(`Pincodes: ${inv.pin_codes.join(', ')}`, 100)
    doc.text(pl, M, y); y += pl.length * 3.5
  }
  y += 2; rule(y, 0.1); y += 8

  // Totals, right-aligned like the page.
  const LX = 120
  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); gray(90)
    doc.text(t(label), LX, y); gray(20); doc.text(t(value), RIGHT, y, { align: 'right' }); y += 6
  }
  row('Taxable value', money(inv.taxable_value))
  if (taxed) {
    if (interState) row(`IGST @ ${Number(inv.gst_rate)}%`, money(inv.igst_amount))
    else {
      row(`CGST @ ${Number(inv.gst_rate) / 2}%`, money(inv.cgst_amount))
      row(`SGST @ ${Number(inv.gst_rate) / 2}%`, money(inv.sgst_amount))
    }
  } else row('GST', 'Not applicable')
  doc.setDrawColor(40); doc.setLineWidth(0.6); doc.line(LX, y - 2, RIGHT, y - 2)
  y += 3
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); gray(20)
  doc.text('Total', LX, y); doc.text(money(inv.total_amount), RIGHT, y, { align: 'right' })
  y += 14

  rule(y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); gray(120)
  doc.text('Amount received in full. This is a computer-generated invoice and does not require a signature.', M, y)
  if (!taxed) doc.text('GST is not charged on this invoice.', M, y + 4)

  doc.setProperties({ title: t(`Invoice ${inv.invoice_number}`) })
  return altered
}
