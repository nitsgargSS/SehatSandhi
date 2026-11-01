// Create (or refresh) "Sehatsandhi Demo Hospital": a sample hospital whose
// website shows hospitals what the Complete-package hospital site looks like.
//
//   node scripts/create-demo-hospital.mjs [sandbox|prod] [--dry]
//
// What it writes, all marked as a demo:
//   • a business: vertical hospital, is_demo, status 'pending' — so patients
//     never find it (Browse, search and the WhatsApp bot list active
//     businesses only); phone is Sehatsandhi's own number, so calls from the
//     demo reach us; no email, and the registration emails it would queue are
//     removed;
//   • eight sample doctors linked to it (fictional names), shown on its site
//     through sehat_public_site (0307);
//   • its website: slug 'demohospital', tier 'full', template 'hospital', with
//     sample content (departments, facilities, packages, patient guide).
// Re-running updates the same rows. Defaults to SANDBOX.
import pg from 'pg'; import dotenv from 'dotenv'
dotenv.config({ path: '.env.supabase', quiet: true })

const target = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'sandbox'
const dry = process.argv.includes('--dry')
if (!['sandbox', 'prod'].includes(target)) { console.error('usage: create-demo-hospital.mjs [sandbox|prod] [--dry]'); process.exit(1) }

const NAME = 'Sehatsandhi Demo Hospital'
const SLUG = 'demohospital'
const PHONE = '8708718705' // Sehatsandhi's own number

const DOCTORS = [
  ['Dr. Arjun Mehra', 'MBBS, MD (Medicine)', 'GEN', 500, 'Mon–Sat, 9 am – 1 pm'],
  ['Dr. Neha Kapoor', 'MBBS, MS (Obs & Gynae)', 'GYN', 600, 'Mon–Sat, 11 am – 4 pm'],
  ['Dr. Rohit Bansal', 'MBBS, MS (Orthopaedics)', 'ORTH', 700, 'Mon–Fri, 10 am – 2 pm'],
  ['Dr. Simran Kaur', 'MBBS, MD (Paediatrics)', 'PAED', 500, 'Mon–Sat, 10 am – 5 pm'],
  ['Dr. Vivek Arora', 'MBBS, MD, DM (Cardiology)', 'CARD', 900, 'Tue, Thu, Sat, 11 am – 3 pm'],
  ['Dr. Pooja Malhotra', 'MBBS, MS (ENT)', 'ENT', 500, 'Mon–Sat, 10 am – 1 pm'],
  ['Dr. Karan Gill', 'MBBS, MS (General Surgery)', 'SURG', 700, 'Mon–Sat, 9 am – 12 pm'],
  ['Dr. Anjali Verma', 'MBBS, MD (Dermatology)', 'SKIN', 600, 'Mon, Wed, Fri, 4 pm – 7 pm'],
]

const L = (en, hi) => ({ en, hi })
const CONTENT = {
  kicker: L('Sample hospital · demo', 'नमूना अस्पताल · डेमो'),
  tagline: L('Your hospital website, built from Sehatsandhi', 'आपके अस्पताल की वेबसाइट, सेहतसंधि से'),
  intro: L('This is a sample. Your site shows your doctors, departments, facilities and packages — and patients book straight into your Sehatsandhi queue on WhatsApp.',
           'यह एक नमूना है। आपकी साइट पर आपके डॉक्टर, विभाग, सुविधाएँ और पैकेज दिखेंगे — और मरीज़ WhatsApp पर सीधे आपकी सेहतसंधि कतार में बुक करेंगे।'),
  emergency: { phone: PHONE, text: L('Sample emergency strip — on your site it shows your 24×7 number.', 'नमूना इमरजेंसी पट्टी — आपकी साइट पर आपका 24×7 नंबर दिखेगा।') },
  highlights: [{ value: '24×7', label: L('emergency', 'इमरजेंसी') }, { value: '60', label: L('beds', 'बिस्तर') }],
  departments: [
    { slug: 'medicine', speciality: 'GEN', title: L('General Medicine', 'सामान्य चिकित्सा'), teaser: L('Fever, infections, diabetes, BP and everyday illness.', 'बुखार, संक्रमण, शुगर, बीपी और रोज़मर्रा की बीमारियाँ।') },
    { slug: 'gynaecology', speciality: 'GYN', title: L('Obstetrics & Gynaecology', 'स्त्री व प्रसूति रोग'), teaser: L('Pregnancy care, delivery and women’s health.', 'गर्भावस्था, प्रसव और महिलाओं की सेहत।') },
    { slug: 'orthopaedics', speciality: 'ORTH', title: L('Orthopaedics', 'हड्डी व जोड़ रोग'), teaser: L('Fractures, joint pain and sports injuries.', 'फ्रैक्चर, जोड़ों का दर्द और खेल की चोटें।') },
    { slug: 'paediatrics', speciality: 'PAED', title: L('Paediatrics', 'बाल रोग'), teaser: L('Child health, vaccination and newborn care.', 'बच्चों की सेहत, टीकाकरण और नवजात देखभाल।') },
    { slug: 'cardiology', speciality: 'CARD', title: L('Cardiology', 'हृदय रोग'), teaser: L('ECG, echo and heart check-ups.', 'ईसीजी, ईको और दिल की जाँच।') },
  ],
  facilities: [
    { name: L('24×7 Emergency', '24×7 इमरजेंसी'), text: L('Casualty with trained staff day and night.', 'दिन-रात प्रशिक्षित स्टाफ़।') },
    { name: L('ICU', 'आईसीयू'), text: L('Monitored beds for critical care.', 'गंभीर मरीज़ों के लिए निगरानी वाले बिस्तर।') },
    { name: L('Operation theatre', 'ऑपरेशन थिएटर'), text: L('For planned and emergency surgery.', 'तय और इमरजेंसी ऑपरेशन के लिए।') },
    { name: L('Laboratory', 'लैब'), text: L('Blood tests with reports on WhatsApp.', 'ख़ून की जाँच, रिपोर्ट WhatsApp पर।') },
    { name: L('Pharmacy', 'फ़ार्मेसी'), text: L('In-house pharmacy.', 'अस्पताल में ही फ़ार्मेसी।') },
    { name: L('Private rooms', 'प्राइवेट कमरे'), text: L('Private and semi-private rooms.', 'प्राइवेट और सेमी-प्राइवेट कमरे।') },
  ],
  packages: [
    { name: L('Basic health check', 'बेसिक हेल्थ चेक'), includes: [L('Blood sugar, CBC, urine', 'शुगर, CBC, यूरिन'), L('Doctor consultation', 'डॉक्टर से परामर्श')], note: L('Sample — your packages and prices here.', 'नमूना — यहाँ आपके पैकेज और दाम।') },
    { name: L('Diabetes check', 'डायबिटीज़ जाँच'), includes: [L('HbA1c, fasting sugar, kidney function', 'HbA1c, फ़ास्टिंग शुगर, किडनी जाँच'), L('Doctor consultation', 'डॉक्टर से परामर्श')] },
    { name: L('Heart check', 'दिल की जाँच'), includes: [L('ECG, lipid profile', 'ईसीजी, लिपिड प्रोफ़ाइल'), L('Cardiologist consultation', 'हृदय रोग विशेषज्ञ से परामर्श')] },
  ],
  patient_guide: [
    { title: L('Admission', 'भर्ती'), body: L('Bring a photo ID, previous reports and your medicines. For cashless treatment, bring your insurance card.', 'फ़ोटो पहचान पत्र, पुरानी रिपोर्ट और दवाएँ लाएँ। कैशलेस इलाज के लिए बीमा कार्ड लाएँ।') },
    { title: L('Visiting hours', 'मिलने का समय'), body: L('Your visiting hours and attendant rules go here.', 'यहाँ आपके मिलने का समय और अटेंडेंट के नियम।') },
    { title: L('Billing and insurance', 'बिलिंग और बीमा'), body: L('Bills can be paid by UPI, card or cash, and split between them — straight from Sehatsandhi.', 'बिल UPI, कार्ड या नकद से, और बाँटकर भी — सीधे सेहतसंधि से।') },
    { title: L('Discharge', 'छुट्टी'), body: L('Patients get the discharge summary and prescriptions on WhatsApp and in My records.', 'डिस्चार्ज सारांश और पर्चे WhatsApp पर और "मेरी रिपोर्ट" में।') },
  ],
  doctor_profiles: DOCTORS.map(([name, , , , opd]) => ({ name, opd: L(opd, opd) })),
  insurance: { intro: L('Sample — your insurers and TPAs here.', 'नमूना — यहाँ आपकी बीमा कंपनियाँ और TPA।'), panel: ['Insurer A', 'Insurer B', 'TPA C', 'Government scheme'] },
  visit: { phone: PHONE, hours: [L('OPD Mon–Sat 9 am – 6 pm', 'OPD सोम–शनि सुबह 9 – शाम 6'), L('Emergency 24×7', 'इमरजेंसी 24×7')], address: L('Sample address, Yamunanagar, Haryana', 'नमूना पता, यमुनानगर, हरियाणा') },
}

const c = new pg.Client({ connectionString: process.env[`SUPABASE_DB_URL_${target.toUpperCase()}`], ssl: { rejectUnauthorized: false } })
await c.connect()
try {
  await c.query('begin')
  let biz = (await c.query('select id, status from businesses where name = $1 and is_demo', [NAME])).rows[0]
  if (!biz) {
    biz = (await c.query(`insert into businesses (name, vertical, status, is_demo, phone, address, own_city, own_district, own_state, own_pin_code)
      values ($1, 'hospital', 'pending', true, $2, 'Sample address, Yamunanagar, Haryana', 'Yamunanagar', 'Yamunanagar', 'Haryana', '135001') returning id, status`, [NAME, PHONE])).rows[0]
    console.log(`created  business ${biz.id}`)
  } else {
    await c.query(`update businesses set status = 'pending', is_demo = true, phone = $2 where id = $1`, [biz.id, PHONE])
    console.log(`found    business ${biz.id}`)
  }
  // No registration emails for a demo.
  const q = await c.query(`delete from email_outbox where business_id = $1 and status = 'pending'`, [biz.id])
  if (q.rowCount) console.log(`removed  ${q.rowCount} queued email(s)`)

  for (const [i, [name, qual, spec, fee]] of DOCTORS.entries()) {
    let p = (await c.query(`select p.id from practitioners p join business_practitioners bp on bp.practitioner_id = p.id where bp.business_id = $1 and p.full_name = $2`, [biz.id, name])).rows[0]
    if (!p) {
      p = (await c.query(`insert into practitioners (full_name, qualification, speciality, status) values ($1, $2, $3, 'active') returning id`, [name, qual, spec])).rows[0]
      await c.query(`insert into business_practitioners (business_id, practitioner_id, role, status, consultation_fee, sort_order, is_primary) values ($1, $2, 'doctor', 'active', $3, $4, $5)`, [biz.id, p.id, fee, i, i === 0])
      console.log(`created  ${name}`)
    } else {
      await c.query(`update practitioners set qualification = $2, speciality = $3, status = 'active' where id = $1`, [p.id, qual, spec])
      await c.query(`update business_practitioners set consultation_fee = $3, sort_order = $4, status = 'active' where business_id = $1 and practitioner_id = $2`, [biz.id, p.id, fee, i])
    }
  }

  await c.query(`insert into business_sites (business_id, slug, is_live, template, tier, brand_color, content)
      values ($1, $2, true, 'hospital', 'full', '#0f6b5c', $3)
      on conflict (business_id) do update set slug = excluded.slug, is_live = true, template = 'hospital', tier = 'full',
        brand_color = excluded.brand_color, content = excluded.content, updated_at = now()`, [biz.id, SLUG, CONTENT])
  console.log(`website  ${SLUG} (hospital, full)`)

  const visible = (await c.query(`select count(*)::int n from public_business_doctors where business_id = $1`, [biz.id])).rows[0].n
  console.log(`check    doctors visible to patients: ${visible} (must be 0)`)
  if (visible !== 0) throw new Error('demo doctors would be visible to patients')
  await c.query(dry ? 'rollback' : 'commit')
  console.log(dry ? '(dry run, rolled back)' : `Saved to ${target}.`)
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error('FAILED, rolled back:', e.message); process.exit(1)
} finally {
  await c.end()
}
