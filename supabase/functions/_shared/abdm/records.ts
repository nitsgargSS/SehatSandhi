// Loads one of our records and turns it into its ABDM FHIR bundle — 0287.
//
// Takes a Supabase client with the service key (the gateway function's own;
// a test script's in Node). Reads only, and only the record asked for.

import {
  prescriptionBundle, opConsultBundle, diagnosticReportBundle, dischargeSummaryBundle,
  type FhirOrg, type FhirDoctor, type FhirPatient, type RxItem,
} from './fhir.ts'

// The few calls used, so this file needs no Supabase import of its own.
// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any }

export type RecordKind = 'opd_visit' | 'prescription' | 'lab_report' | 'discharge_summary'

async function one<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await q
  if (error) throw new Error(`${what}: ${error.message}`)
  if (!data) throw new Error(`${what}: not found`)
  return data
}
async function many<T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new Error(`${what}: ${error.message}`)
  return data ?? []
}

async function org(db: Db, businessId: string): Promise<FhirOrg> {
  const b = await one<{ id: string; name: string; phone: string | null; address: string | null; hfr_id: string | null }>(
    db.from('businesses').select('id, name, phone, address, hfr_id').eq('id', businessId).maybeSingle(), 'clinic')
  return { id: b.id, name: b.name, phone: b.phone, address: b.address, hfrId: b.hfr_id }
}

async function doctor(db: Db, practitionerId: string | null, fallbackName: string | null, fallbackId: string): Promise<FhirDoctor> {
  if (practitionerId) {
    const p = await one<{ id: string; full_name: string; hpr_id: string | null; reg_number: string | null; qualification: string | null }>(
      db.from('practitioners').select('id, full_name, hpr_id, reg_number, qualification').eq('id', practitionerId).maybeSingle(), 'doctor')
    return { id: p.id, name: p.full_name, hprId: p.hpr_id, regNumber: p.reg_number, qualification: p.qualification }
  }
  // A lab report approved by someone not on the roster: their name, as printed.
  return { id: fallbackId, name: fallbackName || 'Doctor' }
}

async function patient(db: Db, businessId: string, memberId: string): Promise<FhirPatient> {
  const m = await one<{ id: string; full_name: string; gender: string | null; date_of_birth: string | null; abha_number: string | null; abha_address: string | null; patients: { phone: string | null } | null }>(
    db.from('patient_members').select('id, full_name, gender, date_of_birth, abha_number, abha_address, patients(phone)').eq('id', memberId).maybeSingle(), 'patient')
  const bp = await db.from('business_patients').select('mrn').eq('business_id', businessId).eq('patient_member_id', memberId).maybeSingle()
  return {
    id: m.id, name: m.full_name, gender: m.gender, birthDate: m.date_of_birth,
    phone: m.patients?.phone ?? null, abhaNumber: m.abha_number, abhaAddress: m.abha_address,
    mrn: (bp.data as { mrn: string | null } | null)?.mrn ?? null,
  }
}

type ItemRow = { drug_name: string; strength: string | null; form: string | null; dosage: string | null; duration: string | null; quantity: string | null; instructions: string | null }
const rxItems = (rows: ItemRow[]): RxItem[] => rows.map(i => ({
  name: i.drug_name, strength: i.strength, form: i.form, dosage: i.dosage, duration: i.duration, quantity: i.quantity, instructions: i.instructions,
}))
const itemsOf = (db: Db, prescriptionId: string) => many<ItemRow>(
  db.from('prescription_items').select('drug_name, strength, form, dosage, duration, quantity, instructions').eq('prescription_id', prescriptionId).order('sort_order'), 'medicines')

type RxRow = { id: string; prescription_no: string; business_id: string; practitioner_id: string; patient_member_id: string; issued_at: string; diagnosis: string | null; advice: string | null; follow_up_date: string | null; status: string }

/** One record of a clinic as its FHIR bundle. Refuses another clinic's record or a cancelled one. */
export async function recordBundle(db: Db, businessId: string, kind: RecordKind, id: string): Promise<Record<string, unknown>> {
  if (kind === 'prescription') {
    const rx = await one<RxRow>(db.from('prescriptions').select('*').eq('id', id).eq('business_id', businessId).maybeSingle(), 'prescription')
    if (rx.status === 'cancelled') throw new Error('prescription: cancelled')
    const [items, o, d, p] = await Promise.all([itemsOf(db, rx.id), org(db, businessId), doctor(db, rx.practitioner_id, null, rx.id), patient(db, businessId, rx.patient_member_id)])
    return prescriptionBundle({ id: rx.id, number: rx.prescription_no, issuedAt: rx.issued_at, diagnosis: rx.diagnosis, advice: rx.advice, followUpDate: rx.follow_up_date, items: rxItems(items) },
      { patient: p, doctor: d, org: o })
  }

  if (kind === 'opd_visit') {
    const v = await one<{ id: string; patient_member_id: string; practitioner_id: string | null; doctor_seen: string | null; visit_date: string | null; created_at: string; chief_complaint: string | null; diagnosis: string | null; icd10_code: string | null; advice: string | null; follow_up_due: string | null }>(
      db.from('patient_visits').select('id, patient_member_id, practitioner_id, doctor_seen, visit_date, created_at, chief_complaint, diagnosis, icd10_code, advice, follow_up_due').eq('id', id).eq('business_id', businessId).maybeSingle(), 'visit')
    const [vitals, allergies, rxs, o, d, p] = await Promise.all([
      many<{ recorded_at: string; bp_systolic: number | null; bp_diastolic: number | null; pulse: number | null; temperature_c: number | null; weight_kg: number | null; height_cm: number | null; spo2: number | null; blood_sugar_mg_dl: number | null; blood_sugar_type: string | null }>(
        db.from('patient_vitals').select('recorded_at, bp_systolic, bp_diastolic, pulse, temperature_c, weight_kg, height_cm, spo2, blood_sugar_mg_dl, blood_sugar_type').eq('visit_id', v.id).order('recorded_at'), 'vitals'),
      many<{ substance: string }>(db.from('patient_allergies').select('substance').eq('patient_member_id', v.patient_member_id).eq('business_id', businessId).eq('is_active', true), 'allergies'),
      many<RxRow>(db.from('prescriptions').select('*').eq('visit_id', v.id).eq('business_id', businessId).eq('status', 'issued').order('issued_at', { ascending: false }).limit(1), 'prescription'),
      org(db, businessId), doctor(db, v.practitioner_id, v.doctor_seen, v.id), patient(db, businessId, v.patient_member_id),
    ])
    const rx = rxs[0]
    return opConsultBundle({
      id: v.id, date: v.visit_date ?? v.created_at,
      chiefComplaint: v.chief_complaint, diagnosis: v.diagnosis, icd10: v.icd10_code, advice: v.advice, followUpDue: v.follow_up_due,
      vitals: vitals.map(x => ({ recordedAt: x.recorded_at, bpSystolic: x.bp_systolic, bpDiastolic: x.bp_diastolic, pulse: x.pulse, temperatureC: x.temperature_c,
        weightKg: x.weight_kg, heightCm: x.height_cm, spo2: x.spo2, bloodSugar: x.blood_sugar_mg_dl, bloodSugarType: x.blood_sugar_type })),
      allergies: allergies.map(a => a.substance),
      prescription: rx ? { id: rx.id, number: rx.prescription_no, issuedAt: rx.issued_at, items: rxItems(await itemsOf(db, rx.id)) } : null,
    }, { patient: p, doctor: d, org: o })
  }

  if (kind === 'lab_report') {
    const r = await one<{ id: string; order_id: string; report_no: string; approved_at: string; approved_by: string | null; approved_by_name: string | null }>(
      db.from('lab_reports').select('id, order_id, report_no, approved_at, approved_by, approved_by_name').eq('id', id).eq('business_id', businessId).maybeSingle(), 'lab report')
    const order = await one<{ id: string; patient_member_id: string; collected_at: string | null; status: string }>(
      db.from('lab_orders').select('id, patient_member_id, collected_at, status').eq('id', r.order_id).maybeSingle(), 'lab order')
    if (order.status === 'cancelled') throw new Error('lab report: order cancelled')
    const items = await many<{ id: string; name: string; category: string | null }>(
      db.from('lab_order_items').select('id, name, category').eq('order_id', order.id).order('sort_order'), 'tests')
    const results = items.length ? await many<{ order_item_id: string; name: string; unit: string | null; value_num: number | null; value_text: string | null; ref_low: number | null; ref_high: number | null; ref_text: string | null; flag: string | null }>(
      db.from('lab_results').select('order_item_id, name, unit, value_num, value_text, ref_low, ref_high, ref_text, flag').in('order_item_id', items.map(i => i.id)).order('sort_order'), 'results') : []
    const [o, d, p] = await Promise.all([org(db, businessId), doctor(db, r.approved_by, r.approved_by_name, r.id), patient(db, businessId, order.patient_member_id)])
    return diagnosticReportBundle({
      id: r.id, number: r.report_no, approvedAt: r.approved_at, collectedAt: order.collected_at,
      tests: items.map(i => ({
        name: i.name, category: i.category,
        results: results.filter(x => x.order_item_id === i.id).map(x => ({ name: x.name, unit: x.unit, valueNum: x.value_num, valueText: x.value_text, refLow: x.ref_low, refHigh: x.ref_high, refText: x.ref_text, flag: x.flag })),
      })).filter(t => t.results.length),
    }, { patient: p, doctor: d, org: o })
  }

  // discharge_summary
  const s = await one<{ id: string; summary_no: string; patient_member_id: string; practitioner_id: string; status: string; issued_at: string; admitted_at: string | null; discharged_at: string | null; admitting_diagnosis: string | null; discharge_diagnosis: string | null; condition_on_discharge: string | null; course_in_hospital: string | null; investigations: string | null; procedures: string | null; advice: string | null; diet_advice: string | null; activity_advice: string | null; warning_signs: string | null; follow_up_date: string | null; follow_up_with: string | null; prescription_id: string | null }>(
    db.from('discharge_summaries').select('*').eq('id', id).eq('business_id', businessId).maybeSingle(), 'discharge summary')
  if (s.status === 'cancelled') throw new Error('discharge summary: cancelled')
  const [items, o, d, p] = await Promise.all([
    s.prescription_id ? itemsOf(db, s.prescription_id) : Promise.resolve([] as ItemRow[]),
    org(db, businessId), doctor(db, s.practitioner_id, null, s.id), patient(db, businessId, s.patient_member_id),
  ])
  return dischargeSummaryBundle({
    id: s.id, number: s.summary_no, issuedAt: s.issued_at, admittedAt: s.admitted_at, dischargedAt: s.discharged_at,
    admittingDiagnosis: s.admitting_diagnosis, dischargeDiagnosis: s.discharge_diagnosis, conditionOnDischarge: s.condition_on_discharge,
    courseInHospital: s.course_in_hospital, investigations: s.investigations, procedures: s.procedures,
    advice: s.advice, dietAdvice: s.diet_advice, activityAdvice: s.activity_advice, warningSigns: s.warning_signs,
    followUpDate: s.follow_up_date, followUpWith: s.follow_up_with, medications: rxItems(items),
  }, { patient: p, doctor: d, org: o })
}
