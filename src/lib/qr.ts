import QRCode from 'qrcode'

// A business's patient QR code (0141/0142). It opens WhatsApp — Sehatsandhi's
// bot number, or the clinic's own once live — with a message carrying the
// clinic's SS-code, which the bot reads to list that clinic's doctors.

export const clinicWaLink = (waNumber: string, code: string, name: string): string =>
  `https://wa.me/${waNumber.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${code} (${name}) — I want to book an appointment`)}`

export const qrDataUrl = (text: string, width = 600): Promise<string> =>
  QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b3d2c', light: '#ffffff' } })
