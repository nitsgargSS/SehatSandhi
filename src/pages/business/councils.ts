// State Medical Councils, as the Indian Medical Register knows them.
//
// A registration number is only unique within its council — 27776 belongs to a
// different doctor in each of seventeen of them — so the council is what turns a
// number into an answer. This list is the dropdown for that, and the ids are the
// `smcId` the IMR search takes.
//
// Harvested from the register itself rather than typed from the NMC website, so
// the names and ids match what a lookup will actually be filtered by. Ids are not
// contiguous: 27, 30-32, 34, 38, 39, 44 and 47-49 return nothing.
//
// The historic councils at the bottom are not decoration. Bombay, Madras, Mysore
// and Hyderabad between them still hold ~54,000 live registrations, and a doctor
// who registered under one of them cannot be found under the successor state's
// council. Dropping them would make the oldest doctors on the register
// unsearchable — exactly the ones least able to prove themselves another way.

export interface Council {
  /** `smcId` in the IMR query string. */
  id: number
  name: string
  /** Roughly how many registrations the council holds, when harvested. */
  size: number
  /** Superseded by a successor council, but still holding live records. */
  historic?: boolean
}

export const COUNCILS: Council[] = [
  { id: 1,  name: 'Andhra Pradesh Medical Council',   size: 122477 },
  { id: 2,  name: 'Arunachal Pradesh Medical Council', size: 1525 },
  { id: 3,  name: 'Assam Medical Council',            size: 25722 },
  { id: 4,  name: 'Bihar Medical Council',            size: 47031 },
  { id: 5,  name: 'Chattisgarh Medical Council',      size: 15413 },
  { id: 6,  name: 'Delhi Medical Council',            size: 31588 },
  { id: 7,  name: 'Goa Medical Council',              size: 4331 },
  { id: 8,  name: 'Gujarat Medical Council',          size: 84604 },
  { id: 9,  name: 'Haryana Medical Council',          size: 16508 },
  { id: 10, name: 'Himanchal Pradesh Medical Council', size: 3632 },
  { id: 11, name: 'Jammu & Kashmir Medical Council',  size: 22402 },
  { id: 12, name: 'Jharkhand Medical Council',        size: 9843 },
  { id: 13, name: 'Karnataka Medical Council',        size: 156115 },
  // Kerala also answers on id 33 with an identical count. 14 is the canonical one.
  { id: 14, name: 'Kerala Medical Council',           size: 624 },
  { id: 15, name: 'Madhya Pradesh Medical Council',   size: 42674 },
  { id: 16, name: 'Maharashtra Medical Council',      size: 200777 },
  { id: 26, name: 'Manipur Medical Council',          size: 3 },
  { id: 42, name: 'Mizoram Medical Council',          size: 156 },
  { id: 41, name: 'Nagaland Medical Council',         size: 1498 },
  { id: 17, name: 'Orissa Council of Medical Registration', size: 29236 },
  { id: 18, name: 'Punjab Medical Council',           size: 53194 },
  { id: 19, name: 'Rajasthan Medical Council',        size: 49243 },
  { id: 20, name: 'Sikkim Medical Council',           size: 1445 },
  { id: 21, name: 'Tamil Nadu Medical Council',       size: 193264 },
  { id: 43, name: 'Telangana State Medical Council',  size: 43492 },
  { id: 22, name: 'Tripura State Medical Council',    size: 4307 },
  { id: 23, name: 'Uttar Pradesh Medical Council',    size: 93565 },
  { id: 24, name: 'Uttarakhand Medical Council',      size: 9723 },
  { id: 25, name: 'West Bengal Medical Council',      size: 98638 },

  // Registered with the national council directly, not a state one.
  { id: 46, name: 'Medical Council of India',         size: 52413 },

  // Superseded, still populated.
  { id: 50, name: 'Travancore Cochin Medical Council, Trivandrum', size: 67147, historic: true },
  { id: 36, name: 'Madras Medical Council',           size: 17769, historic: true },
  { id: 29, name: 'Bombay Medical Council',           size: 14539, historic: true },
  { id: 45, name: 'Hyderabad Medical Council',        size: 13508, historic: true },
  { id: 37, name: 'Mysore Medical Council',           size: 8374,  historic: true },
  { id: 40, name: 'Vidharba Medical Council',         size: 1333,  historic: true },
  { id: 35, name: 'Mahakoshal Medical Council',       size: 32,    historic: true },
  { id: 28, name: 'Bhopal Medical Council',           size: 5,     historic: true },
]

export const councilById = (id: number): Council | undefined =>
  COUNCILS.find(c => c.id === id)

/**
 * Placeholder for the registration number field, per council.
 *
 * Most councils store bare digits, but a handful prefix them and the prefix is
 * part of the real value — a Delhi doctor's number genuinely is `DMC/R/24970`.
 * Showing one generic example would be wrong for those, and a doctor who trims
 * their prefix to match it makes the number harder to find, not easier.
 */
export function regNumberPlaceholder(smcId: number | null): string {
  switch (smcId) {
    case 6:  return 'e.g. DMC/R/24970'
    case 43: return 'e.g. TSMC/FMR/15376'
    case 8:  return 'e.g. G-27776'
    case 1:  return 'e.g. APMC/FMR/127776'
    default: return 'e.g. 27776'
  }
}
