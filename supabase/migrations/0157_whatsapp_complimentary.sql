-- ============================================================================
-- Sehatsandhi — WhatsApp for a clinic, complimentary: switched on, never billed
--
-- Run AFTER 0140 on production, or after 0156 on sandbox. It depends on
-- nothing from 0141–0156, so it can go to production on its own (as 0146 and
-- 0153 did). Safe to re-run.
--
-- Decided 28 Sep 2026: an admin can give a clinic the WhatsApp add-on free —
-- a family clinic, a pilot, a partner. While business_wa_accounts.complimentary
-- is true:
--
--   • The account is kept 'active' with no billing end date, whatever writes
--     to it — so sehat_wa_access (0122) always answers 'active', the grace
--     period and lock never start, and sehat_wa_broadcast_blocker (0117) never
--     refuses on the subscription. A trigger holds this, so a plan payment
--     that ticked WhatsApp, or an admin changing the status by hand, cannot
--     start the clock by accident.
--   • The WhatsApp fee is left off every quote and payment for that clinic
--     (_shared/pricing.ts), even when WhatsApp is ticked, and renewal stops
--     assuming it. Buying the add-on mid-term is already refused ("already
--     included") for an account with no end date (whatsapp-addon-order).
--   • Messages are still paid from the clinic's wallet, like everyone's: give
--     free messages with "Adjust wallet" on the admin WhatsApp tab.
--
-- Turning it off leaves the account active with no end date; set it Inactive
-- or let the clinic buy the add-on to put it back on a paid term.
-- ============================================================================

alter table business_wa_accounts add column if not exists complimentary boolean not null default false;
alter table business_wa_accounts add column if not exists complimentary_note text;
alter table business_wa_accounts add column if not exists complimentary_set_by text;
alter table business_wa_accounts add column if not exists complimentary_since timestamptz;

create or replace function sehat_wa_complimentary_stays_active()
returns trigger
language plpgsql as $$
begin
  if new.complimentary then
    new.subscription_status := 'active';
    new.next_billing_date := null;
    new.past_due_since := null;
    new.subscription_started_at := coalesce(new.subscription_started_at, now());
  end if;
  return new;
end $$;

drop trigger if exists a_wa_complimentary on business_wa_accounts;
create trigger a_wa_complimentary before insert or update on business_wa_accounts
  for each row execute function sehat_wa_complimentary_stays_active();

-- For the admin tab, and for running once in the SQL editor on production
-- (where auth.uid() is null, as the database owner). Creates the account if
-- the clinic has none.
create or replace function sehat_admin_set_wa_complimentary(p_business uuid, p_on boolean, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_by text := coalesce((select email from auth.users where id = auth.uid()), 'database');
begin
  if auth.uid() is not null and not sehat_is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  if not exists (select 1 from businesses where id = p_business) then
    raise exception 'No such business.' using errcode = 'P0002';
  end if;

  insert into business_wa_accounts (business_id, complimentary, complimentary_note, complimentary_set_by, complimentary_since)
  values (p_business, coalesce(p_on, false), nullif(btrim(coalesce(p_note, '')), ''), v_by, case when p_on then now() end)
  on conflict (business_id) do update
     set complimentary = excluded.complimentary,
         complimentary_note = coalesce(excluded.complimentary_note, business_wa_accounts.complimentary_note),
         complimentary_set_by = excluded.complimentary_set_by,
         complimentary_since = case when excluded.complimentary then coalesce(business_wa_accounts.complimentary_since, now()) end;

  -- Renewal quotes and reminders should not assume the fee.
  if p_on then update businesses set renewal_whatsapp = false where id = p_business; end if;

  return (select jsonb_build_object('complimentary', a.complimentary, 'subscription_status', a.subscription_status,
                                    'next_billing_date', a.next_billing_date)
            from business_wa_accounts a where a.business_id = p_business);
end $$;

revoke all on function sehat_admin_set_wa_complimentary(uuid, boolean, text) from public, anon;
grant execute on function sehat_admin_set_wa_complimentary(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
