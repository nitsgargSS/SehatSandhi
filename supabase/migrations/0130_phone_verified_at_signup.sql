-- ============================================================================
-- Sehatsandhi — the business's WhatsApp number is verified, or admin calls it
--
-- Run AFTER 0129. Safe to re-run.
--
-- Decided 26 Sep 2026: at registration the email is verified by a code (the
-- wizard, before a password is accepted) and the WhatsApp number by a code sent
-- on WhatsApp. No WhatsApp sender works yet — the AiSensy plan has no API
-- campaigns — so the phone step is built switched off (phone-verify reports
-- enabled: false until PHONE_VERIFY_ENABLED and the AiSensy login campaign are
-- set). Until then admin confirms the number by calling it, and marks it.
--
--   phone_verifications     one row per code sent: who asked (their verified
--                           email login), which number, the code's hash, when it
--                           expires, how many guesses, when it was confirmed.
--                           Service role only.
--   businesses.phone_verified_at
--                           set by sehat_mark_phone_verified once the owner has
--                           confirmed a code for the listing's own number, or by
--                           admin after a call.
-- ============================================================================

create table if not exists phone_verifications (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid not null,
  phone text not null,                 -- 10 digits, sehat_norm_phone's shape
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists phone_verifications_lookup_idx
  on phone_verifications (auth_uid, phone, created_at desc);

alter table phone_verifications enable row level security;
revoke all on phone_verifications from anon, authenticated;

alter table businesses add column if not exists phone_verified_at timestamptz;

create or replace function sehat_mark_phone_verified(p_business uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_phone text;
begin
  if coalesce(sehat_caller_role(p_business), '') <> 'owner' then return false; end if;
  select sehat_norm_phone(phone) into v_phone from businesses where id = p_business;
  if v_phone is null then return false; end if;
  if not exists (
    select 1 from phone_verifications v
     where v.auth_uid = auth.uid() and v.phone = v_phone
       and v.verified_at is not null and v.verified_at > now() - interval '1 day'
  ) then return false; end if;
  update businesses set phone_verified_at = coalesce(phone_verified_at, now()) where id = p_business;
  return true;
end $$;

revoke all on function sehat_mark_phone_verified(uuid) from public, anon;
grant execute on function sehat_mark_phone_verified(uuid) to authenticated;

notify pgrst, 'reload schema';
