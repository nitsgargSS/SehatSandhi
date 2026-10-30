// Which Instagram highlight each of Sehatsandhi's own posts belongs in (0296).
// Instagram lets no outside app touch highlights, so the owner files the week's
// Stories by hand; the 7 PM preview and the Sehatsandhi posts tab say where.
// Shared by the social-posts function and the dashboard. The names are the
// highlights made on @sehatsandhi with the covers in PageDesign/instagram-highlights.

const HIGHLIGHTS: Record<string, string[]> = {
  About: [
    'Meet Sehatsandhi', 'Who Sehatsandhi is for', 'A clinic day with Sehatsandhi', 'Why we built Sehatsandhi',
    'Works on phone and computer', 'Bring your old patient list', 'Myth: clinic software is costly and hard',
    'Your data stays yours', 'Made for Indian clinics',
  ],
  OPD: [
    'Appointments that fill themselves', 'No more crowd at reception', 'Prescriptions on WhatsApp', 'Bills in one tap',
    'Patient records in one place', 'Patients come back on time', 'Reception, doctor, owner: each sees their part',
    'Multi-doctor clinics, sorted', "Know your clinic's numbers",
  ],
  IPD: ['Beds and IPD on one screen', 'Discharge papers in minutes', 'Surgery day, well prepared'],
  Lab: ['Lab reports to patients', 'Tests sent to a partner lab', 'Hospital and lab settle up'],
  Pharmacy: ['Pharmacy stock without registers'],
  WhatsApp: ['Your own WhatsApp number', 'Health tips to your patients'],
  Marketing: ['A website for your clinic', 'Daily posts made for you', 'A QR poster at reception', 'Ratings that build trust'],
  'Free Demo': ['Try it with a free demo'],
}

const BY_TOPIC = new Map(Object.entries(HIGHLIGHTS).flatMap(([h, topics]) => topics.map((t) => [t, h] as const)))

/** The highlight for one of Sehatsandhi's series topics; null for festivals and anything else. */
export function highlightFor(topic: string | null | undefined): string | null {
  return (topic && BY_TOPIC.get(topic)) || null
}
