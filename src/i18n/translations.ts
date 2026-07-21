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

  howItWorksPage: {
    heroTitle: { en: 'What is Sehatsandhi?', hi: 'Sehatsandhi Kya Hai?' },
    heroSubtitle: { en: "Yamuna Nagar's own health platform — on WhatsApp", hi: 'Yamuna Nagar Ka Apna Health Platform — WhatsApp Par' },
    heroDescription: {
      en: 'Doctors, medicines, blood tests, ambulance, and health insurance — all on one WhatsApp number. No app, no forms, completely free.',
      hi: 'Doctors, medicines, blood tests, ambulance aur health insurance — sab kuch ek hi WhatsApp number par. Koi app nahi, koi form nahi, bilkul free.',
    },
    heroCta: { en: '📱 Start on WhatsApp', hi: '📱 WhatsApp Par Shuru Karein' },

    howTitle: { en: 'How Does This Work?', hi: 'Yeh Kaise Kaam Karta Hai?' },
    howSubtitle: { en: 'Get any service in just 3 steps', hi: 'Sirf 3 Steps Mein Koi Bhi Service Milegi' },
    step1Title: { en: 'Message us on WhatsApp', hi: 'WhatsApp Par Message Karein' },
    step1Desc: { en: 'Save our number and tell us what you need — doctor, medicine, test, ambulance, or insurance.', hi: 'Hamara number save karein aur apni zaroorat batayein — doctor, medicine, test, ambulance ya insurance.' },
    step2Title: { en: 'Tell us your requirement', hi: 'Apni Zaroorat Batayein' },
    step2Desc: { en: 'The bot will ask what you need — speciality, area, or service type. Just keep replying.', hi: 'Bot aapse poochega kya chahiye — speciality, area, ya service type. Bas reply karte jayein.' },
    step3Title: { en: 'Get a verified service', hi: 'Verified Service Milegi' },
    step3Desc: { en: 'You will be instantly connected to a verified doctor, pharmacy, lab, or partner in your area.', hi: 'Aapke area ke verified doctor, pharmacy, lab ya partner se turant connect ho jayenge.' },

    servicesTitle: { en: 'What All is Available?', hi: 'Kya Kya Milta Hai?' },
    servicesSubtitle: { en: 'Every health need, on one platform', hi: 'Ek Hi Platform Par Aapki Har Health Zaroorat' },
    servicesAskLink: { en: 'Ask on WhatsApp →', hi: 'WhatsApp Par Poochein →' },

    whyTitle: { en: 'Why Sehatsandhi?', hi: 'Kyun Sehatsandhi?' },
    whyBenefit1: { en: 'Everyone is verified — doctors, labs, pharmacies, all checked', hi: 'Sab verified hain — doctors, labs, pharmacies, sab check kiye jaate hain' },
    whyBenefit2: { en: 'Only service providers from your area — not far away', hi: 'Sirf aapke area ke service providers — dur ke nahi' },
    whyBenefit3: { en: 'Right on WhatsApp — no app to install', hi: 'WhatsApp par — koi app install nahi karni' },
    whyBenefit4: { en: 'Completely free for patients — never charged', hi: 'Bilkul free patients ke liye — kabhi charge nahi' },
    whyBenefit5: { en: 'Door service commitment — delivery, home collection, emergency response', hi: 'Door service commitment — delivery, home collection, emergency response' },
    whyBenefit6: { en: 'Sehat Points — book, earn points, get rewards', hi: 'Sehat Points — book karo, points kamao, rewards pao' },

    pointsTitle: { en: '🌟 Sehat Points — Earn While You Heal', hi: '🌟 Sehat Points — Earn While You Heal' },
    pointsDesc: { en: 'Earn points on every appointment and referral — redeem them for discounts and free tests.', hi: 'Har appointment, har referral par points kamayein — aur discounts, free tests ke liye redeem karein.' },
    pointsCta: { en: 'View Sehat Points →', hi: 'Sehat Points Dekhein →' },

    faqSubtitle: { en: 'Common questions from patients', hi: 'Patients Ke Liye Common Sawaal' },

    finalCtaTitle: { en: 'Start Now', hi: 'Abhi Shuru Karein' },
    finalCtaButton: { en: '📱 Message on WhatsApp', hi: '📱 WhatsApp Par Message Karein' },
  },

  partnersPage: {
    heroTitle: { en: 'Sehatsandhi Partner Network', hi: 'Sehatsandhi Partner Network' },
    heroSubtitle: { en: "Yamuna Nagar's own health ecosystem", hi: 'Yamuna Nagar Ka Apna Health Ecosystem' },
    heroDescription: { en: 'Only verified partners. Only door-service providers. Only experts from your area.', hi: 'Sirf verified partners. Sirf door service providers. Sirf aapke area ke experts.' },

    promiseTitle: { en: 'The Sehatsandhi Partner Promise', hi: 'The Sehatsandhi Partner Promise' },
    promiseDesc: {
      en: 'Every partner has made a commitment. When they choose a PIN code, patients in that area are guaranteed door service. This isn\'t just a listing — it\'s a promise of service.',
      hi: 'Har partner ne ek commitment ki hai. Jab woh koi PIN code choose karte hain, toh us area ke patients ko door service guarantee ki jaati hai. Yeh sirf listing nahi — yeh service ka wada hai.',
    },
    badge1: { en: '💊 Medicine Delivery', hi: '💊 Medicine Delivery' },
    badge2: { en: '🔬 Home Sample Collection', hi: '🔬 Home Sample Collection' },
    badge3: { en: '🚑 Emergency Response', hi: '🚑 Emergency Response' },
    badge4: { en: '🛡️ Home Insurance Visits', hi: '🛡️ Home Insurance Visits' },

    faqSubtitle: { en: 'Know this before becoming a partner', hi: 'Partner Banne Se Pehle Jaan Lein' },

    ctaTitle: { en: 'Join Sehatsandhi Today', hi: "Sehatsandhi Se Jud'ein Aaj Hi" },
    ctaSubtitle: { en: 'Have a question? Message us directly on WhatsApp', hi: 'Koi Sawaal Hai? Humein Seedha WhatsApp Karein' },
    ctaButton: { en: '📱 Talk on WhatsApp', hi: '📱 WhatsApp Par Baat Karein' },
  },

  customAreaSearch: {
    defaultLabel: { en: "Don't see your area in the list?", hi: 'Aapka Area List Mein Nahi Hai?' },
    hint: { en: 'You can type a city name, district name, or a direct PIN code in this box.', hi: 'Is box mein city ka naam, district ka naam, ya seedha PIN code likh sakte hain.' },
    chipCity: { en: '🏙️ City — e.g. Saharanpur', hi: '🏙️ City — e.g. Saharanpur' },
    chipDistrict: { en: '🗺️ District — e.g. Sirmaur', hi: '🗺️ District — e.g. Sirmaur' },
    chipPin: { en: '🔢 PIN — e.g. 135001', hi: '🔢 PIN — e.g. 135001' },
    placeholder: { en: 'Type city, district or PIN — Saharanpur / Ambala / 135001', hi: 'City, district ya PIN likhein — Saharanpur / Ambala / 135001' },
    errorPinNotFound: { en: 'This PIN code was not found. Check the correct 6-digit PIN.', hi: 'Yeh PIN code nahi mila. Sahi 6-digit PIN check karein.' },
    errorNoResults: { en: 'No area found for this search. Try the full or correct name.', hi: 'Iske liye koi area nahi mila. Poora ya sahi naam try karein.' },
    errorGeneric: { en: 'There was a problem searching. Please try again.', hi: 'Search mein problem aa rahi hai. Dobara try karein.' },
    add: { en: 'Add', hi: 'Add' },
    added: { en: '✓ Added', hi: '✓ Added' },
    moreResultsPrefix: { en: 'more results found — make your search', hi: 'aur results mile — search ko' },
    moreResultsSuffix: { en: 'more specific (e.g. full area/PIN)', hi: 'zyada specific karein (jaise poora area/PIN)' },
    addedAreasLabel: { en: 'New areas you added', hi: 'Naye Areas Jo Aapne Add Kiye' },
    pendingPricingNote: {
      en: 'These are new areas not yet in our list. After you submit registration, our team will confirm pricing within 24 hours and inform you on WhatsApp. Pricing for your other selected areas is shown instantly above.',
      hi: 'Yeh naye areas hain jo abhi hamari list mein nahi hain. Registration submit karne ke baad hamari team 24 ghante mein pricing confirm karke aapko WhatsApp par bata degi. Baaki selected areas ki pricing upar turant dikh rahi hai.',
    },
  },

  registerPage: {
    progressDetails: { en: 'Details', hi: 'Details' },
    progressAreas: { en: 'Areas', hi: 'Areas' },
    progressPremium: { en: 'Premium', hi: 'Premium' },
    progressReview: { en: 'Review', hi: 'Review' },

    step1Title: { en: 'Fill in Your Details', hi: 'Apni Details Bharein' },
    labelFullName: { en: 'Full Name *', hi: 'Full Name *' },
    labelQualification: { en: 'Qualification *', hi: 'Qualification *' },
    labelSpeciality: { en: 'Speciality *', hi: 'Speciality *' },
    selectSpecialityOption: { en: 'Select speciality...', hi: 'Select speciality...' },
    labelRegNumber: { en: 'MCI/NMC Reg. Number *', hi: 'MCI/NMC Reg. Number *' },
    labelClinicName: { en: 'Clinic Name *', hi: 'Clinic Name *' },
    labelConsultFee: { en: 'Consultation Fee (₹)', hi: 'Consultation Fee (₹)' },
    labelAddress: { en: 'Clinic Address *', hi: 'Clinic Address *' },
    placeholderAddress: { en: 'Full address with landmark', hi: 'Full address with landmark' },
    labelPhone: { en: 'Phone (+91) *', hi: 'Phone (+91) *' },
    labelEmail: { en: 'Email', hi: 'Email' },
    labelWorkingDays: { en: 'Working Days', hi: 'Working Days' },
    labelWorkingHours: { en: 'Working Hours', hi: 'Working Hours' },

    step2Title: { en: 'Choose Your Areas', hi: 'Apne Areas Chunein' },
    step2Desc: {
      en: 'Select the areas where you want to reach patients. Pricing for your selected areas will be confirmed by our team.',
      hi: 'Un areas ko select karein jahan aap patients tak pahunchna chahte hain. Pricing aapke selected areas ke hisaab se hamari team confirm karegi.',
    },
    btnSelectAll: { en: 'Select All 20', hi: 'Select All 20' },
    btnClear: { en: 'Clear', hi: 'Clear' },
    btnCore2: { en: 'Core 2 Areas', hi: 'Core 2 Areas' },
    selectAreaPrompt: { en: 'Select at least one area to continue', hi: 'Select at least one area to continue' },
    areaCountSuffix: { en: 'area(s) selected — pricing details will reach you on WhatsApp', hi: 'area selected — pricing team se WhatsApp par milegi' },

    step3Title: { en: 'Premium Positioning', hi: 'Premium Positioning' },
    step3Optional: { en: '(Optional)', hi: '(Optional)' },
    step3Desc: {
      en: 'Want to appear at the top of your speciality? Let us know your interest — the team will confirm pricing.',
      hi: 'Apni speciality mein sabse upar dikhna chahte hain? Interest batayein — pricing team confirm karegi.',
    },
    premiumCheckbox: { en: 'Yes, I am interested in a premium position', hi: 'Haan, mujhe premium position mein interest hai' },
    premiumPos1: { en: 'Position 1 — Top of List', hi: 'Position 1 — Top of List' },
    premiumPos2: { en: 'Position 2 — Second Spot', hi: 'Position 2 — Second Spot' },
    premiumPos3: { en: 'Position 3 — Third Spot', hi: 'Position 3 — Third Spot' },
    premiumNote: { en: 'Pricing will be confirmed on WhatsApp based on your selected areas.', hi: 'Pricing aapke selected areas ke hisaab se WhatsApp par confirm ki jayegi.' },

    step4Title: { en: 'Review & Submit', hi: 'Review & Submit' },
    summaryName: { en: 'Name', hi: 'Name' },
    summaryQualification: { en: 'Qualification', hi: 'Qualification' },
    summarySpeciality: { en: 'Speciality', hi: 'Speciality' },
    summaryReg: { en: 'Reg. Number', hi: 'Reg. Number' },
    summaryClinic: { en: 'Clinic', hi: 'Clinic' },
    summaryPhone: { en: 'Phone', hi: 'Phone' },
    summaryAreas: { en: 'Areas', hi: 'Areas' },
    summaryNoneSelected: { en: 'None selected', hi: 'None selected' },
    summaryPremiumInterest: { en: 'Premium interest', hi: 'Premium interest' },
    nextStepsTitle: { en: "What Happens Next?", hi: 'Aage Kya Hoga?' },
    nextStep1: { en: 'Our team verifies your MCI/NMC number (24-48 hours)', hi: 'Hamari team aapka MCI/NMC number verify karegi (24-48 ghante)' },
    nextStep2: { en: 'Pricing for your selected areas is sent on WhatsApp', hi: 'Aapke selected areas ke hisaab se pricing WhatsApp par bhejenge' },
    nextStep3: { en: 'On confirmation, your listing goes live immediately', hi: 'Confirm karne par listing turant activate ho jayegi' },

    btnBack: { en: 'Back', hi: 'Back' },
    btnNext: { en: 'Next', hi: 'Next' },
    btnSubmit: { en: '✓ Submit Registration', hi: '✓ Submit Registration' },
    btnSubmitting: { en: 'Submitting...', hi: 'Submitting...' },

    successTitle: { en: 'Registration Submitted!', hi: 'Registration Submitted!' },
    successThanks: { en: 'Thank you, Dr.', hi: 'Shukriya, Dr.' },
    successDesc: {
      en: 'Our team will verify your MCI number within 24-48 hours, and send pricing on WhatsApp based on your selected areas. Once confirmed, your listing will be activated immediately.',
      hi: 'Hamare team 24-48 ghante mein aapka MCI number verify karegi, aur aapke selected areas ke hisaab se pricing WhatsApp par bhejegi. Confirm karne ke baad listing turant activate ho jayegi.',
    },
    selectedAreasLabel: { en: 'Selected areas:', hi: 'Selected areas:' },
    alreadyRegistered: { en: 'Already registered?', hi: 'Already registered?' },
    loginHere: { en: 'Login here →', hi: 'Login here →' },
  },

  partnerPage: {
    heading: { en: 'Become a Sehatsandhi Partner', hi: 'Sehatsandhi Partner Banein' },
    subheading: { en: 'Reach thousands of patients in Yamuna Nagar', hi: 'Yamuna Nagar ke hazaron patients tak pahunchein' },
    typeQuestionTitle: { en: 'What are you?', hi: 'Aap Kya Hain?' },

    typePharmacy: { en: 'Pharmacy', hi: 'Pharmacy' },
    typePharmacyHindi: { en: 'दवाई की दुकान', hi: 'दवाई की दुकान' },
    typePharmacyDesc: { en: 'Medicine store, chemist', hi: 'Medicine store, chemist' },
    typeLab: { en: 'Diagnostic Lab', hi: 'Diagnostic Lab' },
    typeLabHindi: { en: 'जांच केंद्र', hi: 'जांच केंद्र' },
    typeLabDesc: { en: 'Blood tests, reports', hi: 'Blood tests, reports' },
    typeAmbulance: { en: 'Ambulance Service', hi: 'Ambulance Service' },
    typeAmbulanceHindi: { en: 'एम्बुलेंस सेवा', hi: 'एम्बुलेंस सेवा' },
    typeAmbulanceDesc: { en: 'Emergency & patient transport', hi: 'Emergency & patient transport' },
    typeInsurance: { en: 'Insurance Agent', hi: 'Insurance Agent' },
    typeInsuranceHindi: { en: 'बीमा एजेंट', hi: 'बीमा एजेंट' },
    typeInsuranceDesc: { en: 'Health insurance', hi: 'Health insurance' },

    benefitsTitle: { en: 'Benefits of Becoming a Partner', hi: 'Partner Banne Ke Fayde' },
    benefit1: { en: 'You will appear in the Sehatsandhi listing', hi: 'Sehatsandhi ki listing mein aayenge' },
    benefit2: { en: 'Direct orders/calls will come via WhatsApp', hi: 'WhatsApp par direct orders/calls milenge' },
    benefit3: { en: 'Referrals will come directly from doctors', hi: 'Doctor referrals directly milenge' },
    benefit4: { en: 'A monthly analytics report will be provided', hi: 'Monthly analytics report milegi' },
    benefit5: { en: 'You will get a verified partner badge', hi: 'Verified partner badge milega' },
    benefit6: { en: "Pricing depends on your area — our team will confirm", hi: 'Pricing aapke area ke hisaab se — team confirm karegi' },

    changeType: { en: 'Change partner type', hi: 'Partner type badlein' },
    registrationSuffix: { en: 'Registration', hi: 'Registration' },

    labelBusinessName: { en: 'Business/Shop name *', hi: 'Business/Shop naam *' },
    labelAgentName: { en: 'Your name *', hi: 'Aapka naam *' },
    labelFleetName: { en: 'Service/Fleet name *', hi: 'Service/Fleet naam *' },
    labelPhone: { en: 'Phone number *', hi: 'Phone number *' },
    labelEmail: { en: 'Email', hi: 'Email' },
    labelAddress: { en: 'Address *', hi: 'Address *' },
    placeholderAddress: { en: 'Full address with landmark', hi: 'Full address with landmark' },

    areaSectionLabel: { en: 'Which areas do you serve? *', hi: 'Kaun Se Areas Mein Service Dete Hain? *' },
    areaSectionNoteBase: { en: 'Only choose areas where you can genuinely commit to service', hi: 'Sirf woh areas chunein jahan aap genuinely service commit kar sakte hain' },
    areaNotePharmacy: { en: ' (delivery)', hi: ' (delivery)' },
    areaNoteLab: { en: ' (home collection)', hi: ' (home collection)' },
    areaNoteAmbulance: { en: ' (24/7 response)', hi: ' (24/7 response)' },
    areaNoteInsurance: { en: ' (home visit)', hi: ' (home visit)' },

    labelLicense: { en: 'Drug License Number *', hi: 'Drug License Number *' },
    labelDelivery: { en: 'Home Delivery?', hi: 'Home Delivery?' },
    yes: { en: 'Yes, delivery available', hi: 'Haan, delivery available' },
    no: { en: 'No, pickup only', hi: 'Nahi, sirf pickup' },
    labelHours: { en: 'Opening Hours', hi: 'Opening Hours' },
    label24Open: { en: '24 hours open?', hi: '24 hours open?' },
    yes247: { en: 'Yes, 24/7', hi: 'Haan, 24/7' },
    noFixed: { en: 'No', hi: 'Nahi' },

    labelLabLicense: { en: 'Lab License/Registration', hi: 'Lab License/Registration' },
    labelNABL: { en: 'NABL Certified?', hi: 'NABL Certified?' },
    nablYes: { en: 'Yes, NABL certified', hi: 'Haan, NABL certified' },
    nablNo: { en: 'No', hi: 'Nahi' },
    labelHomeCollection: { en: 'Home Collection?', hi: 'Home Collection?' },
    collectionYes: { en: 'Yes, we come home', hi: 'Haan, ghar par aate hain' },
    collectionNo: { en: 'No, lab only', hi: 'Nahi, sirf lab mein' },
    labelCollectionTiming: { en: 'Collection Timing', hi: 'Collection Timing' },

    labelPermit: { en: 'Ambulance Permit/Registration *', hi: 'Ambulance Permit/Registration *' },
    labelAmbulanceType: { en: 'Ambulance Type *', hi: 'Ambulance Type *' },
    typeBLS: { en: 'Basic Life Support (BLS)', hi: 'Basic Life Support (BLS)' },
    typeALS: { en: 'Advanced Life Support (ALS)', hi: 'Advanced Life Support (ALS)' },
    typeTransport: { en: 'Patient Transport (non-emergency)', hi: 'Patient Transport (non-emergency)' },
    label247: { en: '24/7 Available?', hi: '24/7 Available?' },
    available247Yes: { en: 'Yes, 24/7 available', hi: 'Haan, 24/7 available' },
    available247No: { en: 'No, fixed hours', hi: 'Nahi, fixed hours' },
    labelResponseTime: { en: 'Response Time Commitment *', hi: 'Response Time Commitment *' },
    response15: { en: '15 minutes', hi: '15 minutes' },
    response20: { en: '20 minutes', hi: '20 minutes' },
    response30: { en: '30 minutes', hi: '30 minutes' },
    ambulanceWarning: {
      en: '🚑 Emergency response is a serious public commitment — only choose a response time you can genuinely deliver 24/7.',
      hi: '🚑 Emergency response is a serious public commitment — sirf woh response time chunein jo aap genuinely 24/7 nibha sakte hain.',
    },

    labelIRDA: { en: 'IRDA License Number *', hi: 'IRDA License Number *' },
    labelCompany: { en: 'Company represented', hi: 'Company represented' },

    nextStepsTitle: { en: 'What Happens Next?', hi: 'Aage Kya Hoga?' },
    nextStep1: { en: 'Our team verifies your details within 24-48 hours', hi: 'Hamari team aapki details 24-48 ghante mein verify karegi' },
    nextStep2: { en: 'Pricing for your selected areas is sent on WhatsApp', hi: 'Aapke selected areas ke hisaab se pricing WhatsApp par bhejenge' },
    nextStep3: { en: 'On confirmation, agreement + listing go live', hi: 'Confirm karne par agreement + listing activate ho jayegi' },

    btnSubmit: { en: '✓ Submit Registration', hi: '✓ Registration Submit Karein' },
    btnSubmitting: { en: 'Submitting...', hi: 'Submit ho raha hai...' },
    selectedAreasPrefix: { en: 'Selected areas:', hi: 'Selected areas:' },
    noneYet: { en: 'None yet', hi: 'None yet' },

    successTitle: { en: 'Registration Submitted! 🎉', hi: 'Registration Submitted! 🎉' },
    successDesc: {
      en: 'Thank you! Our team will verify your details within 24-48 hours, confirm pricing for your selected areas on WhatsApp, and share the agreement.',
      hi: 'Shukriya! Hamare team 24-48 ghante mein aapki details verify karengi, aapke selected areas ke hisaab se pricing WhatsApp par bhejegi, aur agreement share karegi.',
    },
    successNextTitle: { en: 'What happens next:', hi: 'Aage kya hoga:' },
    successNext1: { en: 'Team will call for verification', hi: 'Team call karegi verification ke liye' },
    successNext2: { en: 'Pricing will be confirmed for your areas', hi: 'Aapke areas ke hisaab se pricing confirm hogi' },
    successNext3: { en: 'Agreement will be shared', hi: 'Agreement share kiya jayega' },
    successNext4: { en: 'Listing will be activated', hi: 'Listing activate ho jayegi' },
  },
}

export function getTranslation(path: string, lang: Lang): string {
  const parts = path.split('.')
  let node: Entry | Tree = translations
  for (const part of parts) {
    const next: Entry | Tree | undefined = (node as Tree)[part]
    if (next === undefined) return path
    node = next
  }
  if (node && typeof node === 'object' && lang in node) {
    return (node as Entry)[lang]
  }
  return path
}
