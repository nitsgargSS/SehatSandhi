-- ============================================================================
-- Sehatsandhi — naming a doctor should not require their personal number
--
-- Run AFTER 0031. Safe to re-run.
--
-- WHY
-- 0031 gave clinic_users the fields that describe a person, so a clinic can list
-- the doctors who practise there. Inserting one immediately fails:
--
--   null value in column "whatsapp_number" violates not-null constraint
--
-- The constraint made sense for what the table used to be. Every row existed to
-- receive a WhatsApp notification, so a row without a number was pointless. Now a
-- row can exist to say "Dr. Mehta practises here", and requiring a personal
-- mobile to put a name on a public profile means asking a clinic to hand over its
-- staff's contact details as the price of listing them. Most would refuse, and
-- they would be right to.
--
-- A number is still required to be *notified* — but that belongs where
-- notifications are configured, next to the notify_* flags it actually governs,
-- not on every row in the table.
-- ============================================================================

alter table clinic_users alter column whatsapp_number drop not null;

comment on column clinic_users.whatsapp_number is
  'Where this person receives notifications. Null for staff who are listed but '
  'not messaged — a doctor named on a clinic profile need not give a personal '
  'number. Required in practice for anyone with a notify_* flag set.';
