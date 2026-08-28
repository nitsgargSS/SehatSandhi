#!/usr/bin/env node
// test-suite — exercise the clinical units against a live database, as every role.
//
// Why this exists: almost nothing here had ever been run. The schema is large
// (122 functions, 84 tables, 49 views) and typechecks say nothing about SQL, so
// the only way to know whether a unit works is to make it work on real rows and
// look at what came out. Every assertion below was written by reading what the
// function claims to do, then checking it does that — and refuses when the
// caller is wrong.
//
//   node scripts/test-suite.mjs --env sandbox
//   node scripts/test-suite.mjs --env sandbox --only ipd,billing
//   node scripts/test-suite.mjs --env sandbox --keep      (default: keeps data)
//
// It writes rows. Everything it creates is prefixed [TEST] and left in place,
// so a failure can be opened in the dashboard and looked at. Run against
// sandbox. It refuses to run against prod unless --i-mean-it.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(ROOT, '.env.supabase'), quiet: true })

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1] }
const has = (n) => argv.includes(`--${n}`)
const env = flag('env') ?? 'sandbox'
if (env === 'prod' && !has('i-mean-it')) {
  console.error('refusing to write test rows into prod. --i-mean-it if you really mean it.')
  process.exit(1)
}
const only = flag('only') ? new Set(flag('only').split(',')) : null

const url = env === 'prod' ? process.env.SUPABASE_DB_URL_PROD : process.env.SUPABASE_DB_URL_SANDBOX
const db = new pg.Client({ connectionString: url, keepAlive: true })
await db.connect()

// ── the tiny harness ────────────────────────────────────────────────────────
const results = []
let section = ''
const sec = (name) => { section = name }
const skip = () => only && !only.has(section)

function record(name, ok, detail) {
  results.push({ section, name, ok, detail })
  const mark = ok === true ? '  ok  ' : ok === 'warn' ? ' warn ' : ' FAIL '
  console.log(`${mark} ${section} · ${name}${detail ? `\n         ${detail}` : ''}`)
}

/** Assert a promise resolves (allow) or rejects (deny). */
async function expectAllow(name, fn) {
  if (skip()) return
  try { const v = await fn(); record(name, true); return v }
  catch (e) { record(name, false, `expected to succeed, got: ${e.message.split('\n')[0]}`) }
}
async function expectDeny(name, fn, mustMatch) {
  if (skip()) return
  try { await fn(); record(name, false, 'expected to be refused, but it succeeded') }
  catch (e) {
    const m = e.message.split('\n')[0]
    if (mustMatch && !new RegExp(mustMatch, 'i').test(m)) {
      record(name, 'warn', `refused, but for a different reason: ${m}`)
    } else record(name, true)
  }
}
function expectEq(name, actual, wanted, note) {
  if (skip()) return
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  record(name, ok, ok ? undefined : `wanted ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}${note ? ` — ${note}` : ''}`)
  return ok
}
function expectTrue(name, cond, detail) {
  if (skip()) return
  record(name, !!cond, cond ? undefined : detail)
  return !!cond
}

// ── personas ────────────────────────────────────────────────────────────────
const emails = {
  owner: 'sandbox-doctor@sehatsandhi.test',
  doctor: 'sandbox-staffdoc@sehatsandhi.test',
  nurse: 'sandbox-nurse@sehatsandhi.test',
  reception: 'sandbox-reception@sehatsandhi.test',
  manager: 'sandbox-manager@sehatsandhi.test',
  admin: 'sandbox-admin@sehatsandhi.test',
  other: 'sandbox-mehra@sehatsandhi.test',   // a different clinic entirely
}
const uid = {}
for (const [k, email] of Object.entries(emails)) {
  const r = await db.query('select id from auth.users where email = $1', [email])
  uid[k] = r.rows[0]?.id ?? null
  if (!uid[k]) console.log(`  !!   missing seeded login ${email} — its tests will fail`)
}

/** Run inside a transaction as `who`, then roll back. For permission probes. */
async function probe(who, sql, params = []) {
  await db.query('begin')
  try {
    await db.query(`set local role ${who === 'anon' ? 'anon' : 'authenticated'}`)
    await db.query(`select set_config('request.jwt.claims',$1,true)`,
      [who === 'anon' ? '' : JSON.stringify({ sub: uid[who], role: 'authenticated', email: emails[who] })])
    const r = await db.query(sql, params)
    return r.rows[0] ? Object.values(r.rows[0])[0] : null
  } finally { await db.query('rollback') }
}

/** Same, but commits. For the workflow tests, whose rows we keep. */
async function perform(who, sql, params = []) {
  await db.query('begin')
  try {
    await db.query(`set local role ${who === 'anon' ? 'anon' : 'authenticated'}`)
    await db.query(`select set_config('request.jwt.claims',$1,true)`,
      [who === 'anon' ? '' : JSON.stringify({ sub: uid[who], role: 'authenticated', email: emails[who] })])
    const r = await db.query(sql, params)
    await db.query('commit')
    return r.rows[0] ? Object.values(r.rows[0])[0] : null
  } catch (e) { await db.query('rollback'); throw e }
}

/** probe(), but a refusal returns a sentinel instead of throwing. For the
 *  places that want to report what happened rather than assert allow/deny. */
async function tryProbe(who, sql, params = []) {
  try { return await probe(who, sql, params) }
  catch (e) { return { refused: e.message.split('\n')[0] } }
}

/**
 * Read as postgres, bypassing RLS — for checking what actually landed.
 *
 * Records a failure rather than throwing. A mistyped column in one check should
 * report itself and let the other ninety run, not abort the suite on line one.
 */
const raw = async (sql, params = []) => {
  try { return (await db.query(sql, params)).rows }
  catch (e) {
    record(`query failed: ${sql.replace(/\s+/g, ' ').trim().slice(0, 70)}`, false, e.message.split('\n')[0])
    return []
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────
const BIZ = (await raw(`select id, name from businesses where name = '[SEED] Sandbox Test Clinic'`))[0]
const OTHER_BIZ = (await raw(`select id, name from businesses where name = 'Mehra Heart Clinic'`))[0]
const DOC = (await raw(`select p.id, p.full_name from practitioners p join business_practitioners bp on bp.practitioner_id=p.id
  where bp.business_id=$1 and bp.role='doctor' and p.auth_uid=$2`, [BIZ.id, uid.doctor]))[0]
const NURSE = (await raw(`select id from practitioners where auth_uid=$1`, [uid.nurse]))[0]
// The seeded fixture patient: allergic to penicillin, admitted, on a drug chart.
const SEED_MEMBER = (await raw(`select id from patient_members where full_name='[SEED] Test Patient'`))[0]
const ANY_MEMBER = (await raw(`select id from patient_members limit 1`))[0]

console.log(`\nenv=${env}  clinic="${BIZ.name}"  doctor="${DOC?.full_name}"\n`)

// A stamp so repeated runs do not collide on unique keys.
const STAMP = (await raw(`select to_char(now(),'MMDDHH24MISS') s`))[0].s
const phone = (n) => `9${String(n).padStart(9, '0')}`

// ═══════════════════════════════════════════════════════════════════════════
sec('roles')
// The whole gating model rests on sehat_caller_role. If it is wrong, every
// permission test below is meaningless, so establish it first.
for (const [who, wanted] of [['owner', 'owner'], ['doctor', 'doctor'], ['nurse', 'nurse'],
                             ['reception', 'receptionist'], ['manager', 'manager']]) {
  const got = await tryProbe(who, 'select sehat_caller_role($1)', [BIZ.id])
  expectEq(`sehat_caller_role is "${wanted}" for ${who}`, got, wanted)
}
expectEq('a different clinic gets no role here', await tryProbe('other', 'select sehat_caller_role($1)', [BIZ.id]), null)
expectEq('anon gets no role', await tryProbe('anon', 'select sehat_caller_role($1)', [BIZ.id]), null)
expectEq('sehat_is_admin true for admin', await tryProbe('admin', 'select sehat_is_admin()'), true)
expectEq('sehat_is_admin false for a doctor', await tryProbe('doctor', 'select sehat_is_admin()'), false)

// The two predicates 0067 split apart.
for (const [who, clinical, prescribe] of [
  ['owner', true, true], ['doctor', true, true], ['nurse', true, false],
  ['reception', false, false], ['manager', false, false]]) {
  expectEq(`is_clinical(${who})=${clinical}`, await tryProbe(who, 'select sehat_caller_is_clinical($1)', [BIZ.id]), clinical)
  expectEq(`may_prescribe(${who})=${prescribe}`, await tryProbe(who, 'select sehat_caller_may_prescribe($1)', [BIZ.id]), prescribe)
}

// ═══════════════════════════════════════════════════════════════════════════
sec('patients')
let memberId = null
if (!skip()) {
  memberId = await perform('reception', `select sehat_register_patient(
      p_business=>$1, p_phone=>$2, p_full_name=>$3, p_relation=>'self', p_gender=>'female',
      p_age_years=>41, p_date_of_birth=>null, p_blood_group=>'B+', p_mrn=>null, p_source=>'walk_in')`,
    [BIZ.id, phone(STAMP.slice(-9)), `[TEST] Registered ${STAMP}`]).catch(e => { record('reception can register a walk-in', false, e.message.split('\n')[0]); return null })
  if (memberId) record('reception can register a walk-in', true)
}
await expectDeny('anon cannot register a patient',
  () => probe('anon', `select sehat_register_patient(p_business=>$1, p_phone=>'9998887777',
      p_full_name=>'[TEST] Stranger', p_relation=>'self', p_gender=>null, p_age_years=>30,
      p_date_of_birth=>null, p_blood_group=>null, p_mrn=>null, p_source=>'walk_in')`, [BIZ.id]))
await expectDeny('another clinic cannot register into this one',
  () => probe('other', `select sehat_register_patient(p_business=>$1, p_phone=>'9998887776',
      p_full_name=>'[TEST] Poach', p_relation=>'self', p_gender=>null, p_age_years=>30,
      p_date_of_birth=>null, p_blood_group=>null, p_mrn=>null, p_source=>'walk_in')`, [BIZ.id]))
if (memberId) {
  const seen = await tryProbe('reception', `select count(*)::int from sehat_search_patients($1,$2)`, ['[TEST] Registered', BIZ.id])
  expectTrue('the new patient is searchable by its own clinic', seen > 0, `search returned ${seen}`)
  const cross = await tryProbe('other', `select count(*)::int from sehat_search_patients($1,$2)`, ['[TEST] Registered', BIZ.id])
  expectEq('another clinic cannot search this clinic\'s patients', cross, 0)
}

// ═══════════════════════════════════════════════════════════════════════════
sec('opd')
let tokenId = null
if (memberId && !skip()) {
  tokenId = await perform('reception', `select (sehat_issue_token(
      p_patient_member_id=>$1, p_business_id=>$2, p_practitioner_id=>$3, p_reason=>'[TEST] fever',
      p_appointment_id=>null, p_priority=>0, p_priority_reason=>null, p_created_by=>null)).id`,
    [memberId, BIZ.id, DOC.id]).catch(e => { record('reception can issue a queue token', false, e.message.split('\n')[0]); return null })
  if (tokenId) record('reception can issue a queue token', true)
}
if (tokenId) {
  const tok = (await raw('select token_number, status, business_id from opd_queue where id=$1', [tokenId]))[0]
  expectTrue('the token got a number', tok?.token_number != null, JSON.stringify(tok))
  expectEq('a fresh token is waiting', tok?.status, 'waiting')
  // call_next serves the queue in order, so it will pick the OLDEST waiting
  // token, which on a re-run is not the one this run just issued. Assert on the
  // token it actually returned — anything else tests the fixture, not the queue.
  const oldestWaiting = (await raw(`select id, token_number from opd_queue
    where business_id=$1 and queue_date=current_date and status='waiting'
    order by priority desc, token_number limit 1`, [BIZ.id]))[0]
  const called = await perform('doctor', 'select (sehat_call_next($1,$2)).id', [BIZ.id, DOC.id])
    .catch(e => { record('the doctor can call the next patient', false, e.message.split('\n')[0]); return null })
  if (called) {
    record('the doctor can call the next patient', true)
    expectEq('call_next served the longest-waiting token', called, oldestWaiting?.id)
    const after = (await raw('select status from opd_queue where id=$1', [called]))[0]
    expectTrue('the called token left the waiting list', after?.status !== 'waiting', `still ${after?.status}`)
  }
}
await expectDeny('anon cannot issue a token',
  () => probe('anon', `select sehat_issue_token(p_patient_member_id=>$1, p_business_id=>$2,
      p_practitioner_id=>null, p_reason=>'x', p_appointment_id=>null, p_priority=>0,
      p_priority_reason=>null, p_created_by=>null)`, [memberId, BIZ.id]))

// ═══════════════════════════════════════════════════════════════════════════
sec('prescribing')
// The allergy check is the safety-critical one: it must WARN, and must not block.
const warn = await tryProbe('doctor', `select count(*)::int from sehat_allergy_warning($1,'Amoxicillin')`,
  [SEED_MEMBER?.id])
expectTrue('amoxicillin raises the recorded penicillin allergy', warn > 0,
  `sehat_allergy_warning returned ${warn} rows for a patient allergic to penicillin`)
const noWarn = await tryProbe('doctor', `select count(*)::int from sehat_allergy_warning($1,'Paracetamol')`,
  [SEED_MEMBER?.id])
expectEq('paracetamol raises nothing', noWarn, 0)

let rxId = null
if (memberId && !skip()) {
  rxId = await perform('doctor', `select sehat_issue_prescription(
      p_patient_member_id=>$1, p_business_id=>$2, p_practitioner_id=>$3,
      p_items=>$4::jsonb, p_visit_id=>null, p_diagnosis=>'[TEST] viral fever',
      p_advice=>'rest', p_follow_up=>null, p_source_recording_id=>null, p_supersedes=>null)`,
    [memberId, BIZ.id, DOC.id, JSON.stringify([
      { drug_name: 'Paracetamol', strength: '500mg', form: 'tab', dose_text: '1 tab', frequency_code: 'TDS', duration_days: 3, route: 'oral' }])])
    .catch(e => { record('a doctor can issue a prescription', false, e.message.split('\n')[0]); return null })
  if (rxId) record('a doctor can issue a prescription', true)
}
await expectDeny('a nurse cannot issue a prescription',
  () => probe('nurse', `select sehat_issue_prescription(p_patient_member_id=>$1, p_business_id=>$2,
      p_practitioner_id=>$3, p_items=>'[]'::jsonb, p_visit_id=>null, p_diagnosis=>null, p_advice=>null,
      p_follow_up=>null, p_source_recording_id=>null, p_supersedes=>null)`, [memberId, BIZ.id, DOC.id]))
await expectDeny('reception cannot issue a prescription',
  () => probe('reception', `select sehat_issue_prescription(p_patient_member_id=>$1, p_business_id=>$2,
      p_practitioner_id=>$3, p_items=>'[]'::jsonb, p_visit_id=>null, p_diagnosis=>null, p_advice=>null,
      p_follow_up=>null, p_source_recording_id=>null, p_supersedes=>null)`, [memberId, BIZ.id, DOC.id]))
if (rxId) {
  const rx = (await raw('select prescription_no, status from prescriptions where id=$1', [rxId]))[0]
  expectTrue('the prescription got a number', !!rx?.prescription_no, JSON.stringify(rx))
  await expectDeny('an issued prescription cannot be edited',
    () => db.query(`update prescriptions set diagnosis='[TEST] tampered' where id=$1`, [rxId]), 'immutable|frozen|cannot')
}

// ═══════════════════════════════════════════════════════════════════════════
sec('ipd')
// Provision our own bed rather than competing for the fixture's three. Nothing
// is cleaned up between runs, so the second run would otherwise find every bed
// occupied by the first and skip the whole IPD section — a suite that silently
// stops testing twenty things is worse than one that fails.
let freeBed = (await raw(`select b.id, b.label from beds b
  where b.business_id=$1 and b.label like '[TEST]%' and b.is_active and not exists (
    select 1 from admission_bed_stays s where s.bed_id=b.id and s.to_at is null) limit 1`, [BIZ.id]))[0]
if (!freeBed) {
  const ward = (await raw(`select id from wards where business_id=$1 order by sort_order nulls last limit 1`, [BIZ.id]))[0]
  freeBed = (await raw(`insert into beds (ward_id, business_id, label, daily_charge, is_active)
    values ($1, $2, $3, 1500, true) returning id, label`, [ward?.id, BIZ.id, `[TEST] bed ${STAMP}`]))[0]
}
let admissionId = null
if (memberId && freeBed && !skip()) {
  admissionId = await perform('doctor', `select sehat_admit_patient(
      p_patient_member_id=>$1, p_business_id=>$2, p_bed_id=>$3, p_attending_practitioner_id=>$4,
      p_reason=>'[TEST] observation', p_admitting_diagnosis=>'[TEST] dehydration', p_expected_discharge=>null)`,
    [memberId, BIZ.id, freeBed.id, DOC.id]).catch(e => { record('a doctor can admit to a free bed', false, e.message.split('\n')[0]); return null })
  if (admissionId) record('a doctor can admit to a free bed', true)
} else if (!freeBed) record('a doctor can admit to a free bed', 'warn', 'no free bed in the fixture clinic')

if (admissionId) {
  const adm = (await raw('select admission_no, status from admissions where id=$1', [admissionId]))[0]
  expectTrue('the admission got a number', !!adm?.admission_no, JSON.stringify(adm))
  const stay = (await raw('select count(*)::int n from admission_bed_stays where admission_id=$1 and to_at is null', [admissionId]))[0]
  expectEq('admitting opened exactly one open bed stay', stay.n, 1)
  await expectDeny('the same bed cannot take a second patient',
    () => probe('doctor', `select sehat_admit_patient(p_patient_member_id=>$1, p_business_id=>$2,
        p_bed_id=>$3, p_attending_practitioner_id=>$4, p_reason=>'[TEST] clash',
        p_admitting_diagnosis=>null, p_expected_discharge=>null)`,
      [SEED_MEMBER.id, BIZ.id, freeBed.id, DOC.id]))

  // ── the drug chart: a doctor orders, a nurse gives ──
  let orderId = null
  orderId = await perform('doctor', `select sehat_order_medication(
      p_admission_id=>$1, p_drug_name=>'Ondansetron', p_dose_text=>'4 mg', p_frequency_code=>'BD',
      p_times=>null, p_route=>'iv', p_strength=>'4mg', p_form=>'inj', p_prn=>false, p_prn_indication=>null,
      p_max_per_day=>null, p_instructions=>'[TEST]', p_ordered_by=>$2, p_allergy_override=>null)`,
    [admissionId, DOC.id]).catch(e => { record('a doctor can order a drug', false, e.message.split('\n')[0]); return null })
  if (orderId) record('a doctor can order a drug', true)

  await expectDeny('a nurse cannot order a drug',
    () => probe('nurse', `select sehat_order_medication(p_admission_id=>$1, p_drug_name=>'Morphine',
        p_dose_text=>'10 mg', p_frequency_code=>'BD', p_times=>null, p_route=>'iv', p_strength=>null,
        p_form=>null, p_prn=>false, p_prn_indication=>null, p_max_per_day=>null, p_instructions=>null,
        p_ordered_by=>$2, p_allergy_override=>null)`, [admissionId, NURSE?.id ?? DOC.id]), 'prescribe|doctor|not authorised')

  if (orderId) {
    const due = await tryProbe('nurse', `select count(*)::int from medication_due where order_id=$1`, [orderId])
    expectTrue('the order produces due slots on the chart', due > 0, `medication_due returned ${due} rows`)
    // The nurse's actual job.
    const admId = await perform('nurse', `select sehat_record_administration(
        p_order_id=>$1, p_status=>'given', p_due_at=>now(), p_dose_given=>'4 mg', p_reason=>null,
        p_given_by=>$2, p_witnessed_by=>null, p_notes=>'[TEST] given by suite')`,
      [orderId, NURSE?.id]).catch(e => { record('a nurse can chart a dose as given', false, e.message.split('\n')[0]); return null })
    if (admId) record('a nurse can chart a dose as given', true)

    await expectDeny('reception cannot chart a dose',
      () => probe('reception', `select sehat_record_administration(p_order_id=>$1, p_status=>'given',
          p_due_at=>now(), p_dose_given=>'4 mg', p_reason=>null, p_given_by=>null, p_witnessed_by=>null,
          p_notes=>null)`, [orderId]))

    if (admId) {
      // Deliberately as POSTGRES, not as a clinic user. RLS already stops the
      // browser (there is no write policy), but the promise 0067 made was that
      // the record is append-only full stop — including for the service role and
      // anything else that bypasses RLS. 0069 is what makes that true.
      await expectDeny('a dose record cannot be edited, even bypassing RLS',
        () => db.query(`update medication_administrations set dose_given='[TEST] tampered' where id=$1`, [admId]),
        'cannot be edited|append')
      await expectDeny('a dose record cannot be deleted, even bypassing RLS',
        () => db.query(`delete from medication_administrations where id=$1`, [admId]),
        'cannot be deleted|void it')
      await expectDeny('a nurse cannot write the table directly',
        () => probe('nurse', `update medication_administrations set notes='x' where id=$1`, [admId]))
      await expectAllow('a wrong administration can be voided with a reason',
        () => perform('nurse', `select sehat_void_administration(p_id=>$1, p_reason=>'[TEST] charted in error', p_voided_by=>$2)`,
          [admId, NURSE?.id]))
      await expectDeny('voiding without a reason is refused',
        () => probe('nurse', `select sehat_void_administration(p_id=>$1, p_reason=>'  ', p_voided_by=>$2)`,
          [admId, NURSE?.id]), 'why|struck')
      const voided = (await raw(`select voided_at, void_reason, dose_given from medication_administrations where id=$1`, [admId]))[0]
      expectTrue('the void is recorded but the original dose is still readable',
        voided?.voided_at != null && voided?.dose_given === '4 mg',
        JSON.stringify(voided))
      await expectDeny('a strike-out cannot itself be rewritten',
        () => db.query(`update medication_administrations set void_reason='[TEST] changed my mind' where id=$1`, [admId]),
        'already struck|cannot')
    }
    await expectDeny('a nurse cannot stop an order',
      () => probe('nurse', `select sehat_stop_medication(p_order_id=>$1, p_reason=>'[TEST]', p_stopped_by=>$2)`,
        [orderId, NURSE?.id]), 'doctor|prescribe')
    await expectAllow('a doctor can stop an order with a reason',
      () => perform('doctor', `select sehat_stop_medication(p_order_id=>$1, p_reason=>'[TEST] course complete', p_stopped_by=>$2)`,
        [orderId, DOC.id]))
    await expectDeny('stopping without a reason is refused',
      () => probe('doctor', `select sehat_stop_medication(p_order_id=>$1, p_reason=>'  ', p_stopped_by=>$2)`,
        [orderId, DOC.id]), 'why|reason')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
sec('billing')
if (admissionId && !skip()) {
  await expectAllow('bed charges can be posted for the stay',
    () => perform('owner', 'select sehat_post_bed_charges($1)', [admissionId]))
  const charges = (await raw('select count(*)::int n, coalesce(sum(amount),0) total from patient_charges where admission_id=$1', [admissionId]))[0]
  expectTrue('posting bed charges produced at least one charge', charges.n > 0, JSON.stringify(charges))

  const billId = await perform('owner', `select sehat_issue_patient_bill(
      p_patient_member_id=>$1, p_business_id=>$2, p_admission_id=>$3, p_visit_id=>null,
      p_discount=>0, p_discount_reason=>null, p_round_off=>0, p_issued_by=>null, p_supersedes=>null)`,
    [memberId, BIZ.id, admissionId]).catch(e => { record('a bill can be issued for the admission', false, e.message.split('\n')[0]); return null })
  if (billId) {
    record('a bill can be issued for the admission', true)
    const bill = (await raw('select bill_no, status, net_payable from patient_bills where id=$1', [billId]))[0]
    expectTrue('the bill got a number', !!bill?.bill_no, JSON.stringify(bill))
    await expectDeny('an issued bill cannot be edited',
      () => db.query(`update patient_bills set net_payable=1 where id=$1`, [billId]), 'immutable|frozen|cannot')
    await expectDeny('a charge already billed cannot be edited',
      () => db.query(`update patient_charges set amount=1 where admission_id=$1`, [admissionId]), 'billed|frozen|immutable|cannot|cancel that bill')
    await expectAllow('a bill can be cancelled with a reason',
      () => perform('owner', `select sehat_cancel_patient_bill($1,'[TEST] raised in error')`, [billId]))
  }
}
await expectDeny('reception cannot read the business report',
  () => probe('reception', 'select count(*) from sehat_business_report($1, 30)', [BIZ.id]), 'authoris|privilege')
await expectDeny('a nurse cannot read the business report',
  () => probe('nurse', 'select count(*) from sehat_business_report($1, 30)', [BIZ.id]), 'authoris|privilege')
await expectAllow('a doctor can read the business report',
  () => probe('doctor', 'select count(*) from sehat_business_report($1, 30)', [BIZ.id]))

// ═══════════════════════════════════════════════════════════════════════════
sec('beds')
// Moving and correcting a stay. 0053 made stays periods rather than a single
// current bed, and 0062 added the correction path — recording a move that
// happened at 2am when the clerk types it at 9am.
if (admissionId && !skip()) {
  const stay = (await raw(`select id, bed_id, from_at from admission_bed_stays
    where admission_id=$1 and to_at is null`, [admissionId]))[0]
  let otherBed = (await raw(`select b.id from beds b where b.business_id=$1 and b.id <> $2
    and b.is_active and not exists (
      select 1 from admission_bed_stays s where s.bed_id=b.id and s.to_at is null)
    limit 1`, [BIZ.id, stay?.bed_id]))[0]
  if (stay && !otherBed) {
    // Same reasoning as the admitting bed: provision rather than skip.
    const ward = (await raw(`select id from wards where business_id=$1 order by sort_order nulls last limit 1`, [BIZ.id]))[0]
    otherBed = (await raw(`insert into beds (ward_id, business_id, label, daily_charge, is_active)
      values ($1,$2,$3,1500,true) returning id`, [ward?.id, BIZ.id, `[TEST] move ${STAMP}`]))[0]
  }
  if (stay && otherBed) {
    await expectAllow('a stay can be corrected to a different bed with a reason',
      () => perform('owner', `select sehat_correct_bed_stay(p_stay_id=>$1, p_reason=>'[TEST] recorded on the wrong bed',
          p_from_at=>null, p_to_at=>null, p_bed_id=>$2, p_corrected_by=>null)`, [stay.id, otherBed.id]))
    const after = (await raw(`select bed_id, correction_reason, corrected_at from admission_bed_stays where id=$1`, [stay.id]))[0]
    expectEq('the correction moved the bed', after?.bed_id, otherBed.id)
    expectTrue('the correction recorded why', !!after?.correction_reason, JSON.stringify(after))
    await expectDeny('a correction without a reason is refused',
      () => probe('owner', `select sehat_correct_bed_stay(p_stay_id=>$1, p_reason=>'  ',
          p_from_at=>null, p_to_at=>null, p_bed_id=>$2, p_corrected_by=>null)`, [stay.id, otherBed.id]), 'why|reason')
    await expectDeny('another clinic cannot correct this stay',
      () => probe('other', `select sehat_correct_bed_stay(p_stay_id=>$1, p_reason=>'[TEST] poach',
          p_from_at=>null, p_to_at=>null, p_bed_id=>$2, p_corrected_by=>null)`, [stay.id, otherBed.id]))
    // Reception CAN, deliberately. "Queue, beds and billing" is the whole of
    // what the front desk is for, and a bed recorded wrongly is theirs to fix.
    // Contrast with discharge, which 0071 moved to clinical-only: freeing a bed
    // is operational, saying why the patient was well enough to go is not.
    await expectAllow('reception can correct a bed stay — beds are the front desk\'s job',
      () => probe('reception', `select sehat_correct_bed_stay(p_stay_id=>$1, p_reason=>'[TEST] desk correction',
          p_from_at=>null, p_to_at=>null, p_bed_id=>$2, p_corrected_by=>null)`, [stay.id, otherBed.id]))
  } else record('a stay can be corrected to a different bed with a reason', 'warn',
    `needed an open stay and a second free bed; got stay=${!!stay} otherBed=${!!otherBed}`)
}

// ═══════════════════════════════════════════════════════════════════════════
sec('discharge')
if (admissionId && !skip()) {
  await expectDeny('reception cannot discharge',
    () => probe('reception', `select sehat_discharge_patient(p_admission_id=>$1, p_status=>'discharged',
        p_discharge_diagnosis=>'x', p_discharge_summary=>null, p_condition=>'recovered',
        p_follow_up=>null, p_practitioner_id=>null)`, [admissionId]))
  await expectAllow('a doctor can discharge',
    () => perform('doctor', `select sehat_discharge_patient(p_admission_id=>$1, p_status=>'discharged',
        p_discharge_diagnosis=>'[TEST] resolved', p_discharge_summary=>'[TEST] uneventful',
        p_condition=>'recovered', p_follow_up=>null, p_practitioner_id=>$2)`, [admissionId, DOC.id]))
  const adm = (await raw(`select status, discharged_at from admissions where id=$1`, [admissionId]))[0]
  expectEq('the admission is discharged', adm?.status, 'discharged')
  expectTrue('the discharge is timestamped', adm?.discharged_at != null, JSON.stringify(adm))
  const open = (await raw(`select count(*)::int n from admission_bed_stays where admission_id=$1 and to_at is null`, [admissionId]))[0]
  expectEq('discharging closed the bed stay', open.n, 0)

  const dsId = await perform('doctor', `select sehat_issue_discharge_summary(
      p_admission_id=>$1, p_practitioner_id=>$2, p_course_in_hospital=>'[TEST] IV fluids',
      p_investigations=>null, p_procedures=>null, p_advice=>'[TEST] rest', p_diet_advice=>null,
      p_activity_advice=>null, p_warning_signs=>'[TEST] fever returning', p_follow_up_with=>null,
      p_prescription_id=>null, p_supersedes=>null)`, [admissionId, DOC.id])
    .catch(e => { record('a discharge summary can be issued', false, e.message.split('\n')[0]); return null })
  if (dsId) {
    record('a discharge summary can be issued', true)
    const ds = (await raw(`select summary_no, status from discharge_summaries where id=$1`, [dsId]))[0]
    expectTrue('the discharge summary got a number', !!ds?.summary_no, JSON.stringify(ds))
    await expectDeny('an issued discharge summary cannot be edited',
      () => db.query(`update discharge_summaries set advice='[TEST] tampered' where id=$1`, [dsId]),
      'immutable|cannot|supersede')
  }
  await expectDeny('a nurse cannot issue a discharge summary',
    () => probe('nurse', `select sehat_issue_discharge_summary(p_admission_id=>$1, p_practitioner_id=>$2,
        p_course_in_hospital=>'x', p_investigations=>null, p_procedures=>null, p_advice=>null,
        p_diet_advice=>null, p_activity_advice=>null, p_warning_signs=>null, p_follow_up_with=>null,
        p_prescription_id=>null, p_supersedes=>null)`, [admissionId, DOC.id]), 'prescribe|doctor|authoris')
}

// ═══════════════════════════════════════════════════════════════════════════
sec('appointments')
// The state machine behind the booking the bot makes.
const appt = (await raw(`select id, status, slot_datetime from appointments
  where business_id=$1 order by created_at desc limit 1`, [BIZ.id]))[0]
if (appt && !skip()) {
  await expectDeny('anon cannot cancel somebody\'s appointment',
    () => probe('anon', `select sehat_cancel_appointment(p_appointment_id=>$1, p_actor=>'patient',
        p_reason=>'[TEST]', p_actor_detail=>null)`, [appt.id]))
  await expectDeny('another clinic cannot touch this appointment',
    () => probe('other', `select sehat_set_appointment_status(p_appointment_id=>$1, p_status=>'completed',
        p_actor=>'clinic', p_actor_detail=>null)`, [appt.id]))
  await expectAllow('the clinic can reschedule its own appointment',
    () => perform('reception', `select sehat_reschedule_appointment(p_appointment_id=>$1,
        p_new_slot=>$2, p_actor=>'clinic', p_reason=>'[TEST] doctor running late', p_actor_detail=>null)`,
      [appt.id, new Date(Date.now() + 3 * 864e5).toISOString()]))
  const moved = (await raw(`select reschedule_count, previous_slot_datetime, status from appointments where id=$1`, [appt.id]))[0]
  expectTrue('rescheduling recorded the previous slot', moved?.previous_slot_datetime != null, JSON.stringify(moved))
  expectTrue('rescheduling bumped the counter', (moved?.reschedule_count ?? 0) > 0, JSON.stringify(moved))
  const evs = (await raw(`select count(*)::int n from appointment_events where appointment_id=$1`, [appt.id]))[0]
  expectTrue('every appointment change left an event', evs.n >= 2, `only ${evs.n} events`)
}

// ═══════════════════════════════════════════════════════════════════════════
sec('doublebooking')
// 0072: a doctor booked at one business is busy at every other one.
//
// This whole section runs inside a transaction that is rolled back, because it
// has to publish opening hours at two businesses to have any windows to offer,
// and those hours are not something the suite should leave behind.
//
// The scenario is the real one: Dr. Sunita Mehra is affiliated to both a clinic
// on 30-minute slots and a hospital on 15-minute ones. A 10:00 booking at the
// clinic occupies 10:00-10:30, so the hospital must stop offering both 10:00
// and 10:15 — the overlap, not just the equal minute.
const MULTI = (await raw(`
  select distinct bp.practitioner_id as id, p.full_name
    from business_practitioners bp
    join practitioners p on p.id = bp.practitioner_id
   where exists (select 1 from business_practitioners x
                  where x.practitioner_id = bp.practitioner_id and x.business_id <> bp.business_id)
   limit 1`))[0]

if (!MULTI && !skip()) {
  record('a practitioner affiliated to two businesses exists to test with', 'warn',
    'no multi-clinic doctor in this database — the cross-clinic checks did not run')
}

if (MULTI && !skip()) {
  const twoBiz = await raw(`select business_id from business_practitioners
     where practitioner_id=$1 order by business_id limit 2`, [MULTI.id])
  const [HOME, AWAY] = twoBiz.map(r => r.business_id)

  await db.query('begin')
  try {
    const day = (await db.query(`select ((now() at time zone 'Asia/Kolkata')::date + 3) d,
        extract(dow from ((now() at time zone 'Asia/Kolkata')::date + 3))::int dow`)).rows[0]
    // 30-minute slots where the booking lands, 15-minute where it must block.
    for (const [biz, mins] of [[HOME, 30], [AWAY, 15]]) {
      await db.query(`insert into availability (business_id, day_of_week, start_time, end_time,
          slot_duration_minutes, slot_capacity, is_active, location_id)
        values ($1,$2,'10:00','13:00',$3,1,true,
          (select id from practice_locations where business_id=$1 and is_primary and is_active limit 1))`,
        [biz, day.dow, mins])
    }
    const at = async (h, m) => (await db.query(
      `select (($1::date + make_time($2,$3,0)) at time zone 'Asia/Kolkata') t`, [day.d, h, m])).rows[0].t
    const book = async (biz, t) => db.query(
      `insert into appointments (business_id, practitioner_id, patient_phone, patient_name,
         patient_age, slot_datetime, status, booked_via)
       values ($1,$2,$3,'[TEST] Double-booking',40,$4,'booked','test')`,
      [biz, MULTI.id, phone(880000001), t])

    await book(HOME, await at(10, 0))

    // As service_role and as a logged-in clinic user. The guard used to be
    // SECURITY INVOKER, so RLS hid the other business's rows from it and it
    // fired for the first and not the second — the bug that let this through.
    for (const who of ['service_role', 'authenticated']) {
      for (const [label, h, m, shouldRefuse] of [
        ['the same minute', 10, 0, true],
        ['an overlapping 10:15', 10, 15, true],
        ['10:30, after that window ends', 10, 30, false],
      ]) {
        await db.query('savepoint dbk')
        let err = null
        try {
          await db.query(`select set_config('request.jwt.claims',$1,true)`,
            [JSON.stringify({ sub: uid.owner, role: who })])
          await db.query(`set local role ${who}`)
          await book(AWAY, await at(h, m))
        } catch (e) { err = e.message.split('\n')[0] }
        finally { await db.query('rollback to savepoint dbk'); await db.query('reset role') }

        if (shouldRefuse) {
          expectTrue(`${who}: ${label} at the other business is refused`, err != null,
            'it was accepted — the doctor is in two places at once')
        } else {
          expectTrue(`${who}: ${label} is still allowed`, err == null, err)
        }
      }
    }

    // And the offer, which is what the patient actually sees.
    const away = (await db.query(
      `select window_start, seats_left, blocked_elsewhere
         from sehat_open_windows($1,$2,$3) order by window_start`, [AWAY, day.d, MULTI.id])).rows
    const hhmm = t => new Date(t).toLocaleTimeString('en-IN',
      { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
    const blocked = away.filter(w => w.blocked_elsewhere).map(w => hhmm(w.window_start))
    expectEq('both overlapping windows are withdrawn at the other business', blocked, ['10:00', '10:15'],
      `of ${away.length} windows offered`)
    expectTrue('a withdrawn window offers no seats',
      away.filter(w => w.blocked_elsewhere).every(w => w.seats_left === 0))
    expectTrue('the rest of the day is still offered',
      away.filter(w => !w.blocked_elsewhere).every(w => w.seats_left > 0),
      JSON.stringify(away.filter(w => !w.blocked_elsewhere && w.seats_left <= 0)))

    // The business that holds the booking sees a full window, not a foreign one.
    const home = (await db.query(
      `select window_start, seats_left, blocked_elsewhere
         from sehat_open_windows($1,$2,$3) order by window_start`, [HOME, day.d, MULTI.id])).rows
    const own = home.find(w => hhmm(w.window_start) === '10:00')
    expectTrue('its own booked window reads as full, not as booked elsewhere',
      own && own.seats_left === 0 && own.blocked_elsewhere === false,
      own ? `seats_left=${own.seats_left} blocked_elsewhere=${own.blocked_elsewhere}` : 'window missing')
  } catch (e) {
    record('the double-booking scenario ran', false, e.message.split('\n')[0])
  } finally {
    await db.query('rollback')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
sec('modules')
// Entitlement: a clinic that stopped paying must not be able to admit.
const PAID = (await raw(`select id from businesses where name='[SEED] Paid Multi-Speciality'`))[0]
if (PAID && !skip()) {
  for (const code of ['opd', 'ipd']) {
    const got = await tryProbe('owner', `select sehat_business_has_module($1,$2)`, [PAID.id, code])
    expectTrue(`the paid hospital has the ${code} module`, got === true, `got ${JSON.stringify(got)}`)
  }
  const bogus = await tryProbe('owner', `select sehat_business_has_module($1,'not_a_module')`, [PAID.id])
  expectEq('an unknown module code is false, not an error', bogus, false)
}

// ═══════════════════════════════════════════════════════════════════════════
sec('retention')
// 0058: how long a document is kept, and the legal hold that overrides it.
const years = await tryProbe('owner', `select sehat_retention_years($1,'prescription')`, [BIZ.id])
expectTrue('a retention period is a positive number of years', Number(years) > 0, `got ${JSON.stringify(years)}`)
await expectDeny('anon cannot read a clinic\'s retention policy',
  () => probe('anon', `select sehat_retention_years($1,'prescription')`, [BIZ.id]))
// Provision a document rather than skip the section. retain_until is left for
// sehat_stamp_document_retention to fill, which is itself worth checking.
let doc = (await raw(`select id, legal_hold, retain_until from patient_documents
  where business_id=$1 and title like '[TEST]%' limit 1`, [BIZ.id]))[0]
if (!doc && memberId) {
  doc = (await raw(`insert into patient_documents
      (business_id, patient_member_id, kind, title, storage_path, mime_type, document_date)
    values ($1,$2,'lab_report',$3,$4,'application/pdf', current_date)
    returning id, legal_hold, retain_until`,
    [BIZ.id, memberId, `[TEST] lab report ${STAMP}`, `test/${STAMP}.pdf`]))[0]
  expectTrue('a new document is stamped with a retention date automatically',
    doc?.retain_until != null, JSON.stringify(doc))
}
if (doc) {
  await expectAllow('a document can be put under legal hold',
    () => perform('owner', `select sehat_set_legal_hold($1, true, '[TEST] under inquiry')`, [doc.id]))
  const held = (await raw(`select legal_hold from patient_documents where id=$1`, [doc.id]))[0]
  expectEq('the hold is recorded', held?.legal_hold, true)
  const inPurge = (await raw(`select count(*)::int n from patient_documents_to_purge where id=$1`, [doc.id]))[0]
  expectEq('a document under legal hold is never offered for purging', inPurge.n, 0)
  await perform('owner', `select sehat_set_legal_hold($1, false, '[TEST] inquiry closed')`, [doc.id]).catch(() => {})
} else record('a document can be put under legal hold', 'warn', 'no patient_documents rows to test with')

// ═══════════════════════════════════════════════════════════════════════════
sec('admin')
// The platform-wide reports. Admin only, and emphatically not per-clinic.
await expectDeny('a clinic owner cannot read the platform report',
  () => probe('owner', 'select count(*) from sehat_platform_report(30)'), 'authoris|privilege|admin')
await expectDeny('anon cannot read the platform report',
  () => probe('anon', 'select count(*) from sehat_platform_report(30)'))
await expectAllow('an admin can read the platform report',
  () => probe('admin', 'select count(*) from sehat_platform_report(30)'))
await expectAllow('an admin can read the demand report',
  () => probe('admin', 'select count(*) from sehat_demand_report(30)'))
await expectDeny('a clinic owner cannot read the demand report',
  () => probe('owner', 'select count(*) from sehat_demand_report(30)'), 'authoris|privilege|admin')

// ═══════════════════════════════════════════════════════════════════════════
sec('bot')
// The WhatsApp surface is deliberately reachable without a session — it is how a
// patient with no account books. So it must be safe BY CONTENT, not by grant.
const bookable = await tryProbe('anon', `select bot_bookable('doctor','EYE','135001')`)
expectTrue('anon can list bookable doctors — the bot has no session',
  bookable != null && !bookable.refused, JSON.stringify(bookable)?.slice(0, 80))
const slots = await tryProbe('anon', `select bot_available_slots('EYE','135001','1','doctor')`)
expectTrue('anon can see open slots', slots != null && !slots.refused, JSON.stringify(slots)?.slice(0, 80))
// What it must NOT do: hand back anything about who is already booked.
const leak = JSON.stringify(bookable ?? '') + JSON.stringify(slots ?? '')
expectTrue('the bot listing carries no patient name or phone',
  !/9\d{9}/.test(leak.replace(/9000000\d{3}/g, '')) , 'a 10-digit number that is not the clinic\'s own appears in bot output')

// ═══════════════════════════════════════════════════════════════════════════
sec('notifications')
// 0075: the outbox drain is scheduled at last, and loses nothing when the
// messaging providers are not configured yet — which is the state both
// databases are in.
//
// Rolled back: it writes outbox rows and claims them, and a half-claimed
// notification is not something to leave lying about.
if (!skip()) {
  await db.query('begin')
  try {
    const mk = async (status, lastError, attempts, ageMin) => (await db.query(
      `insert into notification_outbox (recipient, event, phone, status, last_error, attempts, created_at)
       values ('patient','rescheduled','9000000009',$1,$2,$3, now() - make_interval(mins => $4))
       returning id`, [status, lastError, attempts, ageMin])).rows[0].id
    const statusOf = async id => (await db.query(
      `select status, claimed_at from notification_outbox where id=$1`, [id])).rows[0]

    // The claim stamp, and the reason it exists. Requeueing on created_at would
    // hand a second drain a row the first is still sending — the exact
    // double-send the claim was there to prevent.
    const id = await mk('pending', null, 0, 60)
    expectTrue('a pending notification has no claimed_at', (await statusOf(id)).claimed_at === null)
    await db.query(`update notification_outbox set status='sending' where id=$1`, [id])
    expectTrue('claiming a notification stamps claimed_at', (await statusOf(id)).claimed_at !== null)
    await db.query(`select sehat_requeue_stuck_notifications()`)
    expectEq('a freshly claimed row is left alone however old the queue entry',
      (await statusOf(id)).status, 'sending', 'requeuing this one would send it twice')

    await db.query(`update notification_outbox set claimed_at = now() - interval '30 minutes' where id=$1`, [id])
    await db.query(`select sehat_requeue_stuck_notifications()`)
    const stuck = await statusOf(id)
    expectEq('a claim stuck for 30 minutes goes back to pending', stuck.status, 'pending')
    expectTrue('requeuing clears claimed_at', stuck.claimed_at === null)

    // Ours to retry, or theirs to refuse.
    const cases = [
      ['AISENSY env not set', 0, 'pending', 'a run with no provider configured is retried'],
      ['no phone number', 0, 'failed', 'a notification with no phone number stays failed'],
      ['whatsapp 400: invalid destination', 0, 'failed', 'a provider that answered and refused stays failed'],
      ['AISENSY env not set', 5, 'failed', 'a notification at the attempt cap stays failed'],
    ]
    const ids = []
    for (const [err, att] of cases) ids.push(await mk('failed', err, att, 5))
    await db.query(`select sehat_requeue_stuck_notifications()`)
    for (let i = 0; i < cases.length; i++) {
      const [, , want, label] = cases[i]
      expectEq(label, (await statusOf(ids[i])).status, want)
    }
  } catch (e) {
    record('the requeue scenario ran', false, e.message.split('\n')[0])
  } finally { await db.query('rollback') }

  for (const who of ['anon', 'owner']) {
    await expectDeny(`${who} cannot run the notification requeue`,
      () => probe(who, `select sehat_requeue_stuck_notifications()`))
  }

  // The job itself. A cron that was never scheduled is this project's
  // longstanding failure mode — 0008, 0005 and 0046 each left one as a comment.
  const jobs = (await raw(`select jobname, schedule, active from cron.job order by jobname`))
  expectTrue('the notification drain is scheduled and active',
    jobs.some(j => j.jobname === 'drain-appointment-notifications' && j.active),
    `jobs: ${jobs.map(j => j.jobname).join(', ') || '(none)'}`)
  expectTrue('its runs are visible in purge_job_history',
    (await raw(`select pg_get_viewdef('purge_job_history'::regclass, true) d`))[0]
      ?.d?.includes('drain-appointment-notifications'))
}

// ═══════════════════════════════════════════════════════════════════════════
sec('numbering')
// Statutory series: per business, per financial year, never handed out twice.
//
// 0064 revoked these from PUBLIC precisely so nobody can burn a clinic's series
// by looping the counter — a GST invoice series with gaps has to be explained to
// an auditor and cannot be repaired. So NOBODY reachable from the browser may
// call them directly; they are only reached from inside the issuing RPCs, which
// are SECURITY DEFINER and owned by postgres. Assert the lock, then check the
// series through the documents it actually numbered.
for (const who of ['anon', 'owner', 'doctor', 'reception', 'other']) {
  await expectDeny(`${who} cannot call sehat_next_bill_number directly`,
    () => probe(who, `select sehat_next_bill_number($1, current_date)`, [BIZ.id]),
    'permission denied|not authoris')
}
const billNos = await raw(`select bill_no from patient_bills where business_id=$1 and bill_no is not null
  order by created_at`, [BIZ.id])
if (billNos.length) {
  expectTrue('a bill number carries the financial year',
    /\d{4}-\d{2}/.test(billNos[0].bill_no), `got ${billNos[0].bill_no}`)
  expectEq('every bill number in this business is distinct',
    billNos.length, new Set(billNos.map(b => b.bill_no)).size)
} else record('a bill number carries the financial year', 'warn', 'no bills issued yet to inspect')
const rxNos = await raw(`select prescription_no from prescriptions where business_id=$1 and prescription_no is not null`, [BIZ.id])
if (rxNos.length) {
  expectEq('every prescription number in this business is distinct',
    rxNos.length, new Set(rxNos.map(r => r.prescription_no)).size)
}

// ═══════════════════════════════════════════════════════════════════════════
sec('consent')
const consented = await tryProbe('doctor', `select sehat_has_consent($1,'recording',$2)`,
  [SEED_MEMBER.id, BIZ.id])
expectTrue('consent for recording is a real boolean', consented === true || consented === false, `got ${consented}`)
await expectDeny('anon cannot probe whether a named person consented',
  () => probe('anon', `select sehat_has_consent($1,'recording',$2)`,
    [ANY_MEMBER.id, BIZ.id]))

// ═══════════════════════════════════════════════════════════════════════════
sec('exposure')
// The 0068 regression net, in assertion form — tightened by 0074, which revoked
// anon from every view below rather than relying on each one's own WHERE.
//
// The second list used to accept "0 rows" as a pass. It should not have: a zero
// can mean an empty table rather than a closed door, which is exactly how
// appointment_detail read safe until the first booking armed it. They are all
// refusals now, and asserted as such.
for (const v of ['appointment_detail', 'appointment_outcomes', 'business_effective_pricing',
                 'practitioner_daily_stats', 'business_daily_stats', 'purge_job_history',
                 'patient_summary', 'patient_account', 'admission_detail', 'prescription_detail',
                 'visit_findings_detail', 'ward_occupancy', 'opd_board', 'patient_bill_detail',
                 'admission_bed_history', 'business_appointment_list', 'business_outstanding',
                 'business_bills_outstanding', 'discharge_summary_detail', 'business_modules',
                 // Unscoped, owner-run and anon-readable until 0074. They read 0
                 // rows only because nothing has passed retention yet.
                 'patient_documents_to_purge', 'consultation_audio_to_purge', 'unmet_demand_summary']) {
  await expectDeny(`anon cannot read ${v}`, () => probe('anon', `select count(*) from public.${v}`), 'permission denied')
}

// 0074: an invoker view reads its base table as the caller, so findable_clinics
// needs anon to hold SELECT on seed_clinics — but only on the columns the view
// uses. The table carries phone numbers and import notes for 80 clinics that the
// view deliberately does not project.
await expectAllow('anon can still read the public clinic directory',
  () => probe('anon', `select count(*) from findable_clinics`))
for (const col of ['phone', 'notes', 'latitude', 'claimed_by_business_id']) {
  await expectDeny(`anon cannot read seed_clinics.${col} behind the view`,
    () => probe('anon', `select ${col} from seed_clinics limit 1`), 'permission denied')
}

// Every view runs as its caller now, bar the two named in 0074's closing note.
const stillOwner = (await raw(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v'
     and not coalesce(array_to_string(c.reloptions,',') like '%security_invoker%', false)
   order by 1`)).map(r => r.relname)
expectEq('only the two documented views still run as their owner', stillOwner,
  ['patient_summary', 'purge_job_history'],
  'a new view without security_invoker skips the RLS on everything it reads')
// Cross-tenant: the other clinic must not see this clinic's admission.
if (admissionId) {
  const cross = await tryProbe('other', `select count(*)::int from admission_detail where id=$1`, [admissionId])
  expectEq('another clinic cannot see this admission', cross, 0)
}

// ═══════════════════════════════════════════════════════════════════════════
sec('integrity')
const orphanStays = (await raw(`select count(*)::int n from admission_bed_stays s
  left join admissions a on a.id=s.admission_id where a.id is null`))[0].n
expectEq('no bed stays without an admission', orphanStays, 0)
const doubleBooked = (await raw(`select count(*)::int n from (
  select bed_id from admission_bed_stays where to_at is null group by bed_id having count(*)>1) x`))[0].n
expectEq('no bed holds two open stays', doubleBooked, 0)
const negBills = (await raw(`select count(*)::int n from patient_bills where net_payable < 0`))[0].n
expectEq('no bill is negative', negBills, 0)
const dupBillNo = (await raw(`select count(*)::int n from (
  select business_id, bill_no from patient_bills where bill_no is not null
  group by business_id, bill_no having count(*)>1) x`))[0].n
expectEq('no bill number is issued twice in one business', dupBillNo, 0)
const dupRxNo = (await raw(`select count(*)::int n from (
  select business_id, prescription_no from prescriptions where prescription_no is not null
  group by business_id, prescription_no having count(*)>1) x`))[0].n
expectEq('no prescription number is issued twice in one business', dupRxNo, 0)
const dupAdmNo = (await raw(`select count(*)::int n from (
  select business_id, admission_no from admissions where admission_no is not null
  group by business_id, admission_no having count(*)>1) x`))[0].n
expectEq('no admission number is issued twice in one business', dupAdmNo, 0)

// ── report ──────────────────────────────────────────────────────────────────
await db.end()
const failed = results.filter(r => r.ok === false)
const warned = results.filter(r => r.ok === 'warn')
console.log(`\n${'─'.repeat(70)}`)
console.log(`${results.length} checks · ${results.filter(r => r.ok === true).length} passed · ${failed.length} failed · ${warned.length} warnings`)
if (failed.length) {
  console.log('\nFAILED:')
  for (const f of failed) console.log(`  ${f.section} · ${f.name}\n      ${f.detail}`)
}
if (warned.length) {
  console.log('\nWARNINGS:')
  for (const w of warned) console.log(`  ${w.section} · ${w.name}\n      ${w.detail}`)
}
process.exit(failed.length ? 1 : 0)
