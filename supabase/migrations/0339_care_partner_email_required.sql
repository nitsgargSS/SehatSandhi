-- ============================================================================
-- 0339 — Care Partner Program: an email address is required
-- ============================================================================
-- AFTER 0338. Safe to re-run.
--
-- Nitin, 22 Nov 2026: "communication is done through emails" — receipts,
-- renewal notices and our replies go by email (partner pages show no phone).
-- So registration needs an email, one partner per email, and a partner who
-- registered before this (email empty) is asked for it once, on the
-- dashboard (sehat_care_set_email). The old checks in sehat_care_register
-- (format; not a doctor's or business's email) still run after this one.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'sehat_care_register_0331') then
    alter function sehat_care_register(jsonb) rename to sehat_care_register_0331;
  end if;
end $$;
revoke all on function sehat_care_register_0331(jsonb) from public, anon, authenticated;

create or replace function sehat_care_email_check(p_email text, p_partner uuid default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if v is null then raise exception 'Please enter your email address. We send receipts and updates there.' using errcode = '22023'; end if;
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please check your email address.' using errcode = '22023'; end if;
  if exists (select 1 from care_partners where lower(email) = v and id is distinct from p_partner) then
    raise exception 'This email is already used by another partner.' using errcode = 'P0001';
  end if;
  return v;
end $$;
revoke all on function sehat_care_email_check(text, uuid) from public, anon, authenticated;

create or replace function sehat_care_register(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform sehat_care_email_check(p->>'email');
  return sehat_care_register_0331(p);
end $$;
revoke all on function sehat_care_register(jsonb) from public, anon;
grant execute on function sehat_care_register(jsonb) to authenticated;

-- A partner adds or corrects their email (also the one-time prompt).
create or replace function sehat_care_set_email(p_email text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; v text;
begin
  p := sehat_care_me_row();
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  v := sehat_care_email_check(p_email, p.id);
  if exists (select 1 from businesses b where lower(b.email) = v)
     or exists (select 1 from practitioners pr where lower(pr.email) = v
                 and (nullif(btrim(coalesce(pr.reg_number, '')), '') is not null
                      or exists (select 1 from business_practitioners bp where bp.practitioner_id = pr.id and bp.role in ('doctor', 'owner')))) then
    raise exception 'This email belongs to a doctor or business on Sehatsandhi.' using errcode = 'P0001';
  end if;
  update care_partners set email = v, updated_at = now() where id = p.id;
  if p.marketing_partner_id is not null then
    update marketing_partners set email = v where id = p.marketing_partner_id;
  end if;
  return v;
end $$;
revoke all on function sehat_care_set_email(text) from public, anon;
grant execute on function sehat_care_set_email(text) to authenticated;

notify pgrst, 'reload schema';
