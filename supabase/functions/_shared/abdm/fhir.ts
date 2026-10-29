// ABDM records as FHIR — 0287.
//
// ABDM moves health records between hospitals as FHIR R4 "document" bundles,
// in the shapes India's NRCeS publishes (https://nrces.in/ndhm/fhir/r4/).
// Each bundle is one record: a Composition first (what kind of record, who,
// when, and its sections), then every resource it points at.
//
// Pure functions, no imports, so the gateway function (Deno) and a test script
// (Node) both use them. They take our own rows, already loaded (records.ts), and
// return plain JSON.
//
// The SNOMED and LOINC codes are kept together in CODES so that whatever the
// ABDM sandbox's validator asks us to change is changed in one place.

// ── What the builders take ──────────────────────────────────────────────────

export interface FhirOrg { id: string; name: string; hfrId?: string | null; phone?: string | null; address?: string | null }
export interface FhirDoctor { id: string; name: string; hprId?: string | null; regNumber?: string | null; qualification?: string | null }
export interface FhirPatient {
  id: string; name: string; gender?: string | null; birthDate?: string | null
  phone?: string | null; abhaNumber?: string | null; abhaAddress?: string | null; mrn?: string | null
}

export interface RxItem { name: string; strength?: string | null; form?: string | null; dosage?: string | null; duration?: string | null; quantity?: string | null; instructions?: string | null }
export interface Prescription {
  id: string; number: string; issuedAt: string
  diagnosis?: string | null; advice?: string | null; followUpDate?: string | null
  items: RxItem[]
}

export interface Vitals {
  recordedAt: string
  bpSystolic?: number | null; bpDiastolic?: number | null; pulse?: number | null
  temperatureC?: number | null; weightKg?: number | null; heightCm?: number | null
  spo2?: number | null; bloodSugar?: number | null; bloodSugarType?: string | null
}
export interface OpVisit {
  id: string; date: string
  chiefComplaint?: string | null; diagnosis?: string | null; icd10?: string | null
  advice?: string | null; followUpDue?: string | null
  vitals: Vitals[]; allergies: string[]
  prescription?: Prescription | null
}

export interface LabResult {
  name: string; unit?: string | null; valueNum?: number | null; valueText?: string | null
  refLow?: number | null; refHigh?: number | null; refText?: string | null; flag?: string | null
}
export interface LabTest { name: string; category?: string | null; results: LabResult[] }
export interface LabReport { id: string; number: string; approvedAt: string; collectedAt?: string | null; tests: LabTest[] }

export interface DischargeSummary {
  id: string; number: string; issuedAt: string
  admittedAt?: string | null; dischargedAt?: string | null
  admittingDiagnosis?: string | null; dischargeDiagnosis?: string | null
  conditionOnDischarge?: string | null; courseInHospital?: string | null
  investigations?: string | null; procedures?: string | null
  advice?: string | null; dietAdvice?: string | null; activityAdvice?: string | null
  warningSigns?: string | null; followUpDate?: string | null; followUpWith?: string | null
  medications: RxItem[]
}

// ── Codes ───────────────────────────────────────────────────────────────────

const SCT = 'http://snomed.info/sct'
const LOINC = 'http://loinc.org'
const NRCES = 'https://nrces.in/ndhm/fhir/r4/StructureDefinition/'

export const CODES = {
  record: {
    prescription: { code: '440545006', display: 'Prescription record', profile: 'PrescriptionRecord' },
    opConsult: { code: '371530004', display: 'Clinical consultation report', profile: 'OPConsultRecord' },
    diagnosticReport: { code: '721981007', display: 'Diagnostic studies report', profile: 'DiagnosticReportRecord' },
    dischargeSummary: { code: '373942005', display: 'Discharge summary', profile: 'DischargeSummaryRecord' },
  },
  section: {
    chiefComplaint: { code: '422843007', display: 'Chief complaint section' },
    allergies: { code: '722446000', display: 'Allergy record' },
    examination: { code: '425044008', display: 'Physical exam section' },
    medications: { code: '721912009', display: 'Medication summary document' },
    followUp: { code: '736271009', display: 'Outpatient care plan' },
    investigations: { code: '721981007', display: 'Diagnostic studies report' },
    procedures: { code: '1003640003', display: 'History of past procedure section' },
    carePlan: { code: '734163000', display: 'Care plan' },
    history: { code: '371529009', display: 'History and physical report' },
  },
  // LOINC vital signs.
  vital: {
    bp: { code: '85354-9', display: 'Blood pressure panel' },
    systolic: { code: '8480-6', display: 'Systolic blood pressure' },
    diastolic: { code: '8462-4', display: 'Diastolic blood pressure' },
    pulse: { code: '8867-4', display: 'Heart rate' },
    temperature: { code: '8310-5', display: 'Body temperature' },
    weight: { code: '29463-7', display: 'Body weight' },
    height: { code: '8302-2', display: 'Body height' },
    spo2: { code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry' },
    glucose: { code: '2339-0', display: 'Glucose [Mass/volume] in Blood' },
  },
} as const

// ── Small helpers ───────────────────────────────────────────────────────────

type Res = Record<string, unknown> & { resourceType: string; id: string }
type Ref = { reference: string; display?: string }

const ref = (r: Res, display?: string): Ref => ({ reference: `urn:uuid:${r.id}`, ...(display ? { display } : {}) })
const sct = (c: { code: string; display: string }, text?: string) => ({ coding: [{ system: SCT, code: c.code, display: c.display }], text: text ?? c.display })
const loinc = (c: { code: string; display: string }) => ({ coding: [{ system: LOINC, code: c.code, display: c.display }], text: c.display })
const meta = (profile: string, lastUpdated?: string) => ({ profile: [NRCES + profile], ...(lastUpdated ? { lastUpdated } : {}) })
const clean = (s?: string | null) => (s ?? '').trim()

// FHIR wants a full instant; our dates are sometimes only a date.
const instant = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00+05:30` : new Date(s).toISOString()

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Free text a doctor wrote, kept as the section's narrative, line breaks and all.
const narrative = (s: string) => ({
  status: 'generated',
  div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXml(s).split(/\r?\n/).map(l => `<p>${l}</p>`).join('')}</div>`,
})

// Ids: our own uuids where a row has one, otherwise one made from the parent's
// id and a counter — stable, so the same record always makes the same bundle.
const childId = (parent: string, n: number) => {
  const hex = n.toString(16).padStart(12, '0')
  return `${parent.slice(0, 24)}${hex}`
}

const hl7 = (system: string, code: string, display: string) => ({ coding: [{ system, code, display }] })
const V2_0203 = 'http://terminology.hl7.org/CodeSystem/v2-0203'

// ── The people and the place ────────────────────────────────────────────────

export function patientResource(p: FhirPatient): Res {
  const identifier: unknown[] = []
  if (p.mrn) identifier.push({ type: hl7(V2_0203, 'MR', 'Medical record number'), system: 'https://sehatsandhi.com/mrn', value: p.mrn })
  if (p.abhaNumber) identifier.push({ type: hl7(V2_0203, 'MR', 'Medical record number'), system: 'https://healthid.abdm.gov.in', value: p.abhaNumber })
  return {
    resourceType: 'Patient', id: p.id, meta: meta('Patient'),
    ...(identifier.length ? { identifier } : {}),
    name: [{ text: p.name }],
    ...(p.phone ? { telecom: [{ system: 'phone', value: p.phone, use: 'mobile' }] } : {}),
    ...(p.gender ? { gender: p.gender === 'male' || p.gender === 'female' ? p.gender : 'other' } : {}),
    ...(p.birthDate ? { birthDate: p.birthDate } : {}),
  }
}

export function practitionerResource(d: FhirDoctor): Res {
  const id = d.hprId ?? d.regNumber
  return {
    resourceType: 'Practitioner', id: d.id, meta: meta('Practitioner'),
    ...(id ? { identifier: [{ type: hl7(V2_0203, 'MD', 'Medical License number'), system: 'https://doctor.ndhm.gov.in', value: id }] } : {}),
    name: [{ text: d.name }],
    ...(d.qualification ? { qualification: [{ code: { text: d.qualification } }] } : {}),
  }
}

export function organizationResource(o: FhirOrg): Res {
  return {
    resourceType: 'Organization', id: o.id, meta: meta('Organization'),
    ...(o.hfrId ? { identifier: [{ type: hl7(V2_0203, 'PRN', 'Provider number'), system: 'https://facility.ndhm.gov.in', value: o.hfrId }] } : {}),
    name: o.name,
    ...(o.phone ? { telecom: [{ system: 'phone', value: o.phone, use: 'work' }] } : {}),
    ...(o.address ? { address: [{ text: o.address }] } : {}),
  }
}

// ── Pieces of a record ──────────────────────────────────────────────────────

function medicationRequests(items: RxItem[], baseId: string, patient: Res, doctor: Res, authoredOn: string, reason?: Res): Res[] {
  return items.filter(i => clean(i.name)).map((i, n) => {
    const name = [i.name, i.strength, i.form].map(clean).filter(Boolean).join(' ')
    const text = [i.dosage, i.duration && `for ${clean(i.duration)}`, i.quantity && `(${clean(i.quantity)})`].map(x => clean(x || '')).filter(Boolean).join(' ')
    return {
      resourceType: 'MedicationRequest', id: childId(baseId, 0x100 + n), meta: meta('MedicationRequest'),
      status: 'active', intent: 'order',
      medicationCodeableConcept: { text: name },
      subject: ref(patient), authoredOn: instant(authoredOn), requester: ref(doctor),
      ...(reason ? { reasonReference: [ref(reason)] } : {}),
      dosageInstruction: [{
        text: text || clean(i.instructions) || name,
        ...(clean(i.instructions) ? { additionalInstruction: [{ text: clean(i.instructions) }] } : {}),
      }],
    }
  })
}

function condition(text: string, id: string, patient: Res, icd10?: string | null): Res {
  return {
    resourceType: 'Condition', id, meta: meta('Condition'),
    code: icd10
      ? { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: icd10 }], text }
      : { text },
    subject: ref(patient),
  }
}

// Ids for a set of children: the parent's id, numbered from `base`.
function vitalObservations(v: Vitals, parentId: string, base: number, patient: Res): Res[] {
  const at = instant(v.recordedAt)
  const out: Res[] = []
  let n = base
  const q = (value: number, unit: string, ucum: string) => ({ value, unit, system: 'http://unitsofmeasure.org', code: ucum })
  const obs = (c: { code: string; display: string }, value: unknown): Res => ({
    resourceType: 'Observation', id: childId(parentId, n++), meta: meta('ObservationVitalSigns'),
    status: 'final',
    category: [hl7('http://terminology.hl7.org/CodeSystem/observation-category', 'vital-signs', 'Vital Signs')],
    code: loinc(c), subject: ref(patient), effectiveDateTime: at, ...value as object,
  })
  if (v.bpSystolic != null && v.bpDiastolic != null) {
    out.push(obs(CODES.vital.bp, {
      component: [
        { code: loinc(CODES.vital.systolic), valueQuantity: q(v.bpSystolic, 'mmHg', 'mm[Hg]') },
        { code: loinc(CODES.vital.diastolic), valueQuantity: q(v.bpDiastolic, 'mmHg', 'mm[Hg]') },
      ],
    }))
  }
  if (v.pulse != null) out.push(obs(CODES.vital.pulse, { valueQuantity: q(v.pulse, 'beats/minute', '/min') }))
  if (v.temperatureC != null) out.push(obs(CODES.vital.temperature, { valueQuantity: q(Number(v.temperatureC), '°C', 'Cel') }))
  if (v.weightKg != null) out.push(obs(CODES.vital.weight, { valueQuantity: q(Number(v.weightKg), 'kg', 'kg') }))
  if (v.heightCm != null) out.push(obs(CODES.vital.height, { valueQuantity: q(Number(v.heightCm), 'cm', 'cm') }))
  if (v.spo2 != null) out.push(obs(CODES.vital.spo2, { valueQuantity: q(v.spo2, '%', '%') }))
  if (v.bloodSugar != null) out.push(obs(CODES.vital.glucose, {
    valueQuantity: q(v.bloodSugar, 'mg/dL', 'mg/dL'),
    ...(v.bloodSugarType ? { note: [{ text: v.bloodSugarType }] } : {}),
  }))
  return out
}

function labObservations(t: LabTest, parentId: string, base: number, patient: Res, at: string): Res[] {
  return t.results.map((r, n) => {
    const value = r.valueNum != null
      ? { valueQuantity: { value: Number(r.valueNum), ...(r.unit ? { unit: r.unit } : {}) } }
      : { valueString: clean(r.valueText) || '—' }
    const range = (r.refLow != null || r.refHigh != null || r.refText)
      ? [{
          ...(r.refLow != null ? { low: { value: Number(r.refLow), ...(r.unit ? { unit: r.unit } : {}) } } : {}),
          ...(r.refHigh != null ? { high: { value: Number(r.refHigh), ...(r.unit ? { unit: r.unit } : {}) } } : {}),
          ...(r.refText ? { text: r.refText } : {}),
        }]
      : undefined
    const flag = r.flag === 'H' ? ['H', 'High'] : r.flag === 'L' ? ['L', 'Low'] : r.flag === 'N' ? ['N', 'Normal'] : null
    return {
      resourceType: 'Observation', id: childId(parentId, base + n), meta: meta('Observation'),
      status: 'final', code: { text: r.name }, subject: ref(patient), effectiveDateTime: instant(at),
      ...value,
      ...(range ? { referenceRange: range } : {}),
      ...(flag ? { interpretation: [hl7('http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', flag[0], flag[1])] } : {}),
    }
  })
}

// ── The bundle around a record ──────────────────────────────────────────────

interface Section { title: string; code: { code: string; display: string }; entries?: Res[]; text?: string }

function documentBundle(opts: {
  id: string; kind: keyof typeof CODES.record; title: string; date: string
  patient: Res; doctor: Res; org: Res; encounter?: Res
  sections: Section[]; extra?: Res[]
}): Record<string, unknown> {
  const rec = CODES.record[opts.kind]
  const date = instant(opts.date)
  const sections = opts.sections
    .filter(s => (s.entries && s.entries.length) || clean(s.text))
    .map(s => ({
      title: s.title, code: sct(s.code),
      ...(s.entries && s.entries.length ? { entry: s.entries.map(e => ref(e)) } : {}),
      ...(clean(s.text) ? { text: narrative(clean(s.text)) } : {}),
    }))
  const composition: Res = {
    resourceType: 'Composition', id: childId(opts.id, 0xC0), meta: meta(rec.profile, date),
    identifier: { system: 'https://sehatsandhi.com/records', value: opts.id },
    status: 'final', type: sct(rec), title: opts.title, date,
    subject: ref(opts.patient), author: [ref(opts.doctor)], custodian: ref(opts.org),
    ...(opts.encounter ? { encounter: ref(opts.encounter) } : {}),
    section: sections,
  }
  // Every resource once, in a fixed order: the composition, the people, the
  // place, then everything the sections point at.
  const seen = new Set<string>()
  const all = [composition, opts.patient, opts.doctor, opts.org, ...(opts.encounter ? [opts.encounter] : []),
               ...opts.sections.flatMap(s => s.entries ?? []), ...(opts.extra ?? [])]
    .filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  return {
    resourceType: 'Bundle', id: opts.id,
    meta: {
      versionId: '1', lastUpdated: date, profile: [NRCES + 'DocumentBundle'],
      security: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'V', display: 'very restricted' }],
    },
    identifier: { system: 'http://hip.in', value: opts.id },
    type: 'document', timestamp: date,
    entry: all.map(r => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })),
  }
}

function encounter(id: string, cls: 'AMB' | 'IMP', patient: Res, start: string, end?: string | null): Res {
  return {
    resourceType: 'Encounter', id, meta: meta('Encounter'), status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: cls, display: cls === 'AMB' ? 'ambulatory' : 'inpatient encounter' },
    subject: ref(patient), period: { start: instant(start), ...(end ? { end: instant(end) } : {}) },
  }
}

// ── The four records ────────────────────────────────────────────────────────

export function prescriptionBundle(rx: Prescription, who: { patient: FhirPatient; doctor: FhirDoctor; org: FhirOrg }) {
  const patient = patientResource(who.patient), doctor = practitionerResource(who.doctor), org = organizationResource(who.org)
  const dx = clean(rx.diagnosis) ? condition(clean(rx.diagnosis), childId(rx.id, 0xD0), patient) : undefined
  const meds = medicationRequests(rx.items, rx.id, patient, doctor, rx.issuedAt, dx)
  const followUp = [clean(rx.advice), rx.followUpDate ? `Follow up on ${rx.followUpDate}.` : ''].filter(Boolean).join('\n')
  return documentBundle({
    id: rx.id, kind: 'prescription', title: `Prescription ${rx.number}`, date: rx.issuedAt,
    patient, doctor, org,
    sections: [
      { title: 'Prescription', code: CODES.record.prescription, entries: meds },
      { title: 'Advice', code: CODES.section.followUp, text: followUp },
    ],
    extra: dx ? [dx] : [],
  })
}

export function opConsultBundle(v: OpVisit, who: { patient: FhirPatient; doctor: FhirDoctor; org: FhirOrg }) {
  const patient = patientResource(who.patient), doctor = practitionerResource(who.doctor), org = organizationResource(who.org)
  const enc = encounter(childId(v.id, 0xE0), 'AMB', patient, v.date)
  const complaint = clean(v.chiefComplaint) ? condition(clean(v.chiefComplaint), childId(v.id, 0xD1), patient) : undefined
  const dx = clean(v.diagnosis) ? condition(clean(v.diagnosis), childId(v.id, 0xD2), patient, v.icd10) : undefined
  const vitals = v.vitals.flatMap((x, i) => vitalObservations(x, v.id, 0x1000 * (i + 1), patient))
  const allergies: Res[] = v.allergies.filter(a => clean(a)).map((a, i) => ({
    resourceType: 'AllergyIntolerance', id: childId(v.id, 0x300 + i), meta: meta('AllergyIntolerance'),
    clinicalStatus: hl7('http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', 'active', 'Active'),
    code: { text: a }, patient: ref(patient),
  }))
  const meds = v.prescription ? medicationRequests(v.prescription.items, v.prescription.id, patient, doctor, v.prescription.issuedAt, dx) : []
  const plan = [clean(v.advice), v.followUpDue ? `Follow up on ${v.followUpDue}.` : ''].filter(Boolean).join('\n')
  return documentBundle({
    id: v.id, kind: 'opConsult', title: 'OPD consultation', date: v.date,
    patient, doctor, org, encounter: enc,
    sections: [
      { title: 'Chief complaints', code: CODES.section.chiefComplaint, entries: complaint ? [complaint] : [] },
      { title: 'Allergies', code: CODES.section.allergies, entries: allergies },
      { title: 'Examination', code: CODES.section.examination, entries: vitals },
      { title: 'Diagnosis', code: CODES.section.history, entries: dx ? [dx] : [] },
      { title: 'Medications', code: CODES.section.medications, entries: meds },
      { title: 'Advice and follow-up', code: CODES.section.followUp, text: plan },
    ],
  })
}

export function diagnosticReportBundle(r: LabReport, who: { patient: FhirPatient; doctor: FhirDoctor; org: FhirOrg }) {
  const patient = patientResource(who.patient), doctor = practitionerResource(who.doctor), org = organizationResource(who.org)
  const at = r.collectedAt ?? r.approvedAt
  const reports: Res[] = []
  const observations: Res[] = []
  r.tests.forEach((t, i) => {
    const obs = labObservations(t, r.id, 0x10000 * (i + 1), patient, at)
    observations.push(...obs)
    reports.push({
      resourceType: 'DiagnosticReport', id: childId(r.id, 0x400 + i), meta: meta('DiagnosticReportLab'),
      status: 'final',
      ...(t.category ? { category: [{ text: t.category }] } : {}),
      code: { text: t.name }, subject: ref(patient),
      effectiveDateTime: instant(at), issued: instant(r.approvedAt),
      performer: [ref(org)], resultsInterpreter: [ref(doctor)],
      result: obs.map(o => ref(o)),
    })
  })
  return documentBundle({
    id: r.id, kind: 'diagnosticReport', title: `Lab report ${r.number}`, date: r.approvedAt,
    patient, doctor, org,
    sections: [{ title: 'Lab results', code: CODES.record.diagnosticReport, entries: reports }],
    extra: observations,
  })
}

export function dischargeSummaryBundle(d: DischargeSummary, who: { patient: FhirPatient; doctor: FhirDoctor; org: FhirOrg }) {
  const patient = patientResource(who.patient), doctor = practitionerResource(who.doctor), org = organizationResource(who.org)
  const enc = encounter(childId(d.id, 0xE0), 'IMP', patient, d.admittedAt ?? d.issuedAt, d.dischargedAt)
  const admitting = clean(d.admittingDiagnosis) ? condition(clean(d.admittingDiagnosis), childId(d.id, 0xD1), patient) : undefined
  const final = clean(d.dischargeDiagnosis) ? condition(clean(d.dischargeDiagnosis), childId(d.id, 0xD2), patient) : undefined
  const meds = medicationRequests(d.medications, d.id, patient, doctor, d.issuedAt, final)
  const lines = (pairs: [string, string | null | undefined][]) =>
    pairs.filter(([, v]) => clean(v)).map(([k, v]) => `${k}: ${clean(v)}`).join('\n')
  return documentBundle({
    id: d.id, kind: 'dischargeSummary', title: `Discharge summary ${d.number}`, date: d.issuedAt,
    patient, doctor, org, encounter: enc,
    sections: [
      { title: 'Reason for admission', code: CODES.section.chiefComplaint, entries: admitting ? [admitting] : [] },
      { title: 'Course in hospital', code: CODES.section.history,
        entries: final ? [final] : [],
        text: lines([['Course in hospital', d.courseInHospital], ['Condition on discharge', d.conditionOnDischarge]]) },
      { title: 'Investigations', code: CODES.section.investigations, text: d.investigations },
      { title: 'Procedures', code: CODES.section.procedures, text: d.procedures },
      { title: 'Medications', code: CODES.section.medications, entries: meds },
      { title: 'Care plan', code: CODES.section.carePlan,
        text: lines([['Advice', d.advice], ['Diet', d.dietAdvice], ['Activity', d.activityAdvice], ['Come back at once if', d.warningSigns],
                     ['Follow up', [d.followUpDate, d.followUpWith].filter(Boolean).join(' with ')]]) },
    ],
  })
}

// ── A check of our own, before ABDM's validator ─────────────────────────────
// Every reference in a bundle must point at an entry in it, and every id must
// be unique. Returns what is wrong; an empty list is a well-formed bundle.
export function bundleProblems(bundle: Record<string, unknown>): string[] {
  const entries = (bundle.entry as { fullUrl: string; resource: Res }[]) ?? []
  const urls = new Set<string>()
  const problems: string[] = []
  for (const e of entries) {
    if (urls.has(e.fullUrl)) problems.push(`duplicate ${e.fullUrl}`)
    urls.add(e.fullUrl)
  }
  if (entries[0]?.resource.resourceType !== 'Composition') problems.push('first entry is not the Composition')
  const walk = (x: unknown, path: string) => {
    if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`))
    else if (x && typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) {
        if (k === 'reference' && typeof v === 'string' && !urls.has(v)) problems.push(`${path}.reference → ${v} is not in the bundle`)
        else walk(v, `${path}.${k}`)
      }
    }
  }
  entries.forEach(e => walk(e.resource, `${e.resource.resourceType}/${e.resource.id}`))
  return problems
}
