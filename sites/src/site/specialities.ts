// Sehatsandhi's speciality codes (src/types SPECIALITIES) with plain names,
// used to turn a hospital's doctors into departments.

export const SPECIALITIES: Record<string, { en: string; hi: string }> = {
  GEN: { en: 'General Medicine', hi: 'सामान्य चिकित्सा' },
  SKIN: { en: 'Dermatology (Skin)', hi: 'त्वचा रोग' },
  DENT: { en: 'Dental', hi: 'दंत चिकित्सा' },
  EYE: { en: 'Ophthalmology (Eye)', hi: 'नेत्र रोग' },
  PAED: { en: 'Paediatrics (Children)', hi: 'बाल रोग' },
  GYN: { en: 'Obstetrics & Gynaecology', hi: 'स्त्री व प्रसूति रोग' },
  IVF: { en: 'IVF & Fertility', hi: 'बांझपन / आईवीएफ' },
  ORTH: { en: 'Orthopaedics (Bones & Joints)', hi: 'हड्डी व जोड़ रोग' },
  CARD: { en: 'Cardiology (Heart)', hi: 'हृदय रोग' },
  ENT: { en: 'ENT (Ear, Nose, Throat)', hi: 'कान, नाक, गला' },
  GAST: { en: 'Gastroenterology (Stomach)', hi: 'पेट रोग' },
  NEUR: { en: 'Neurology (Brain & Spine)', hi: 'मस्तिष्क व रीढ़ रोग' },
  URO: { en: 'Urology', hi: 'मूत्र रोग' },
  ONC: { en: 'Oncology (Cancer)', hi: 'कैंसर' },
  PSY: { en: 'Psychiatry (Mental Health)', hi: 'मनोरोग' },
  DIAB: { en: 'Diabetes', hi: 'मधुमेह' },
  PHYS: { en: 'Physiotherapy', hi: 'फिज़ियोथेरेपी' },
  ALT: { en: 'Ayurveda & Homeopathy', hi: 'आयुर्वेद व होम्योपैथी' },
  PULM: { en: 'Pulmonology (Chest & Lungs)', hi: 'छाती व फेफड़े रोग' },
  ENDO: { en: 'Endocrinology (Thyroid & Hormones)', hi: 'हार्मोन रोग' },
  RHEU: { en: 'Rheumatology (Arthritis)', hi: 'गठिया रोग' },
  NEPH: { en: 'Nephrology (Kidney)', hi: 'किडनी रोग' },
  SURG: { en: 'General Surgery', hi: 'सर्जरी' },
  SEXO: { en: 'Sexual Health', hi: 'यौन रोग' },
  LAB: { en: 'Laboratory & Diagnostics', hi: 'जाँच व लैब' },
  PATH: { en: 'Pathology', hi: 'पैथोलॉजी' },
  RAD: { en: 'Radiology', hi: 'रेडियोलॉजी' },
};

export const specialityName = (code: string | null | undefined) =>
  (code && SPECIALITIES[code.toUpperCase()]) || (code ? { en: code, hi: code } : { en: 'Other', hi: 'अन्य' });
