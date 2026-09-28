// Make report photos small before they are uploaded.
//
// A phone photo of one report page is 3–8 MB; a 10-page report photographed
// page by page is 30–60 MB. Stored as it comes, that fills storage, takes
// minutes on clinic Wi-Fi, and is slow for the patient to open from WhatsApp.
// Zipping does not help: JPEG and PDF are already compressed, and a patient
// cannot open a .zip on a phone.
//
// So, in the browser, before upload:
//   • each photo is resized to at most 2200 px on its long side (still sharp
//     enough to read the smallest print on a report) and saved as JPEG at 72%
//     — about 250–600 KB a page instead of 3–8 MB;
//   • several photos become ONE PDF, a page per photo, in the order chosen —
//     one file for the patient, like a scanned report;
//   • a PDF is uploaded as it is (it is usually already small; a PDF built
//     from full-size photos is refused over the limit, with how to fix it).
// Only the size changes: nothing on the page is cropped, retouched or re-typed.

const MAX_EDGE = 2200
const QUALITY = 0.72
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_PAGES = 40

export type Prepared = { file: File; originalBytes: number; pages: number }

async function shrinkOne(f: File): Promise<Blob> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(f, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`Could not read ${f.name}. If it is an iPhone HEIC photo, set Camera → Formats → Most Compatible, or upload a PDF.`)
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) // transparent PNGs become white, not black
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const out = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', QUALITY))
  if (!out) throw new Error(`Could not compress ${f.name}.`)
  // An already-small JPEG can come out larger; keep whichever is smaller.
  return f.type === 'image/jpeg' && f.size <= out.size ? f : out
}

function baseName(name: string) { return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'report' }

export async function prepareUpload(files: File[]): Promise<Prepared> {
  if (!files.length) throw new Error('Choose a file.')
  const originalBytes = files.reduce((n, f) => n + f.size, 0)
  const pdfs = files.filter(f => f.type === 'application/pdf')
  const images = files.filter(f => f.type.startsWith('image/'))
  if (pdfs.length + images.length !== files.length) throw new Error('Upload a PDF or photos (JPG, PNG).')

  if (pdfs.length) {
    if (files.length > 1) throw new Error('Upload one PDF, or photos of the pages — not both together.')
    if (pdfs[0].size > MAX_UPLOAD_BYTES) {
      throw new Error(`This PDF is ${(pdfs[0].size / 1048576).toFixed(0)} MB; the limit is 20 MB. Upload photos of the pages instead — they are compressed automatically — or save the PDF with "reduce size" in the scanner app.`)
    }
    return { file: pdfs[0], originalBytes, pages: 1 }
  }

  if (images.length > MAX_PAGES) throw new Error(`Up to ${MAX_PAGES} pages at a time.`)
  const shrunk: Blob[] = []
  for (const f of images) shrunk.push(await shrinkOne(f)) // one at a time: phones run out of memory decoding many at once

  if (shrunk.length === 1) {
    const file = new File([shrunk[0]], `${baseName(images[0].name)}.jpg`, { type: 'image/jpeg' })
    return { file, originalBytes, pages: 1 }
  }

  const { jsPDF } = await import('jspdf')
  let doc: InstanceType<typeof jsPDF> | null = null
  for (const b of shrunk) {
    const bytes = new Uint8Array(await b.arrayBuffer())
    const bmp = await createImageBitmap(b)
    // Page as wide as A4 (595 pt), as tall as the photo needs: no borders, no cropping.
    const w = 595, h = Math.round(595 * bmp.height / bmp.width)
    bmp.close()
    const orient = w > h ? 'l' : 'p'
    if (!doc) doc = new jsPDF({ unit: 'pt', format: [w, h], orientation: orient, compress: true })
    else doc.addPage([w, h], orient)
    doc.addImage(bytes, 'JPEG', 0, 0, w, h)
  }
  const blob = doc!.output('blob')
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Even compressed, these pages come to more than 20 MB. Upload them in two parts.')
  return { file: new File([blob], `${baseName(images[0].name)}.pdf`, { type: 'application/pdf' }), originalBytes, pages: shrunk.length }
}

export function sizeText(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
