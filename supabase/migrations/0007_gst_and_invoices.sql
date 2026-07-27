-- ============================================================================
-- Sehatsandhi — GST on listing fees, and GST-compliant invoices
--
-- Applied by npm run migrate, after 0006 (pricing plans).
-- Safe to re-run.
--
-- WHAT WE SELL, AND WHY IT IS TAXED
-- A listing fee buys advertising and lead generation — SAC 998365, sale of
-- internet advertising space, 18% after the September 2025 rate revision. The
-- healthcare exemptions do not apply: those cover the doctor's service to the
-- patient, not our fee to the doctor. The 10% commission is a service fee at the
-- same standard slab.
--
-- Rate and SAC live in tax_settings so a CA's answer changes a row, not code.
--
-- PRICES ARE GST-EXCLUSIVE
-- pricing_plans.monthly_price is the taxable value. A ₹1,000 plan charges
-- ₹1,180. A registered business reclaims the ₹180 as input tax credit, so their
-- real cost stays ₹1,000. pricing_plans.price_includes_gst flips this per plan
-- if a later offer needs to be all-in.
--
-- INTRA vs INTER-STATE
-- Place of supply for a registered recipient is their location. Same state as
-- ours -> CGST 9% + SGST 9%. Different state -> IGST 18%. The recipient's state
-- comes from the first two digits of their GSTIN when they give one, so the
-- split follows the GSTIN rather than a self-declared address.
--
-- BEFORE THIS DOES ANYTHING: fill in tax_settings with your real GSTIN, legal
-- name and registered address. gst_enabled stays false until you do, because an
-- invoice without a supplier GSTIN is not a tax invoice, and charging GST you
-- cannot account for is worse than not charging it.
-- ============================================================================

-- ============================================================================
-- tax_settings — one row. Who we are on a tax invoice.
-- ============================================================================

create table if not exists tax_settings (
  id boolean primary key default true,
  legal_name text,                              -- as registered with GST
  trade_name text default 'Sehatsandhi',
  gstin text,                                   -- 15 chars; invoices are not valid without it
  state_code text,                              -- first 2 digits of the GSTIN, e.g. '06' Haryana
  state_name text,
  registered_address text,
  city text,
  pin_code text,
  email text,
  phone text,

  sac_code text default '998365',               -- sale of internet advertising space
  service_description text default 'Business listing and lead generation services on the Sehatsandhi platform',
  gst_rate numeric(5,2) default 18.00,

  -- Nothing charges or shows GST until this is true AND a gstin is present.
  gst_enabled boolean default false,

  invoice_prefix text default 'SS',             -- invoice numbers look like SS/2026-27/0001
  invoice_terms text default 'Amount received in full. This is a computer-generated invoice.',

  updated_by text,
  updated_at timestamptz default now(),
  constraint tax_settings_single_row check (id)
);

insert into tax_settings (id) values (true) on conflict (id) do nothing;

-- A GSTIN is 2 state digits + 10-char PAN + entity code + 'Z' + checksum.
do $$ begin
  alter table tax_settings add constraint tax_settings_gstin_format
    check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$') not valid;
exception when duplicate_object then null; end $$;

drop trigger if exists tax_settings_touch_updated_at on tax_settings;
create trigger tax_settings_touch_updated_at before update on tax_settings
  for each row execute function sehat_touch_updated_at();

comment on column tax_settings.gst_enabled is
  'Master switch. While false, prices are charged with no tax and invoices carry no GST lines. '
  'Turn on only once gstin, legal_name and registered_address are filled in.';

-- ============================================================================
-- Plans can be quoted inclusive or exclusive of GST. Default exclusive.
-- ============================================================================

alter table pricing_plans add column if not exists price_includes_gst boolean default false;

-- ============================================================================
-- doctors — the business's own GST details. Optional: an unregistered business
-- still gets an invoice, just without a recipient GSTIN.
-- ============================================================================

alter table doctors add column if not exists gstin text;
alter table doctors add column if not exists gst_legal_name text;   -- if different from the listing name
alter table doctors add column if not exists state_code text;       -- derived from gstin when given
alter table doctors add column if not exists billing_address text;

do $$ begin
  alter table doctors add constraint doctors_gstin_format
    check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$') not valid;
exception when duplicate_object then null; end $$;

-- Keep state_code in step with the GSTIN automatically — the split between
-- CGST/SGST and IGST depends on it, so it must not drift from a typed address.
create or replace function sehat_doctor_state_from_gstin()
returns trigger language plpgsql as $$
begin
  if new.gstin is not null and length(new.gstin) = 15 then
    new.state_code := left(new.gstin, 2);
  end if;
  return new;
end $$;

drop trigger if exists doctors_state_from_gstin on doctors;
create trigger doctors_state_from_gstin before insert or update of gstin on doctors
  for each row execute function sehat_doctor_state_from_gstin();

-- ============================================================================
-- payments — the tax breakdown of what was charged. `amount` stays the grand
-- total actually taken, so nothing that reads it today changes meaning.
-- ============================================================================

alter table payments add column if not exists taxable_value numeric(12,2);
alter table payments add column if not exists gst_rate numeric(5,2);
alter table payments add column if not exists cgst_amount numeric(12,2) default 0;
alter table payments add column if not exists sgst_amount numeric(12,2) default 0;
alter table payments add column if not exists igst_amount numeric(12,2) default 0;
alter table payments add column if not exists tax_total numeric(12,2) default 0;
alter table payments add column if not exists place_of_supply text;

-- ============================================================================
-- Invoice numbering — consecutive, unique per financial year, gapless.
--
-- Rule 46 wants a consecutive serial number not exceeding 16 characters. A
-- sequence would leak gaps on rollback, so this is a counter row taken under a
-- row lock: two simultaneous payments queue rather than collide or skip.
-- ============================================================================

create table if not exists invoice_counters (
  fy text primary key,                     -- '2026-27'
  last_number integer not null default 0
);

-- Indian FY runs April to March.
create or replace function sehat_financial_year(d date default current_date)
returns text language sql immutable as $$
  select case when extract(month from d) >= 4
    then extract(year from d)::int || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1) || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0')
  end
$$;

create or replace function sehat_next_invoice_number(p_date date default current_date)
returns text language plpgsql as $$
declare
  v_fy text;
  v_n integer;
  v_prefix text;
begin
  v_fy := sehat_financial_year(p_date);
  select coalesce(invoice_prefix, 'SS') into v_prefix from tax_settings where id;

  insert into invoice_counters (fy, last_number) values (v_fy, 0)
  on conflict (fy) do nothing;

  -- FOR UPDATE serialises concurrent issuers, so numbers are gapless.
  select last_number + 1 into v_n from invoice_counters where fy = v_fy for update;
  update invoice_counters set last_number = v_n where fy = v_fy;

  return v_prefix || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $$;

-- ============================================================================
-- invoices — the issued document. Every party detail is SNAPSHOTTED, never
-- joined: an invoice must still read correctly years later even if the business
-- renames itself, moves, or our own address changes.
-- ============================================================================

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,
  invoice_date date not null default current_date,
  fy text not null,

  doctor_id uuid references doctors(id) on delete set null,
  payment_id uuid references payments(id) on delete set null,

  -- One invoice per payment. Re-running the issuer is then harmless.
  unique (payment_id),

  -- supplier snapshot (us)
  supplier_legal_name text,
  supplier_trade_name text,
  supplier_gstin text,
  supplier_state_code text,
  supplier_address text,

  -- recipient snapshot (the business); gstin null = unregistered
  recipient_name text,
  recipient_gstin text,
  recipient_state_code text,
  recipient_address text,
  recipient_phone text,
  recipient_email text,

  -- the supply
  sac_code text,
  description text,
  period_start date,
  period_end date,
  months integer,
  pin_codes text[],

  -- money, in rupees
  taxable_value numeric(12,2) not null default 0,
  gst_rate numeric(5,2) not null default 0,
  cgst_amount numeric(12,2) not null default 0,
  sgst_amount numeric(12,2) not null default 0,
  igst_amount numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,

  place_of_supply text,
  reverse_charge boolean default false,
  currency text default 'INR',

  -- how the business opens it: a long unguessable token, because the WhatsApp
  -- and email links have to work without a login
  public_token uuid not null default gen_random_uuid(),

  status text default 'issued',              -- issued | cancelled
  cancelled_reason text,
  sent_whatsapp_at timestamptz,
  sent_email_at timestamptz,
  send_error text,

  created_at timestamptz default now()
);

do $$ begin
  alter table invoices add constraint invoices_status_check
    check (status in ('issued', 'cancelled')) not valid;
exception when duplicate_object then null; end $$;

-- Either CGST+SGST or IGST — never both. A row failing this is a broken invoice.
do $$ begin
  alter table invoices add constraint invoices_tax_split_check
    check ((igst_amount = 0) or (cgst_amount = 0 and sgst_amount = 0)) not valid;
exception when duplicate_object then null; end $$;

create unique index if not exists invoices_public_token_idx on invoices (public_token);
create index if not exists invoices_doctor_idx on invoices (doctor_id, invoice_date desc);
create index if not exists invoices_fy_idx on invoices (fy, invoice_number);

-- ============================================================================
-- Issuing an invoice from a paid payment.
--
-- Called by razorpay-verify once a signature checks out. Idempotent: a second
-- call for the same payment returns the invoice already issued rather than
-- burning another number.
-- ============================================================================

create or replace function sehat_issue_invoice(p_payment_id uuid)
returns invoices
language plpgsql security definer
set search_path = public
as $$
declare
  v_existing invoices;
  v_pay payments;
  v_doc doctors;
  v_ts tax_settings;
  v_inv invoices;
  v_recipient_state text;
  v_place text;
  v_taxable numeric(12,2);
  v_rate numeric(5,2);
  v_tax numeric(12,2);
  v_cgst numeric(12,2) := 0;
  v_sgst numeric(12,2) := 0;
  v_igst numeric(12,2) := 0;
begin
  select * into v_existing from invoices where payment_id = p_payment_id;
  if found then return v_existing; end if;

  select * into v_pay from payments where id = p_payment_id;
  if not found then raise exception 'no such payment: %', p_payment_id; end if;
  if v_pay.status <> 'paid' then
    raise exception 'payment % is % — only a paid payment gets an invoice', p_payment_id, v_pay.status;
  end if;

  select * into v_ts from tax_settings where id;
  select * into v_doc from doctors where id = v_pay.doctor_id;

  -- Prefer the breakdown the order function already computed and charged, so
  -- the invoice can never disagree with the money that moved.
  v_rate    := coalesce(v_pay.gst_rate, 0);
  v_taxable := coalesce(v_pay.taxable_value, v_pay.amount, 0);
  v_tax     := coalesce(v_pay.tax_total, 0);
  v_cgst    := coalesce(v_pay.cgst_amount, 0);
  v_sgst    := coalesce(v_pay.sgst_amount, 0);
  v_igst    := coalesce(v_pay.igst_amount, 0);

  v_recipient_state := coalesce(v_doc.state_code, v_ts.state_code);
  v_place := coalesce(v_pay.place_of_supply, v_recipient_state);

  insert into invoices (
    invoice_number, invoice_date, fy,
    doctor_id, payment_id,
    supplier_legal_name, supplier_trade_name, supplier_gstin, supplier_state_code, supplier_address,
    recipient_name, recipient_gstin, recipient_state_code, recipient_address, recipient_phone, recipient_email,
    sac_code, description, period_start, period_end, months, pin_codes,
    taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, tax_total, total_amount,
    place_of_supply, reverse_charge
  ) values (
    sehat_next_invoice_number(current_date), current_date, sehat_financial_year(current_date),
    v_pay.doctor_id, p_payment_id,
    v_ts.legal_name, v_ts.trade_name, v_ts.gstin, v_ts.state_code,
    concat_ws(', ', v_ts.registered_address, v_ts.city, v_ts.pin_code),
    coalesce(v_doc.gst_legal_name, v_doc.clinic_name, v_doc.name),
    v_doc.gstin, v_recipient_state,
    coalesce(v_doc.billing_address, v_doc.address), v_doc.phone, v_doc.email,
    v_ts.sac_code, v_ts.service_description,
    v_pay.term_start, v_pay.term_end, v_pay.period_months, v_pay.pin_codes,
    v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_tax, coalesce(v_pay.amount, 0),
    v_place, false
  )
  returning * into v_inv;

  return v_inv;
end $$;

-- ============================================================================
-- invoice_register — what a CA needs for GSTR-1, and a CSV export.
-- ============================================================================

create or replace view invoice_register as
select
  invoice_number,
  invoice_date,
  fy,
  recipient_name,
  recipient_gstin,
  case when recipient_gstin is null then 'B2C' else 'B2B' end as supply_type,
  place_of_supply,
  sac_code,
  taxable_value,
  gst_rate,
  cgst_amount,
  sgst_amount,
  igst_amount,
  tax_total,
  total_amount,
  status
from invoices
order by fy, invoice_number;

-- Money collected per month, for reconciliation.
create or replace view invoice_monthly_summary as
select
  fy,
  to_char(invoice_date, 'YYYY-MM')            as month,
  count(*)                                     as invoices,
  sum(taxable_value)                           as taxable_value,
  sum(cgst_amount + sgst_amount + igst_amount) as tax_collected,
  sum(total_amount)                            as total_collected
from invoices
where status = 'issued'
group by fy, to_char(invoice_date, 'YYYY-MM')
order by month desc;

-- ============================================================================
-- RLS
--
-- Invoices carry the business's name, address, GSTIN and what they paid. Service
-- role only; the public invoice link is served by the invoice-view edge
-- function, which looks a row up by its token and returns just that one.
--
-- tax_settings is readable by the site so the wizard can show "+18% GST" before
-- a listing row exists. It holds no secret — a GSTIN is on every invoice we
-- issue — but writes stay server-side.
-- ============================================================================

alter table invoices          enable row level security;
alter table invoice_counters  enable row level security;
alter table tax_settings      enable row level security;

revoke all on invoices, invoice_counters from anon, authenticated;
revoke all on invoice_register, invoice_monthly_summary from anon, authenticated;

drop policy if exists "read_tax_settings" on tax_settings;
create policy "read_tax_settings" on tax_settings for select using (true);

-- ============================================================================
-- FILL THIS IN BEFORE GOING LIVE
--
--   update tax_settings set
--     legal_name        = '<your registered legal name>',
--     gstin             = '<your 15-char GSTIN>',
--     state_code        = left('<your 15-char GSTIN>', 2),
--     state_name        = 'Haryana',
--     registered_address= '<registered address>',
--     city              = 'Yamunanagar',
--     pin_code          = '135001',
--     email             = '<billing email>',
--     phone             = '<billing phone>',
--     gst_enabled       = true            -- last, once the rest is correct
--   where id;
--
-- Until gst_enabled is true, quotes and charges carry no tax and invoices are
-- issued without GST lines. That is the safe default, not an oversight.
--
-- To check what a CA needs to confirm:
--   • SAC 998365 (sale of internet advertising space) vs 998361 (advertising
--     services) — both 18%, but the classification should be deliberate.
--   • Whether the 10% commission model makes us a "commission agent" under
--     Sec 24(vii), which requires registration irrespective of turnover.
-- ============================================================================
