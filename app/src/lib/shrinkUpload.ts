// Stands in for the website's src/lib/shrinkUpload.ts, which shrinks images and
// builds PDFs in the browser (canvas, jspdf) before an upload. The app does not
// upload documents yet, so the shared files that import it (prescriptionsApi,
// labApi) get this instead via metro.config.js. Same exports.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export type Prepared = { file: File; originalBytes: number; pages: number }

export async function prepareUpload(_files: File[]): Promise<Prepared> {
  throw new Error('Uploading documents is done on the computer for now.')
}

export function sizeText(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}
