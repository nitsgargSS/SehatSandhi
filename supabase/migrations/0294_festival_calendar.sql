-- ============================================================================
-- 0294 — Every festival in the posts calendar, Nov 2026 to Nov 2027
-- ============================================================================
-- AFTER 0293. Safe to re-run.
--
-- Asked for 29 Oct 2026: Dhanteras, Choti Diwali, Teej, Bhai Dooj, Ahoi and
-- the rest, so each gets its own post. Lunar festivals move every year, so
-- each row is dated. Dates: Drik Panchang (New Delhi), checked 29 Oct 2026;
-- Lohri, Baisakhi and Guru Nanak Jayanti 2027 and both Eids from Indian
-- holiday lists. The Eids depend on the moon being sighted and can move by a
-- day — check them in admin a week before.
--
-- Choti Diwali 2026: Drik Panchang puts Narak Chaturdashi on 8 Nov, the same
-- day as Diwali; it is kept on 7 Nov (Kali Chaudas) so each gets its own post.
-- The angle gives the writer a health line that fits the day — fasting,
-- sweets, smoke, firecrackers — without turning wishes into advice.
-- ============================================================================

insert into social_calendar (kind, month, day, year, title_en, title_hi, specialities, angle) values
  -- 2026
  ('festival', 11,  1, 2026, 'Ahoi Ashtami', 'अहोई अष्टमी', '{}', 'Wishes to every mother; after a day-long fast, break it gently with water and light food'),
  ('festival', 11,  6, 2026, 'Dhanteras', 'धनतेरस', '{}', 'Dhanteras wishes; good health is the first wealth (पहला सुख निरोगी काया)'),
  ('festival', 11,  7, 2026, 'Choti Diwali', 'छोटी दिवाली', '{}', 'Choti Diwali wishes; light diyas safely, keep children away from firecrackers'),
  ('festival', 11, 10, 2026, 'Govardhan Puja', 'गोवर्धन पूजा', '{}', 'Govardhan Puja wishes; go easy on sweets, especially with diabetes'),
  ('festival', 11, 11, 2026, 'Bhai Dooj', 'भाई दूज', '{}', 'Bhai Dooj wishes; look after each other''s health'),
  ('festival', 11, 15, 2026, 'Chhath Puja', 'छठ पूजा', '{}', 'Chhath Puja wishes; during the fast and long hours in the water, rest and drink enough after'),
  ('festival', 11, 24, 2026, 'Guru Nanak Jayanti', 'गुरु नानक जयंती', '{}', 'Gurpurab wishes; seva and kindness'),
  -- 2027
  ('festival',  1, 13, 2027, 'Lohri', 'लोहड़ी', '{}', 'Lohri wishes; stay a safe distance from the bonfire, smoke irritates eyes'),
  ('festival',  1, 15, 2027, 'Makar Sankranti', 'मकर संक्रांति', '{}', 'Makar Sankranti wishes; careful with kite strings, protect eyes from the sun'),
  ('festival',  2, 11, 2027, 'Basant Panchami', 'बसंत पंचमी', '{}', 'Basant Panchami wishes'),
  ('festival',  3,  6, 2027, 'Maha Shivratri', 'महाशिवरात्रि', '{}', 'Maha Shivratri wishes; fasting safely, especially with diabetes or BP'),
  ('festival',  3, 10, 2027, 'Eid ul-Fitr', 'ईद-उल-फ़ित्र', '{}', 'Eid Mubarak wishes (date depends on the moon)'),
  ('festival',  3, 21, 2027, 'Holika Dahan', 'होलिका दहन', '{}', 'Holika Dahan wishes; keep a distance from the fire and smoke'),
  ('festival',  4,  7, 2027, 'Chaitra Navratri', 'चैत्र नवरात्रि', '{}', 'Navratri wishes; healthy fasting: water, fruit, do not skip medicines'),
  ('festival',  4, 14, 2027, 'Baisakhi', 'बैसाखी', '{}', 'Baisakhi wishes'),
  ('festival',  4, 15, 2027, 'Ram Navami', 'राम नवमी', '{}', 'Ram Navami wishes'),
  ('festival',  4, 20, 2027, 'Hanuman Jayanti', 'हनुमान जयंती', '{}', 'Hanuman Jayanti wishes; strength and good health'),
  ('festival',  5,  9, 2027, 'Akshaya Tritiya', 'अक्षय तृतीया', '{}', 'Akshaya Tritiya wishes'),
  ('festival',  5, 17, 2027, 'Eid al-Adha', 'ईद-उल-अज़हा', '{}', 'Eid al-Adha (Bakrid) wishes (date depends on the moon)'),
  ('festival',  5, 20, 2027, 'Buddha Purnima', 'बुद्ध पूर्णिमा', '{}', 'Buddha Purnima wishes; peace of mind'),
  ('festival',  7, 18, 2027, 'Guru Purnima', 'गुरु पूर्णिमा', '{}', 'Guru Purnima: thanks to every teacher'),
  ('festival',  8,  4, 2027, 'Hariyali Teej', 'हरियाली तीज', '{}', 'Hariyali Teej wishes; fasting in the monsoon heat, drink enough after'),
  ('festival',  8, 17, 2027, 'Raksha Bandhan', 'रक्षाबंधन', '{}', 'Raksha Bandhan wishes; protect each other''s health'),
  ('festival',  8, 25, 2027, 'Janmashtami', 'जन्माष्टमी', '{}', 'Janmashtami wishes; safe fasting'),
  ('festival',  9,  3, 2027, 'Hartalika Teej', 'हरतालिका तीज', '{}', 'Hartalika Teej wishes; a long fast, so break it gently'),
  ('festival',  9,  4, 2027, 'Ganesh Chaturthi', 'गणेश चतुर्थी', '{}', 'Ganesh Chaturthi wishes'),
  ('festival',  9, 30, 2027, 'Sharad Navratri', 'शारदीय नवरात्रि', '{}', 'Navratri wishes; healthy fasting, do not skip diabetes or BP medicines'),
  ('festival', 10,  7, 2027, 'Durga Ashtami', 'दुर्गा अष्टमी', '{}', 'Durga Ashtami wishes'),
  ('festival', 10, 18, 2027, 'Karwa Chauth', 'करवा चौथ', '{}', 'Karwa Chauth wishes; a full-day fast without water, so drink and eat gently after'),
  ('festival', 10, 22, 2027, 'Ahoi Ashtami', 'अहोई अष्टमी', '{}', 'Wishes to every mother; after a day-long fast, break it gently with water and light food'),
  ('festival', 10, 27, 2027, 'Dhanteras', 'धनतेरस', '{}', 'Dhanteras wishes; good health is the first wealth (पहला सुख निरोगी काया)'),
  ('festival', 10, 28, 2027, 'Choti Diwali', 'छोटी दिवाली', '{}', 'Choti Diwali wishes; light diyas safely, keep children away from firecrackers'),
  ('festival', 10, 29, 2027, 'Diwali', 'दीपावली', '{}', 'Happy Diwali wishes; for eye clinics, firecracker eye safety'),
  ('festival', 10, 30, 2027, 'Govardhan Puja', 'गोवर्धन पूजा', '{}', 'Govardhan Puja wishes; go easy on sweets, especially with diabetes'),
  ('festival', 10, 31, 2027, 'Bhai Dooj', 'भाई दूज', '{}', 'Bhai Dooj wishes; look after each other''s health'),
  ('festival', 11,  4, 2027, 'Chhath Puja', 'छठ पूजा', '{}', 'Chhath Puja wishes; during the fast and long hours in the water, rest and drink enough after'),
  ('festival', 11, 14, 2027, 'Guru Nanak Jayanti', 'गुरु नानक जयंती', '{}', 'Gurpurab wishes; seva and kindness')
on conflict do nothing;
