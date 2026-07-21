export type Lang = 'en' | 'hi'

type Entry = { en: string; hi: string }
type Tree = { [key: string]: Entry | Tree }

export const translations: Tree = {
  nav: {
    home: { en: 'Home', hi: 'Home' },
    howItWorks: { en: 'How it Works', hi: 'Kaise Kaam Karta Hai' },
    forDoctors: { en: 'For Doctors', hi: 'Doctors Ke Liye' },
    partners: { en: 'Partners', hi: 'Partners' },
    points: { en: '🌟 Points', hi: '🌟 Points' },
    bookWhatsapp: { en: '📱 Book on WhatsApp', hi: '📱 WhatsApp Par Book Karein' },
    registerClinic: { en: 'Register Clinic', hi: 'Clinic Register Karein' },
  },

  footer: {
    tagline: { en: "Health's New Partnership", hi: 'स्वास्थ्य की नई साझेदारी' },
    whatsappUs: { en: '📱 WhatsApp us', hi: '📱 WhatsApp Karein' },
    patientsHeading: { en: 'Patients', hi: 'Patients' },
    findDoctor: { en: 'Find a Doctor', hi: 'Doctor Dhundhein' },
    howItWorks: { en: 'How it Works', hi: 'Kaise Kaam Karta Hai' },
    sehatPoints: { en: '🌟 Sehat Points', hi: '🌟 Sehat Points' },
    bookAppointment: { en: 'Book Appointment', hi: 'Appointment Book Karein' },
    partnersHeading: { en: 'Partners', hi: 'Partners' },
    partnerOverview: { en: 'Partner Overview', hi: 'Partner Overview' },
    registerAsDoctor: { en: 'Register as Doctor', hi: 'Doctor Ke Roop Mein Register Karein' },
    pharmacyLabAmbulance: { en: 'Pharmacy / Lab / Ambulance', hi: 'Pharmacy / Lab / Ambulance' },
    partnerLogin: { en: 'Partner Login', hi: 'Partner Login' },
    contactHeading: { en: 'Contact', hi: 'Contact' },
    address: { en: '📍 Yamuna Nagar, Haryana', hi: '📍 Yamuna Nagar, Haryana' },
    rights: { en: '© 2026 Sehatsandhi. All rights reserved.', hi: '© 2026 Sehatsandhi. Sabhi adhikar surakshit.' },
    privacy: { en: 'Privacy Policy', hi: 'Privacy Policy' },
    terms: { en: 'Terms', hi: 'Terms' },
    company: { en: 'NG Technologies, Yamuna Nagar', hi: 'NG Technologies, Yamuna Nagar' },
  },

  landing: {
    heroBadge: { en: '📍 Yamuna Nagar & Jagadhri', hi: '📍 Yamuna Nagar & Jagadhri' },
    heroTitleLine1: { en: 'Find the Right Doctor,', hi: 'सही डॉक्टर,' },
    heroTitleLine2: { en: 'Right Now', hi: 'अभी मिलें' },
    heroSubtitle: { en: "Yamuna Nagar's Own Health Platform", hi: 'Yamuna Nagar Ka Apna Health Platform' },
    heroDescription: {
      en: 'Book appointments with verified doctors in Yamuna Nagar right on WhatsApp — completely free, no app needed',
      hi: 'Yamuna Nagar ke verified doctors se WhatsApp par appointment book karein — bilkul free, koi app nahi',
    },
    heroCtaWhatsapp: { en: '📱 Book on WhatsApp', hi: '📱 WhatsApp Par Book Karein' },
    heroCtaDoctor: { en: '🏥 Are You a Doctor? Register', hi: '🏥 Doctor? Register Karein' },
    heroFootnote: {
      en: '✓ No registration needed for patients  ✓ Free forever  ✓ Verified doctors only',
      hi: '✓ Patients ke liye koi registration nahi  ✓ Hamesha free  ✓ Sirf verified doctors',
    },
    chatWelcome: { en: 'Namaste! 🙏 I am Sehatsandhi. Which speciality do you need?', hi: 'Namaste! 🙏 Main Sehatsandhi hoon. Aapko kaunsi speciality chahiye?' },
    chatUserMsg: { en: 'I need a skin specialist', hi: 'Skin specialist chahiye' },
    chatDoctorList: { en: 'Available in Yamuna Nagar:', hi: 'Yamuna Nagar mein:' },
    chatReply: { en: 'Reply number to book →', hi: 'Reply number to book →' },

    trustPins: { en: 'PIN Codes Covered', hi: 'PIN Codes Cover' },
    trustSpecialities: { en: 'Specialities', hi: 'Specialities' },
    trustLocation: { en: 'Yamuna Nagar & Jagadhri', hi: 'Yamuna Nagar & Jagadhri' },
    trustNoApp: { en: 'No App Needed', hi: 'Koi App Nahi' },

    howTitle: { en: 'How Does it Work?', hi: 'Kaise Kaam Karta Hai?' },
    howSubtitle: { en: 'Book a doctor in just 3 steps', hi: 'Sirf 3 steps mein doctor book karein' },
    howStep1Title: { en: 'Message us on WhatsApp', hi: 'WhatsApp par message karein' },
    howStep1Desc: { en: 'Save our number and send "Hi" — no forms, no waiting.', hi: 'Hamara WhatsApp number save karein aur "Hi" message bhejein — koi form nahi, koi wait nahi.' },
    howStep2Title: { en: 'Tell us your speciality', hi: 'Speciality choose karein' },
    howStep2Desc: { en: 'Skin, dental, eye, ortho, child specialist — pick what you need.', hi: 'Skin, dental, eye, ortho, child specialist — apni zaroorat ke anusaar speciality select karein.' },
    howStep3Title: { en: 'Book your doctor', hi: 'Doctor book karein' },
    howStep3Desc: { en: 'See verified doctors near you, pick one, and confirm your appointment.', hi: 'Nearby verified doctors ki list dekhein, doctor select karein, aur appointment confirm karein.' },
    howCta: { en: '📱 Start Now', hi: '📱 Abhi Start Karein' },

    specTitle: { en: 'All Specialities', hi: 'Sabhi Specialities' },
    specSubtitle: { en: '20+ specialities — all available in Yamuna Nagar', hi: '20 se zyaada specialities — sab Yamuna Nagar mein available' },
    specAskLink: { en: 'Ask on WhatsApp →', hi: 'WhatsApp par poochein →' },

    forDocLabel: { en: 'For Doctors & Clinics', hi: 'For Doctors & Clinics' },
    forDocTitle: { en: 'Grow Your Clinic\'s Reach', hi: 'Apni Clinic Ki Reach Badhayein' },
    forDocBenefit1: { en: 'Reach patients in Yamuna Nagar — choose your own PIN codes', hi: 'Yamuna Nagar ke patients tak pahunchein — apne PIN codes choose karein' },
    forDocBenefit2: { en: 'Affordable listing — priced to match your area', hi: 'Affordable listing — apni area ke hisaab se pricing' },
    forDocBenefit3: { en: 'Premium top-position placement also available', hi: 'Premium top position bhi available' },
    forDocBenefit4: { en: 'MCI/NMC verified badge on your listing', hi: 'MCI/NMC verified badge aapke listing par' },
    forDocBenefit5: { en: 'Appointment dashboard — see who booked with you', hi: 'Appointment dashboard — dekho kaunse patients aaye' },
    forDocBenefit6: { en: 'Free registration — our team confirms pricing with you', hi: 'Registration free — pricing details team confirm karegi' },
    forDocCta: { en: 'Register Now →', hi: 'Abhi Register Karein →' },
    forDocCardTitle: { en: 'Pricing Based on Your Area', hi: 'Pricing Apke Area Ke Hisaab Se' },
    forDocCardDesc: {
      en: 'Every area is different — so pricing isn\'t fixed. After you submit your registration, our team will send you personalised pricing on WhatsApp based on your area, selected PIN codes, and speciality.',
      hi: 'Har area ki apni zaroorat hai — isliye pricing fixed nahi hai. Registration submit karne ke baad hamari team aapke area, selected PIN codes, aur speciality ke hisaab se personalised pricing WhatsApp par bhejegi.',
    },
    forDocStep1: { en: 'Register your details and PIN codes', hi: 'Apni details aur PIN codes register karein' },
    forDocStep2: { en: 'Team verifies within 24-48 hours', hi: 'Team 24-48 ghante mein verify karegi' },
    forDocStep3: { en: 'Personalised pricing shared on WhatsApp', hi: 'Personalised pricing WhatsApp par milegi' },
    forDocStep4: { en: 'Confirm and your listing goes live', hi: 'Confirm karein aur listing activate ho jayegi' },
    forDocNote: { en: '💡 No lock-in — cancel anytime, no hidden charges', hi: '💡 No lock-in — cancel anytime, koi hidden charges nahi' },

    faqTitle: { en: 'Frequently Asked Questions', hi: 'Aksar Pooche Jaane Wale Sawaal' },
    faqSubtitle: { en: 'Common questions from patients', hi: 'Patients ke liye common sawaal' },

    ctaTitle: { en: 'Start Today', hi: 'Aaj Hi Shuru Karein' },
    ctaSubtitle: { en: 'Meet the best doctors in Yamuna Nagar — on WhatsApp, right now', hi: 'Yamuna Nagar ke best doctors se milein — WhatsApp par, abhi' },
    ctaBook: { en: '📱 Book Appointment', hi: '📱 Book Appointment' },
    ctaRegister: { en: 'Register as Doctor', hi: 'Register as Doctor' },
  },
}

export function getTranslation(path: string, lang: Lang): string {
  const parts = path.split('.')
  let node: Entry | Tree = translations
  for (const part of parts) {
    const next = (node as Tree)[part]
    if (next === undefined) return path
    node = next
  }
  if (node && typeof node === 'object' && lang in node) {
    return (node as Entry)[lang]
  }
  return path
}
