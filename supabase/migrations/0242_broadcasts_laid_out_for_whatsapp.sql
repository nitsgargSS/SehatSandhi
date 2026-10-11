-- ============================================================================
-- 0242 — Broadcasts laid out for WhatsApp: bold name, a line per detail, emoji
-- ============================================================================
-- AFTER 0241. Safe to re-run. APPLY ONLY AFTER Meta has approved the '…_2'
-- templates (scripts/wa-templates.py): this points each library row at its
-- successor and shows the clinic the same words Meta will send.
--
-- The plain one-paragraph bodies read like a form letter. The same blanks,
-- unchanged, now sit in a message with the clinic's name in bold on top and
-- each detail on its own line. A blank is still one paragraph — WhatsApp does
-- not allow a line break inside one — so the layout comes from the template.
-- ============================================================================

update wa_message_templates t
   set meta_name = v.meta_name, body = v.body, updated_at = now()
  from (values
  ('appointment_reminder', 'appointment_reminder_2', E'🏥 *{{1}}*\n\nNamaste 🙏 This is a reminder to book your follow-up visit.\n\n📋 {{2}}\n\nReply here or call us to book.'),
  ('clinic_notice', 'clinic_notice_2', E'📢 *{{1}}*\n\nNamaste 🙏 Please note:\n\n{{2}}\n\nThank you.'),
  ('health_camp', 'health_camp_2', E'🏥 *{{1}}*\n\nNamaste 🙏 You are invited to our *{{2}}*.\n\n🗓 {{3}}\n📍 {{4}}\n\nAll are welcome.'),
  ('new_service', 'new_service_2', E'✨ *{{1}}*\n\nNamaste 🙏 We now offer:\n\n✅ {{2}}\n\nReply here to know more or to book.'),
  ('health_advice', 'health_advice_2', E'🌿 *Health tip from {{1}}*\n\n{{2}}\n\nStay well 🙏'),
  ('festival_greeting', 'festival_greeting_2', E'🎉 *{{1}}*\n\nNamaste 🙏 Wishing you and your family a very happy *{{2}}*!\n\n{{3}}\n\nWarm regards 🌸'),
  ('new_speciality', 'new_speciality_2', E'🏥 *{{1}}*\n\nNamaste 🙏 We have added *{{2}}* at our clinic.\n\n🕒 {{3}}\n\nReply here to know more or to book.'),
  ('new_doctor', 'new_doctor_2', E'🩺 *{{1}}*\n\nNamaste 🙏 *{{2}}* ({{3}}) has joined us.\n\n🕒 Available: {{4}}\n\nReply here to book an appointment.'),
  ('clinic_message', 'clinic_message_2', E'💬 *{{1}}*\n\n{{2}}\n\nTo book or to ask a question, reply here 🙏'),
  ('clinic_image', 'clinic_image_2', E'💬 *{{1}}*\n\n{{2}}\n\nTo book or to ask a question, reply here 🙏'),
  ('appointment_reminder_hi', 'appointment_reminder_2', E'🏥 *{{1}}*\n\nनमस्ते 🙏 यह आपकी फ़ॉलो-अप विज़िट बुक करने का रिमाइंडर है।\n\n📋 {{2}}\n\nबुक करने के लिए यहीं जवाब दें या हमें कॉल करें।'),
  ('clinic_notice_hi', 'clinic_notice_2', E'📢 *{{1}}*\n\nनमस्ते 🙏 कृपया ध्यान दें:\n\n{{2}}\n\nधन्यवाद।'),
  ('health_camp_hi', 'health_camp_2', E'🏥 *{{1}}*\n\nनमस्ते 🙏 आप हमारे *{{2}}* में आमंत्रित हैं।\n\n🗓 {{3}}\n📍 {{4}}\n\nआप सभी का स्वागत है।'),
  ('new_service_hi', 'new_service_2', E'✨ *{{1}}*\n\nनमस्ते 🙏 अब हमारे यहाँ यह सुविधा उपलब्ध है:\n\n✅ {{2}}\n\nअधिक जानकारी या बुकिंग के लिए यहीं जवाब दें।'),
  ('health_advice_hi', 'health_advice_2', E'🌿 *सेहत की सलाह — {{1}}*\n\n{{2}}\n\nस्वस्थ रहें 🙏'),
  ('festival_greeting_hi', 'festival_greeting_2', E'🎉 *{{1}}*\n\nनमस्ते 🙏 आपको और आपके परिवार को *{{2}}* की हार्दिक शुभकामनाएँ!\n\n{{3}}\n\nसादर 🌸'),
  ('new_speciality_hi', 'new_speciality_2', E'🏥 *{{1}}*\n\nनमस्ते 🙏 हमारे यहाँ अब *{{2}}* शुरू हो गया है।\n\n🕒 {{3}}\n\nअधिक जानकारी या बुकिंग के लिए यहीं जवाब दें।'),
  ('new_doctor_hi', 'new_doctor_2', E'🩺 *{{1}}*\n\nनमस्ते 🙏 *{{2}}* ({{3}}) हमारे साथ जुड़ गए हैं।\n\n🕒 उपलब्ध: {{4}}\n\nअपॉइंटमेंट के लिए यहीं जवाब दें।'),
  ('clinic_message_hi', 'clinic_message_2', E'💬 *{{1}}*\n\n{{2}}\n\nबुकिंग या किसी सवाल के लिए यहीं जवाब दें 🙏'),
  ('clinic_image_hi', 'clinic_image_2', E'💬 *{{1}}*\n\n{{2}}\n\nबुकिंग या किसी सवाल के लिए यहीं जवाब दें 🙏')
  ) as v(code, meta_name, body)
 where t.code = v.code and (t.meta_name is distinct from v.meta_name or t.body is distinct from v.body);
