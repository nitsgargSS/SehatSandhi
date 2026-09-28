-- ============================================================================
-- Sehatsandhi — in-house dispensing: a small clinic's own medicine counter
--
-- Run AFTER 0140 on production, or after 0157 on sandbox. It depends on
-- nothing from 0141–0157, so it can go to production on its own. Safe to
-- re-run.
--
-- ── WHAT IT IS ──────────────────────────────────────────────────────────────
-- Many small clinics keep a cupboard of medicines and hand them over after the
-- consultation. Today that is a register and a calculator. This gives them:
--
--   medicines → purchases (batch, expiry, MRP) → stock → a numbered pharmacy
--   bill (from the prescription, or a walk-in) → payments, part-payments and
--   credit → returns and cancellations that put stock back → a day's summary.
--
-- It is NOT the 'pharmacy' vertical. That is a separate chemist listing its
-- own shop. This is a module switched on for a clinic by a Sehatsandhi admin
-- (free, for now), shown in the admin panel as "In-house dispensing".
--
-- ── WHY A SEPARATE BILL ─────────────────────────────────────────────────────
-- 0051/0056 deliberately keep GST off the patient bill: consultations are
-- exempt and medicines are not. So a medicine sale gets its own bill, its own
-- series (PH/<FY>/0001), and GST when — and only when — the clinic has a GSTIN
-- for its dispensary. Most small clinics do not, so GST is optional: with no
-- GSTIN the bill is a plain bill at MRP with no tax lines.
--
-- ── GST ARITHMETIC ──────────────────────────────────────────────────────────
-- Medicines are sold at MRP, which INCLUDES GST. So tax is taken out of the
-- price, never added on: taxable = amount × 100 / (100 + rate), and the rest
-- is split equally into CGST and SGST (a counter sale is intra-state).
--
-- ── WHO DOES WHAT ───────────────────────────────────────────────────────────
-- Medicines, purchases, stock counts, cancellations, reports: owner, clinic
-- manager, doctor (and Sehatsandhi admins). Selling, taking payment and
-- returns at the counter: anyone on the staff — the nurse or biller handing
-- the medicines over included. Prices come from the batch: the counter cannot
-- type a price, only give a discount with a reason, and the bill keeps the
-- name of whoever issued it so the manager can see who gave what.
--
-- ── STOCK IS A LEDGER ───────────────────────────────────────────────────────
-- pharmacy_batches.qty_in_hand is the running figure; pharmacy_stock_moves is
-- why it is what it is. Both are written only by the functions below — there
-- are no insert/update policies — so the two cannot drift apart.
-- ============================================================================


-- ============================================================================
-- 1. The switch and the dispensary's own details
-- ============================================================================

alter table businesses add column if not exists pharmacy_module boolean not null default false;
alter table businesses add column if not exists pharmacy_module_since timestamptz;
alter table businesses add column if not exists pharmacy_module_set_by text;
-- Blank = no GST: bills at MRP with no tax lines. Kept apart from
-- businesses.gstin, which is what Sehatsandhi invoices the clinic against —
-- a dispensary is often registered separately, or not at all.
alter table businesses add column if not exists pharmacy_gstin text;
alter table businesses add column if not exists pharmacy_drug_licence text;

do $$ begin
  alter table businesses add constraint businesses_pharmacy_gstin_shape
    check (pharmacy_gstin is null or pharmacy_gstin ~ '^[0-9]{2}[A-Z0-9]{13}$');
exception when duplicate_object then null; end $$;


-- ============================================================================
-- 2. Tables
-- ============================================================================

-- The clinic's own list of what it stocks. Sold in `unit` (tablet, bottle,
-- tube…); bought in packs of `pack_size` units.
create table if not exists pharmacy_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  generic_name text,
  strength text,
  form text,
  unit text not null default 'unit',
  pack_size integer not null default 1 check (pack_size between 1 and 10000),
  hsn_code text,
  gst_rate numeric(5,2) not null default 12 check (gst_rate in (0, 5, 12, 18, 28)),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pharmacy_items_one_name
  on pharmacy_items (business_id, lower(name), lower(coalesce(strength, '')), lower(coalesce(form, '')));
create index if not exists pharmacy_items_business_idx on pharmacy_items (business_id);

create table if not exists pharmacy_suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  phone text,
  gstin text,
  created_at timestamptz not null default now()
);
create unique index if not exists pharmacy_suppliers_one_name
  on pharmacy_suppliers (business_id, lower(name));

create table if not exists pharmacy_purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid references pharmacy_suppliers(id) on delete set null,
  supplier_name text,
  invoice_no text,
  invoice_date date not null default current_date,
  total_cost numeric(12,2) not null default 0,
  notes text,
  recorded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists pharmacy_purchases_business_idx on pharmacy_purchases (business_id, invoice_date desc);

-- One row per batch received. Prices are per SELLING unit (a tablet), worked
-- out from the pack price at purchase, so a sale never has to divide.
create table if not exists pharmacy_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  item_id uuid not null references pharmacy_items(id) on delete cascade,
  purchase_id uuid references pharmacy_purchases(id) on delete set null,
  batch_no text not null,
  expiry_date date not null,
  qty_received integer not null check (qty_received > 0),
  qty_in_hand integer not null check (qty_in_hand >= 0),
  unit_cost numeric(12,4) not null default 0 check (unit_cost >= 0),
  unit_mrp numeric(12,4) not null check (unit_mrp > 0),
  created_at timestamptz not null default now()
);
create index if not exists pharmacy_batches_item_idx on pharmacy_batches (item_id, expiry_date);
create index if not exists pharmacy_batches_business_idx on pharmacy_batches (business_id, expiry_date);

create table if not exists pharmacy_bill_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  fy text not null,
  last_number integer not null default 0,
  primary key (business_id, fy)
);

create table if not exists pharmacy_bills (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  bill_no text not null,
  -- A patient of the clinic, or a walk-in with just a name.
  patient_member_id uuid references patient_members(id) on delete set null,
  prescription_id uuid references prescriptions(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  -- Snapshots, as on patient_bills: the printed bill must not change later.
  clinic_name text,
  clinic_address text,
  clinic_phone text,
  gstin text,
  drug_licence text,
  gst_applied boolean not null default false,
  subtotal numeric(12,2) not null,          -- at MRP, before discount
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  discount_amount numeric(12,2) not null default 0,
  discount_reason text,
  taxable_value numeric(12,2) not null default 0,
  cgst_amount numeric(12,2) not null default 0,
  sgst_amount numeric(12,2) not null default 0,
  round_off numeric(12,2) not null default 0,
  net_payable numeric(12,2) not null,
  status text not null default 'issued' check (status in ('issued', 'cancelled')),
  cancelled_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  issued_by uuid,
  issued_at timestamptz not null default now(),
  unique (business_id, bill_no),
  check (discount_amount = 0 or btrim(coalesce(discount_reason, '')) <> '')
);
-- Who billed (and so who gave any discount), as a name: the manager reviewing
-- discounts and dues reads it, and a uid means nothing to them.
alter table pharmacy_bills add column if not exists issued_by_name text;

create index if not exists pharmacy_bills_business_idx on pharmacy_bills (business_id, issued_at desc);
create index if not exists pharmacy_bills_member_idx on pharmacy_bills (patient_member_id);
create index if not exists pharmacy_bills_rx_idx on pharmacy_bills (prescription_id);

-- A line per BATCH sold: one medicine taken from two batches is two lines, so
-- every tablet can be traced to its batch and expiry.
create table if not exists pharmacy_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references pharmacy_bills(id) on delete cascade,
  item_id uuid references pharmacy_items(id) on delete set null,
  batch_id uuid references pharmacy_batches(id) on delete set null,
  name text not null,
  batch_no text,
  expiry_date date,
  hsn_code text,
  quantity integer not null check (quantity > 0),
  unit_mrp numeric(12,4) not null,
  amount numeric(12,2) not null,            -- after the bill's discount, GST included
  gst_rate numeric(5,2) not null default 0,
  taxable_value numeric(12,2) not null,
  tax_amount numeric(12,2) not null default 0,
  returned_qty integer not null default 0 check (returned_qty >= 0 and returned_qty <= quantity),
  sort_order integer not null default 0
);
create index if not exists pharmacy_bill_items_bill_idx on pharmacy_bill_items (bill_id);

create table if not exists pharmacy_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  bill_id uuid not null references pharmacy_bills(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','upi','card','netbanking','cheque','other')),
  reference text,
  received_by uuid,
  received_at timestamptz not null default now()
);
alter table pharmacy_payments add column if not exists received_by_name text;

create index if not exists pharmacy_payments_bill_idx on pharmacy_payments (bill_id);
create index if not exists pharmacy_payments_business_idx on pharmacy_payments (business_id, received_at desc);

-- A return or a cancellation. `credit` is what the returned medicines were
-- billed at; `refund` is the money actually handed back (only what had been
-- paid beyond what is still owed).
create table if not exists pharmacy_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  bill_id uuid not null references pharmacy_bills(id) on delete cascade,
  kind text not null default 'return' check (kind in ('return', 'cancel')),
  credit_amount numeric(12,2) not null default 0,
  refund_amount numeric(12,2) not null default 0 check (refund_amount >= 0),
  refund_method text check (refund_method is null or refund_method in ('cash','upi','card','netbanking','cheque','other')),
  reason text,
  items jsonb not null default '[]'::jsonb,
  recorded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists pharmacy_returns_bill_idx on pharmacy_returns (bill_id);
create index if not exists pharmacy_returns_business_idx on pharmacy_returns (business_id, created_at desc);

create table if not exists pharmacy_stock_moves (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  item_id uuid not null references pharmacy_items(id) on delete cascade,
  batch_id uuid references pharmacy_batches(id) on delete set null,
  kind text not null check (kind in ('purchase', 'sale', 'return', 'cancel', 'adjust')),
  qty integer not null,                     -- signed: + in, − out
  purchase_id uuid references pharmacy_purchases(id) on delete set null,
  bill_id uuid references pharmacy_bills(id) on delete set null,
  reason text,
  recorded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists pharmacy_stock_moves_item_idx on pharmacy_stock_moves (item_id, created_at desc);
create index if not exists pharmacy_stock_moves_business_idx on pharmacy_stock_moves (business_id, created_at desc);


-- ============================================================================
-- 3. Who may
-- ============================================================================

create or replace function sehat_pharmacy_may_manage(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_business is not null
     and (sehat_is_admin() or coalesce(sehat_caller_role(p_business) in ('owner', 'manager', 'doctor'), false));
$$;

-- Everything but the admin switch and the settings refuses a clinic that does
-- not have the module on.
create or replace function sehat_pharmacy_check(p_business uuid, p_manage boolean)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  if not coalesce((select pharmacy_module from businesses where id = p_business), false) then
    raise exception 'In-house dispensing is not switched on for this clinic.' using errcode = 'P0001';
  end if;
  if p_manage and not sehat_pharmacy_may_manage(p_business) then
    raise exception 'Only the owner, a manager or a doctor can do this.' using errcode = '42501';
  end if;
end $$;

revoke all on function sehat_pharmacy_may_manage(uuid) from public, anon;
grant execute on function sehat_pharmacy_may_manage(uuid) to authenticated;
revoke all on function sehat_pharmacy_check(uuid, boolean) from public, anon;

-- The caller's name at this clinic: their practitioner name, else 'Owner' for
-- the login that signed the clinic up, else the admin's email.
create or replace function sehat_pharmacy_staff_name(p_business uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.full_name from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
      where bp.business_id = p_business and p.auth_uid = auth.uid() limit 1),
    (select 'Owner' from businesses b where b.id = p_business and b.auth_uid = auth.uid()),
    (select 'Sehatsandhi: ' || email from auth.users where id = auth.uid()),
    'Unknown');
$$;
revoke all on function sehat_pharmacy_staff_name(uuid) from public, anon;


-- ============================================================================
-- 4. The admin switch and the clinic's settings
-- ============================================================================

create or replace function sehat_admin_set_pharmacy(p_business uuid, p_on boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_by text := coalesce((select email from auth.users where id = auth.uid()), 'database');
begin
  if auth.uid() is not null and not sehat_is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  update businesses
     set pharmacy_module = coalesce(p_on, false),
         pharmacy_module_since = case when p_on then coalesce(pharmacy_module_since, now()) end,
         pharmacy_module_set_by = v_by
   where id = p_business;
  if not found then raise exception 'No such business.' using errcode = 'P0002'; end if;
  return (select jsonb_build_object('pharmacy_module', pharmacy_module, 'since', pharmacy_module_since)
            from businesses where id = p_business);
end $$;

revoke all on function sehat_admin_set_pharmacy(uuid, boolean) from public, anon;
grant execute on function sehat_admin_set_pharmacy(uuid, boolean) to authenticated;

-- Blank GSTIN = no GST on the dispensary's bills.
create or replace function sehat_pharmacy_settings(p_business uuid, p_gstin text, p_drug_licence text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_gstin text := nullif(upper(btrim(coalesce(p_gstin, ''))), '');
begin
  if not (sehat_is_admin() or coalesce(sehat_caller_role(p_business) in ('owner', 'manager'), false)) then
    raise exception 'Only the owner or a manager can change this.' using errcode = '42501';
  end if;
  if v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' then
    raise exception 'That GSTIN does not look right — it is 15 characters, starting with the 2-digit state code.' using errcode = '22023';
  end if;
  update businesses
     set pharmacy_gstin = v_gstin,
         pharmacy_drug_licence = nullif(btrim(coalesce(p_drug_licence, '')), '')
   where id = p_business;
end $$;

revoke all on function sehat_pharmacy_settings(uuid, text, text) from public, anon;
grant execute on function sehat_pharmacy_settings(uuid, text, text) to authenticated;


-- ============================================================================
-- 5. Medicines and suppliers
-- ============================================================================

-- p_item: {id?, name, generic_name, strength, form, unit, pack_size, hsn_code,
--          gst_rate, reorder_level, is_active}. No id = new.
create or replace function sehat_pharmacy_save_item(p_business uuid, p_item jsonb)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_item->>'id', '')::uuid;
  v_name text := btrim(coalesce(p_item->>'name', ''));
begin
  perform sehat_pharmacy_check(p_business, true);
  if v_name = '' then raise exception 'Give the medicine a name.' using errcode = '22023'; end if;

  if v_id is null then
    insert into pharmacy_items (business_id, name, generic_name, strength, form, unit, pack_size,
                                hsn_code, gst_rate, reorder_level, is_active, created_by)
    values (p_business, v_name,
            nullif(btrim(coalesce(p_item->>'generic_name', '')), ''),
            nullif(btrim(coalesce(p_item->>'strength', '')), ''),
            nullif(btrim(coalesce(p_item->>'form', '')), ''),
            coalesce(nullif(btrim(coalesce(p_item->>'unit', '')), ''), 'unit'),
            coalesce(nullif(p_item->>'pack_size', '')::integer, 1),
            nullif(btrim(coalesce(p_item->>'hsn_code', '')), ''),
            coalesce(nullif(p_item->>'gst_rate', '')::numeric, 12),
            coalesce(nullif(p_item->>'reorder_level', '')::integer, 0),
            coalesce((p_item->>'is_active')::boolean, true),
            auth.uid())
    returning id into v_id;
  else
    update pharmacy_items
       set name = v_name,
           generic_name = nullif(btrim(coalesce(p_item->>'generic_name', '')), ''),
           strength = nullif(btrim(coalesce(p_item->>'strength', '')), ''),
           form = nullif(btrim(coalesce(p_item->>'form', '')), ''),
           unit = coalesce(nullif(btrim(coalesce(p_item->>'unit', '')), ''), 'unit'),
           pack_size = coalesce(nullif(p_item->>'pack_size', '')::integer, pack_size),
           hsn_code = nullif(btrim(coalesce(p_item->>'hsn_code', '')), ''),
           gst_rate = coalesce(nullif(p_item->>'gst_rate', '')::numeric, gst_rate),
           reorder_level = coalesce(nullif(p_item->>'reorder_level', '')::integer, reorder_level),
           is_active = coalesce((p_item->>'is_active')::boolean, is_active),
           updated_at = now()
     where id = v_id and business_id = p_business;
    if not found then raise exception 'No such medicine at this clinic.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'This clinic already has "%" with that strength and form.', v_name using errcode = '23505';
end $$;

revoke all on function sehat_pharmacy_save_item(uuid, jsonb) from public, anon;
grant execute on function sehat_pharmacy_save_item(uuid, jsonb) to authenticated;


-- ============================================================================
-- 6. Purchases: stock comes in
-- ============================================================================

-- p_lines: [{item_id, batch_no, expiry_date, packs, free_packs, pack_cost, pack_mrp}]
-- A supplier named but not on the list is added to it.
create or replace function sehat_pharmacy_record_purchase(
  p_business uuid,
  p_supplier_name text,
  p_invoice_no text,
  p_invoice_date date,
  p_lines jsonb,
  p_notes text default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_purchase uuid;
  v_supplier uuid;
  v_name text := nullif(btrim(coalesce(p_supplier_name, '')), '');
  l jsonb;
  it record;
  v_units integer;
  v_paid_units integer;
  v_batch uuid;
  v_total numeric(12,2) := 0;
  v_expiry date;
begin
  perform sehat_pharmacy_check(p_business, true);
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one medicine to the purchase.' using errcode = '22023';
  end if;

  if v_name is not null then
    insert into pharmacy_suppliers (business_id, name) values (p_business, v_name)
    on conflict (business_id, lower(name)) do nothing;
    select id into v_supplier from pharmacy_suppliers
     where business_id = p_business and lower(name) = lower(v_name);
  end if;

  insert into pharmacy_purchases (business_id, supplier_id, supplier_name, invoice_no, invoice_date, notes, recorded_by)
  values (p_business, v_supplier, v_name, nullif(btrim(coalesce(p_invoice_no, '')), ''),
          coalesce(p_invoice_date, current_date), nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_purchase;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from pharmacy_items
     where id = (l->>'item_id')::uuid and business_id = p_business;
    if not found then raise exception 'A medicine on this purchase is not on the clinic''s list.' using errcode = 'P0002'; end if;

    v_paid_units := coalesce(nullif(l->>'packs', '')::integer, 0) * it.pack_size;
    v_units := v_paid_units + coalesce(nullif(l->>'free_packs', '')::integer, 0) * it.pack_size;
    if v_units <= 0 then raise exception '%: give how many packs came in.', it.name using errcode = '22023'; end if;
    if btrim(coalesce(l->>'batch_no', '')) = '' then
      raise exception '%: the batch number is on the strip or box.', it.name using errcode = '22023';
    end if;
    v_expiry := nullif(l->>'expiry_date', '')::date;
    if v_expiry is null then raise exception '%: give the expiry date.', it.name using errcode = '22023'; end if;
    if v_expiry < current_date then raise exception '%: that batch has already expired.', it.name using errcode = '22023'; end if;
    if coalesce(nullif(l->>'pack_mrp', '')::numeric, 0) <= 0 then
      raise exception '%: give the MRP printed on the pack.', it.name using errcode = '22023';
    end if;

    insert into pharmacy_batches (business_id, item_id, purchase_id, batch_no, expiry_date,
                                  qty_received, qty_in_hand, unit_cost, unit_mrp)
    values (p_business, it.id, v_purchase, upper(btrim(l->>'batch_no')), v_expiry, v_units, v_units,
            -- Free packs bring the cost of each unit down.
            round(coalesce(nullif(l->>'pack_cost', '')::numeric, 0) * greatest(v_paid_units, 0) / it.pack_size / v_units, 4),
            round((l->>'pack_mrp')::numeric / it.pack_size, 4))
    returning id into v_batch;

    insert into pharmacy_stock_moves (business_id, item_id, batch_id, kind, qty, purchase_id, recorded_by)
    values (p_business, it.id, v_batch, 'purchase', v_units, v_purchase, auth.uid());

    v_total := v_total + round(coalesce(nullif(l->>'pack_cost', '')::numeric, 0) * coalesce(nullif(l->>'packs', '')::integer, 0), 2);
  end loop;

  update pharmacy_purchases set total_cost = v_total where id = v_purchase;
  return v_purchase;
end $$;

revoke all on function sehat_pharmacy_record_purchase(uuid, text, text, date, jsonb, text) from public, anon;
grant execute on function sehat_pharmacy_record_purchase(uuid, text, text, date, jsonb, text) to authenticated;

-- A physical count, a breakage, an expired strip thrown out: set the batch to
-- what is actually on the shelf, with a reason.
create or replace function sehat_pharmacy_adjust_stock(p_batch uuid, p_counted integer, p_reason text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare b record;
begin
  select * into b from pharmacy_batches where id = p_batch for update;
  if not found then raise exception 'No such batch.' using errcode = 'P0002'; end if;
  perform sehat_pharmacy_check(b.business_id, true);
  if p_counted is null or p_counted < 0 then raise exception 'Give the count on the shelf (0 or more).' using errcode = '22023'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why the stock is being changed.' using errcode = '22023'; end if;
  if p_counted = b.qty_in_hand then return; end if;

  update pharmacy_batches set qty_in_hand = p_counted where id = p_batch;
  insert into pharmacy_stock_moves (business_id, item_id, batch_id, kind, qty, reason, recorded_by)
  values (b.business_id, b.item_id, p_batch, 'adjust', p_counted - b.qty_in_hand, btrim(p_reason), auth.uid());
end $$;

revoke all on function sehat_pharmacy_adjust_stock(uuid, integer, text) from public, anon;
grant execute on function sehat_pharmacy_adjust_stock(uuid, integer, text) to authenticated;


-- ============================================================================
-- 7. The bill: stock goes out
-- ============================================================================

create or replace function sehat_next_pharmacy_bill_number(p_business uuid, p_date date default current_date)
returns text language plpgsql security definer set search_path = public as $$
declare v_fy text; v_n integer;
begin
  v_fy := sehat_financial_year(p_date);
  insert into pharmacy_bill_counters (business_id, fy, last_number)
  values (p_business, v_fy, 0) on conflict (business_id, fy) do nothing;
  select last_number + 1 into v_n from pharmacy_bill_counters
   where business_id = p_business and fy = v_fy for update;
  update pharmacy_bill_counters set last_number = v_n
   where business_id = p_business and fy = v_fy;
  return 'PH/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $$;
revoke all on function sehat_next_pharmacy_bill_number(uuid, date) from public, anon, authenticated;

-- p_lines: [{item_id, qty, batch_id?}]. Without a batch, the earliest-expiring
-- batches that have not expired are used first, across as many as it takes.
-- p_payment: {amount, method, reference} or null for "on credit".
create or replace function sehat_pharmacy_issue_bill(
  p_business uuid,
  p_lines jsonb,
  p_patient_member_id uuid default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_prescription_id uuid default null,
  p_discount_pct numeric default 0,
  p_discount_reason text default null,
  p_payment jsonb default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_bill uuid;
  v_gst boolean;
  biz record;
  v_name text;
  v_phone text;
  l jsonb;
  it record;
  bt record;
  v_need integer;
  v_take integer;
  v_pct numeric := coalesce(p_discount_pct, 0);
  v_gross numeric(12,2);
  v_amount numeric(12,2);
  v_taxable numeric(12,2);
  v_sort integer := 0;
  v_subtotal numeric(12,2) := 0;
  v_net_lines numeric(12,2) := 0;
  v_tax numeric(12,2) := 0;
  v_net numeric(12,2);
  v_pay numeric(12,2);
begin
  perform sehat_pharmacy_check(p_business, false);
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one medicine to the bill.' using errcode = '22023';
  end if;
  if v_pct < 0 or v_pct > 100 then raise exception 'A discount is between 0 and 100%%.' using errcode = '22023'; end if;
  if v_pct > 0 and btrim(coalesce(p_discount_reason, '')) = '' then
    raise exception 'Say why there is a discount.' using errcode = '22023';
  end if;

  select name, address, phone, pharmacy_gstin, pharmacy_drug_licence into biz
    from businesses where id = p_business;
  v_gst := biz.pharmacy_gstin is not null;

  -- Who it is for: a patient of this clinic, or a walk-in by name.
  if p_patient_member_id is not null then
    select mm.full_name, pa.phone into v_name, v_phone
      from patient_members mm join patients pa on pa.id = mm.patient_id
     where mm.id = p_patient_member_id;
    if not found then raise exception 'No such patient.' using errcode = 'P0002'; end if;
    v_phone := coalesce(nullif(btrim(coalesce(p_customer_phone, '')), ''), v_phone);
  else
    v_name := nullif(btrim(coalesce(p_customer_name, '')), '');
    v_phone := nullif(btrim(coalesce(p_customer_phone, '')), '');
    if v_name is null then raise exception 'Give the customer''s name.' using errcode = '22023'; end if;
  end if;

  if p_prescription_id is not null then
    perform 1 from prescriptions where id = p_prescription_id and business_id = p_business;
    if not found then raise exception 'That prescription is not from this clinic.' using errcode = 'P0002'; end if;
  end if;

  insert into pharmacy_bills (business_id, bill_no, patient_member_id, prescription_id, customer_name, customer_phone,
                              clinic_name, clinic_address, clinic_phone, gstin, drug_licence, gst_applied,
                              subtotal, discount_pct, discount_reason, net_payable, issued_by, issued_by_name)
  values (p_business, sehat_next_pharmacy_bill_number(p_business), p_patient_member_id, p_prescription_id, v_name, v_phone,
          biz.name, biz.address, biz.phone, biz.pharmacy_gstin, biz.pharmacy_drug_licence, v_gst,
          0, v_pct, case when v_pct > 0 then btrim(p_discount_reason) end, 0, auth.uid(),
          sehat_pharmacy_staff_name(p_business))
  returning id into v_bill;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from pharmacy_items where id = (l->>'item_id')::uuid and business_id = p_business;
    if not found then raise exception 'A medicine on this bill is not on the clinic''s list.' using errcode = 'P0002'; end if;
    v_need := coalesce(nullif(l->>'qty', '')::integer, 0);
    if v_need <= 0 then raise exception '%: give a quantity.', it.name using errcode = '22023'; end if;

    for bt in
      select * from pharmacy_batches
       where item_id = it.id and qty_in_hand > 0 and expiry_date >= current_date
         and (nullif(l->>'batch_id', '') is null or id = (l->>'batch_id')::uuid)
       order by expiry_date, created_at
       for update
    loop
      exit when v_need = 0;
      v_take := least(v_need, bt.qty_in_hand);
      v_gross := round(v_take * bt.unit_mrp, 2);
      v_amount := round(v_gross * (100 - v_pct) / 100, 2);
      v_taxable := case when v_gst then round(v_amount * 100 / (100 + it.gst_rate), 2) else v_amount end;

      insert into pharmacy_bill_items (bill_id, item_id, batch_id, name, batch_no, expiry_date, hsn_code,
                                       quantity, unit_mrp, amount, gst_rate, taxable_value, tax_amount, sort_order)
      values (v_bill, it.id, bt.id,
              it.name || coalesce(' ' || it.strength, '') || coalesce(' ' || it.form, ''),
              bt.batch_no, bt.expiry_date, it.hsn_code, v_take, bt.unit_mrp, v_amount,
              case when v_gst then it.gst_rate else 0 end, v_taxable, v_amount - v_taxable, v_sort);
      v_sort := v_sort + 1;

      update pharmacy_batches set qty_in_hand = qty_in_hand - v_take where id = bt.id;
      insert into pharmacy_stock_moves (business_id, item_id, batch_id, kind, qty, bill_id, recorded_by)
      values (p_business, it.id, bt.id, 'sale', -v_take, v_bill, auth.uid());

      v_subtotal := v_subtotal + v_gross;
      v_net_lines := v_net_lines + v_amount;
      v_tax := v_tax + (v_amount - v_taxable);
      v_need := v_need - v_take;
    end loop;

    if v_need > 0 then
      raise exception '%: only % in stock that has not expired (in %s).', it.name,
        coalesce(nullif(l->>'qty', '')::integer, 0) - v_need, it.unit using errcode = 'P0001';
    end if;
  end loop;

  v_net := round(v_net_lines);
  update pharmacy_bills
     set subtotal = v_subtotal,
         discount_amount = v_subtotal - v_net_lines,
         taxable_value = v_net_lines - v_tax,
         cgst_amount = round(v_tax / 2, 2),
         sgst_amount = v_tax - round(v_tax / 2, 2),
         round_off = v_net - v_net_lines,
         net_payable = v_net
   where id = v_bill;

  v_pay := coalesce(nullif(p_payment->>'amount', '')::numeric, 0);
  if v_pay > 0 then
    if v_pay > v_net then raise exception 'That is more than the bill (₹%).', v_net using errcode = '22023'; end if;
    insert into pharmacy_payments (business_id, bill_id, amount, method, reference, received_by, received_by_name)
    values (p_business, v_bill, v_pay, coalesce(nullif(p_payment->>'method', ''), 'cash'),
            nullif(btrim(coalesce(p_payment->>'reference', '')), ''), auth.uid(), sehat_pharmacy_staff_name(p_business));
  end if;

  return v_bill;
end $$;

revoke all on function sehat_pharmacy_issue_bill(uuid, jsonb, uuid, text, text, uuid, numeric, text, jsonb) from public, anon;
grant execute on function sehat_pharmacy_issue_bill(uuid, jsonb, uuid, text, text, uuid, numeric, text, jsonb) to authenticated;


-- ============================================================================
-- 8. Money in, and money back
-- ============================================================================

-- What a bill still wants: net, less what was returned, less what was paid,
-- plus what was refunded.
create or replace function sehat_pharmacy_bill_balance(p_bill uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select b.net_payable
         - coalesce((select sum(credit_amount) from pharmacy_returns r where r.bill_id = b.id), 0)
         - coalesce((select sum(amount) from pharmacy_payments p where p.bill_id = b.id), 0)
         + coalesce((select sum(refund_amount) from pharmacy_returns r where r.bill_id = b.id), 0)
    from pharmacy_bills b where b.id = p_bill;
$$;
revoke all on function sehat_pharmacy_bill_balance(uuid) from public, anon, authenticated;

create or replace function sehat_pharmacy_record_payment(p_bill uuid, p_amount numeric, p_method text, p_reference text default null)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare b record; v_due numeric;
begin
  select * into b from pharmacy_bills where id = p_bill for update;
  if not found then raise exception 'No such bill.' using errcode = 'P0002'; end if;
  perform sehat_pharmacy_check(b.business_id, false);
  if b.status <> 'issued' then raise exception 'This bill was cancelled.' using errcode = 'P0001'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Give the amount received.' using errcode = '22023'; end if;
  v_due := sehat_pharmacy_bill_balance(p_bill);
  if p_amount > v_due then raise exception 'Only ₹% is due on this bill.', v_due using errcode = '22023'; end if;
  insert into pharmacy_payments (business_id, bill_id, amount, method, reference, received_by, received_by_name)
  values (b.business_id, p_bill, round(p_amount, 2), coalesce(nullif(p_method, ''), 'cash'),
          nullif(btrim(coalesce(p_reference, '')), ''), auth.uid(), sehat_pharmacy_staff_name(b.business_id));
end $$;

revoke all on function sehat_pharmacy_record_payment(uuid, numeric, text, text) from public, anon;
grant execute on function sehat_pharmacy_record_payment(uuid, numeric, text, text) to authenticated;

-- p_lines: [{bill_item_id, qty}]. Unopened medicines back on the shelf, into
-- the batch they came from. The refund is whatever had been paid beyond what
-- the bill now comes to.
create or replace function sehat_pharmacy_return(p_bill uuid, p_lines jsonb, p_refund_method text default 'cash', p_reason text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  b record;
  l jsonb;
  bi record;
  v_qty integer;
  v_credit numeric(12,2) := 0;
  v_line numeric(12,2);
  v_items jsonb := '[]'::jsonb;
  v_balance numeric;
  v_refund numeric(12,2);
begin
  select * into b from pharmacy_bills where id = p_bill for update;
  if not found then raise exception 'No such bill.' using errcode = 'P0002'; end if;
  perform sehat_pharmacy_check(b.business_id, false);
  if b.status <> 'issued' then raise exception 'This bill was cancelled.' using errcode = 'P0001'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce(nullif(l->>'qty', '')::integer, 0);
    continue when v_qty <= 0;
    select * into bi from pharmacy_bill_items where id = (l->>'bill_item_id')::uuid and bill_id = p_bill for update;
    if not found then raise exception 'That line is not on this bill.' using errcode = 'P0002'; end if;
    if v_qty > bi.quantity - bi.returned_qty then
      raise exception '%: only % left to return.', bi.name, bi.quantity - bi.returned_qty using errcode = '22023';
    end if;

    -- At what the patient was actually charged for each one, discount included.
    v_line := round(bi.amount * v_qty / bi.quantity, 2);
    v_credit := v_credit + v_line;
    update pharmacy_bill_items set returned_qty = returned_qty + v_qty where id = bi.id;
    if bi.batch_id is not null then
      update pharmacy_batches set qty_in_hand = qty_in_hand + v_qty where id = bi.batch_id;
      insert into pharmacy_stock_moves (business_id, item_id, batch_id, kind, qty, bill_id, reason, recorded_by)
      select b.business_id, pb.item_id, pb.id, 'return', v_qty, p_bill, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
        from pharmacy_batches pb where pb.id = bi.batch_id;
    end if;
    v_items := v_items || jsonb_build_object('bill_item_id', bi.id, 'name', bi.name, 'qty', v_qty, 'credit', v_line);
  end loop;

  if jsonb_array_length(v_items) = 0 then raise exception 'Choose what is being returned.' using errcode = '22023'; end if;

  -- Balance before this return, less its credit: below zero is money to hand back.
  v_balance := sehat_pharmacy_bill_balance(p_bill) - v_credit;
  v_refund := greatest(-v_balance, 0);

  insert into pharmacy_returns (business_id, bill_id, kind, credit_amount, refund_amount, refund_method, reason, items, recorded_by)
  values (b.business_id, p_bill, 'return', v_credit, v_refund,
          case when v_refund > 0 then coalesce(nullif(p_refund_method, ''), 'cash') end,
          nullif(btrim(coalesce(p_reason, '')), ''), v_items, auth.uid());

  return jsonb_build_object('credit', v_credit, 'refund', v_refund);
end $$;

revoke all on function sehat_pharmacy_return(uuid, jsonb, text, text) from public, anon;
grant execute on function sehat_pharmacy_return(uuid, jsonb, text, text) to authenticated;

-- Everything not yet returned goes back on the shelf and every rupee paid is
-- handed back. The bill keeps its number, marked cancelled: a gap in the
-- series is something an inspector asks about.
create or replace function sehat_pharmacy_cancel_bill(p_bill uuid, p_reason text, p_refund_method text default 'cash')
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  b record;
  bi record;
  v_items jsonb := '[]'::jsonb;
  v_credit numeric(12,2);
  v_refund numeric(12,2);
begin
  select * into b from pharmacy_bills where id = p_bill for update;
  if not found then raise exception 'No such bill.' using errcode = 'P0002'; end if;
  perform sehat_pharmacy_check(b.business_id, true);
  if b.status <> 'issued' then raise exception 'This bill is already cancelled.' using errcode = 'P0001'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why the bill is being cancelled.' using errcode = '22023'; end if;

  for bi in select * from pharmacy_bill_items where bill_id = p_bill and quantity > returned_qty for update loop
    update pharmacy_bill_items set returned_qty = quantity where id = bi.id;
    if bi.batch_id is not null then
      update pharmacy_batches set qty_in_hand = qty_in_hand + (bi.quantity - bi.returned_qty) where id = bi.batch_id;
      insert into pharmacy_stock_moves (business_id, item_id, batch_id, kind, qty, bill_id, reason, recorded_by)
      select b.business_id, pb.item_id, pb.id, 'cancel', bi.quantity - bi.returned_qty, p_bill, btrim(p_reason), auth.uid()
        from pharmacy_batches pb where pb.id = bi.batch_id;
    end if;
    v_items := v_items || jsonb_build_object('bill_item_id', bi.id, 'name', bi.name, 'qty', bi.quantity - bi.returned_qty);
  end loop;

  -- Whatever the bill still stood at is credited; all money kept is refunded.
  v_credit := b.net_payable - coalesce((select sum(credit_amount) from pharmacy_returns where bill_id = p_bill), 0);
  v_refund := coalesce((select sum(amount) from pharmacy_payments where bill_id = p_bill), 0)
            - coalesce((select sum(refund_amount) from pharmacy_returns where bill_id = p_bill), 0);

  insert into pharmacy_returns (business_id, bill_id, kind, credit_amount, refund_amount, refund_method, reason, items, recorded_by)
  values (b.business_id, p_bill, 'cancel', v_credit, greatest(v_refund, 0),
          case when v_refund > 0 then coalesce(nullif(p_refund_method, ''), 'cash') end,
          btrim(p_reason), v_items, auth.uid());

  update pharmacy_bills
     set status = 'cancelled', cancelled_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid()
   where id = p_bill;

  return jsonb_build_object('refund', greatest(v_refund, 0));
end $$;

revoke all on function sehat_pharmacy_cancel_bill(uuid, text, text) from public, anon;
grant execute on function sehat_pharmacy_cancel_bill(uuid, text, text) to authenticated;


-- ============================================================================
-- 9. What the counter reads
-- ============================================================================

-- Per medicine: what can be sold now, what has expired on the shelf, the
-- nearest expiry, and whether it is at or below its reorder level.
create or replace view pharmacy_stock with (security_invoker = true) as
  select i.*,
         coalesce(sum(b.qty_in_hand) filter (where b.expiry_date >= current_date), 0)::integer as qty_available,
         coalesce(sum(b.qty_in_hand) filter (where b.expiry_date < current_date), 0)::integer as qty_expired,
         min(b.expiry_date) filter (where b.qty_in_hand > 0 and b.expiry_date >= current_date) as next_expiry,
         max(b.unit_mrp) filter (where b.qty_in_hand > 0 and b.expiry_date >= current_date) as unit_mrp,
         coalesce(sum(b.qty_in_hand * b.unit_cost) filter (where b.expiry_date >= current_date), 0)::numeric(12,2) as stock_value
    from pharmacy_items i
    left join pharmacy_batches b on b.item_id = i.id
   group by i.id;

-- Dropped first: columns were added to it before production had it, and
-- create or replace cannot insert a column in the middle of a view.
drop view if exists pharmacy_bill_detail;
create or replace view pharmacy_bill_detail with (security_invoker = true) as
  select b.*,
         coalesce(p.paid, 0) as paid,
         coalesce(r.credited, 0) as credited,
         coalesce(r.refunded, 0) as refunded,
         case when b.status = 'cancelled' then 0
              else b.net_payable - coalesce(r.credited, 0) - coalesce(p.paid, 0) + coalesce(r.refunded, 0) end as balance_due,
         -- paid | partly_paid | unpaid | cancelled — what the counter and the
         -- manager filter on.
         case when b.status = 'cancelled' then 'cancelled'
              when b.net_payable - coalesce(r.credited, 0) - coalesce(p.paid, 0) + coalesce(r.refunded, 0) <= 0 then 'paid'
              when coalesce(p.paid, 0) - coalesce(r.refunded, 0) > 0 then 'partly_paid'
              else 'unpaid' end as payment_status,
         coalesce((select jsonb_agg(to_jsonb(bi) order by bi.sort_order) from pharmacy_bill_items bi where bi.bill_id = b.id), '[]'::jsonb) as items,
         coalesce((select jsonb_agg(jsonb_build_object('amount', pp.amount, 'method', pp.method, 'reference', pp.reference,
                                                       'received_at', pp.received_at, 'received_by_name', pp.received_by_name) order by pp.received_at)
                     from pharmacy_payments pp where pp.bill_id = b.id), '[]'::jsonb) as payments,
         coalesce((select jsonb_agg(to_jsonb(pr) - 'business_id' order by pr.created_at)
                     from pharmacy_returns pr where pr.bill_id = b.id), '[]'::jsonb) as returns
    from pharmacy_bills b
    left join (select bill_id, sum(amount) as paid from pharmacy_payments group by bill_id) p on p.bill_id = b.id
    left join (select bill_id, sum(credit_amount) as credited, sum(refund_amount) as refunded
                 from pharmacy_returns group by bill_id) r on r.bill_id = b.id;

grant select on pharmacy_stock, pharmacy_bill_detail to authenticated;

-- A prescription's medicines, for the counter to dispense against. Reception
-- cannot read prescriptions (0057) — this hands over the drug lines only, not
-- the diagnosis, and only where the clinic dispenses.
create or replace function sehat_pharmacy_prescriptions(p_business uuid, p_member uuid)
returns table (prescription_id uuid, prescription_no text, issued_at timestamptz, prescriber_name text,
               items jsonb, dispensed_bill_no text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_pharmacy_check(p_business, false);
  return query
    select rx.id, rx.prescription_no, rx.issued_at, rx.prescriber_name,
           coalesce((select jsonb_agg(jsonb_build_object('drug_name', pi.drug_name, 'strength', pi.strength, 'form', pi.form,
                                                         'dosage', pi.dosage, 'duration', pi.duration, 'quantity', pi.quantity)
                                      order by pi.sort_order)
                       from prescription_items pi where pi.prescription_id = rx.id), '[]'::jsonb),
           (select string_agg(pb.bill_no, ', ') from pharmacy_bills pb
             where pb.prescription_id = rx.id and pb.status = 'issued')
      from prescriptions rx
     where rx.business_id = p_business and rx.patient_member_id = p_member and rx.status = 'issued'
     order by rx.issued_at desc
     limit 10;
end $$;

revoke all on function sehat_pharmacy_prescriptions(uuid, uuid) from public, anon;
grant execute on function sehat_pharmacy_prescriptions(uuid, uuid) to authenticated;

-- The day (or month) at the counter: sales, returns, money by method, GST by
-- rate, what is owed. Owner, manager, doctor.
create or replace function sehat_pharmacy_summary(p_business uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  -- Clinic days are Indian days, not UTC ones.
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
begin
  perform sehat_pharmacy_check(p_business, true);
  return jsonb_build_object(
    'bills', (select count(*) from pharmacy_bills where business_id = p_business and issued_at >= v_from and issued_at < v_to),
    'cancelled', (select count(*) from pharmacy_bills where business_id = p_business and issued_at >= v_from and issued_at < v_to and status = 'cancelled'),
    'sales', (select coalesce(sum(net_payable), 0) from pharmacy_bills
               where business_id = p_business and issued_at >= v_from and issued_at < v_to),
    'discounts', (select coalesce(sum(discount_amount), 0) from pharmacy_bills
                   where business_id = p_business and issued_at >= v_from and issued_at < v_to and status = 'issued'),
    'returns', (select coalesce(sum(credit_amount), 0) from pharmacy_returns
                 where business_id = p_business and created_at >= v_from and created_at < v_to),
    'collected', (select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) from (
                   select method, sum(amount) as total from pharmacy_payments
                    where business_id = p_business and received_at >= v_from and received_at < v_to
                    group by method) m),
    'refunded', (select coalesce(sum(refund_amount), 0) from pharmacy_returns
                  where business_id = p_business and created_at >= v_from and created_at < v_to),
    -- GST on what was sold and kept: returned quantities taken out pro rata.
    'gst', (select coalesce(jsonb_agg(g order by g.rate), '[]'::jsonb) from (
             select bi.gst_rate as rate,
                    sum(round(bi.taxable_value * (bi.quantity - bi.returned_qty) / bi.quantity, 2)) as taxable,
                    sum(round(bi.tax_amount * (bi.quantity - bi.returned_qty) / bi.quantity, 2)) as tax
               from pharmacy_bill_items bi join pharmacy_bills b on b.id = bi.bill_id
              where b.business_id = p_business and b.issued_at >= v_from and b.issued_at < v_to and b.gst_applied
              group by bi.gst_rate) g),
    'purchases', (select coalesce(sum(total_cost), 0) from pharmacy_purchases
                   where business_id = p_business and invoice_date between p_from and p_to),
    'outstanding', (select coalesce(sum(balance_due), 0) from pharmacy_bill_detail
                     where business_id = p_business and status = 'issued' and balance_due > 0)
  );
end $$;

revoke all on function sehat_pharmacy_summary(uuid, date, date) from public, anon;
grant execute on function sehat_pharmacy_summary(uuid, date, date) to authenticated;


-- Who owes the counter money, one row per patient (or walk-in by name and
-- phone): total due, how many bills, the oldest unpaid bill and the last time
-- they paid anything. The manager's collection list.
create or replace function sehat_pharmacy_dues(p_business uuid)
returns table (patient_member_id uuid, customer_name text, customer_phone text, total_due numeric,
               bills integer, oldest_bill_at timestamptz, last_paid_at timestamptz, bill_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_pharmacy_check(p_business, false);
  return query
    select d.patient_member_id, max(d.customer_name), max(d.customer_phone), sum(d.balance_due),
           count(*)::integer, min(d.issued_at),
           (select max(pp.received_at) from pharmacy_payments pp where pp.bill_id = any(array_agg(d.id))),
           array_agg(d.id order by d.issued_at)
      from pharmacy_bill_detail d
     where d.business_id = p_business and d.status = 'issued' and d.balance_due > 0
     group by d.patient_member_id,
              case when d.patient_member_id is null then lower(d.customer_name) || '|' || coalesce(d.customer_phone, '') end
     order by sum(d.balance_due) desc;
end $$;

revoke all on function sehat_pharmacy_dues(uuid) from public, anon;
grant execute on function sehat_pharmacy_dues(uuid) to authenticated;


-- ============================================================================
-- 10. RLS: everyone on the staff reads; nobody writes except through the above
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['pharmacy_items','pharmacy_suppliers','pharmacy_purchases','pharmacy_batches',
                           'pharmacy_bills','pharmacy_payments','pharmacy_returns','pharmacy_stock_moves',
                           'pharmacy_bill_counters'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "clinic_reads_%1$s" on %1$I', t);
    execute format('create policy "clinic_reads_%1$s" on %1$I for select using (sehat_caller_owns_business(business_id))', t);
  end loop;
end $$;

alter table pharmacy_bill_items enable row level security;
drop policy if exists "clinic_reads_pharmacy_bill_items" on pharmacy_bill_items;
create policy "clinic_reads_pharmacy_bill_items" on pharmacy_bill_items for select
  using (exists (select 1 from pharmacy_bills b where b.id = bill_id and sehat_caller_owns_business(b.business_id)));

grant select on pharmacy_items, pharmacy_suppliers, pharmacy_purchases, pharmacy_batches, pharmacy_bills,
                pharmacy_bill_items, pharmacy_payments, pharmacy_returns, pharmacy_stock_moves to authenticated;
revoke insert, update, delete on pharmacy_items, pharmacy_suppliers, pharmacy_purchases, pharmacy_batches, pharmacy_bills,
                pharmacy_bill_items, pharmacy_payments, pharmacy_returns, pharmacy_stock_moves, pharmacy_bill_counters
  from anon, authenticated;

notify pgrst, 'reload schema';

-- ── NOT HERE ────────────────────────────────────────────────────────────────
-- • Charging for the module. It is free and switched on by an admin; a price
--   can come with the pricing table later without touching any of this.
-- • Sending the bill by WhatsApp/SMS or a public link. It prints from the
--   dashboard; a public token can be added the way patient_bills has one.
-- • Paying suppliers and supplier credit. Purchases record what came in and
--   what it cost, not whether the supplier has been paid.
-- • IGST (inter-state) and composition-scheme bills. A clinic counter sells to
--   people standing in front of it, in its own state.
