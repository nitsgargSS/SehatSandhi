-- ============================================================================
-- 0231 — Three broadcast templates end in words, not in a variable
-- ============================================================================
-- AFTER 0230. Safe to re-run.
--
-- Meta refuses a template whose body ends with a variable. Three of the
-- library's did (0116, 0219). Each gets a short fixed close, the same words
-- as the template submitted to Meta (scripts/wa-templates.py), so what a
-- clinic previews is what its patients receive.
-- ============================================================================

update wa_message_templates set body = 'Namaste from {{1}}. Please note: {{2}} Thank you.', updated_at = now()
 where code = 'clinic_notice' and body not like '% Thank you.';
update wa_message_templates set body = 'Health tip from {{1}}: {{2}} Stay healthy.', updated_at = now()
 where code = 'health_advice' and body not like '% Stay healthy.';
update wa_message_templates set body = 'Namaste from {{1}}. Wishing you and your family a very happy {{2}}. {{3}} Warm regards.', updated_at = now()
 where code = 'festival_greeting' and body not like '% Warm regards.';
