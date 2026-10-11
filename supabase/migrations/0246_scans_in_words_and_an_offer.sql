-- ============================================================================
-- 0246 — No price list for scans on WhatsApp; a centre's offer in one line
-- ============================================================================
-- AFTER 0245. Safe to re-run.
--
-- A radiology centre's price list is long, and the price of a scan depends on
-- the part and the protocol. On WhatsApp a scan is now always described in
-- words — which scan, which part, what the doctor wrote — and the centre says
-- the price. What a centre may show instead is one line of its own, such as
-- "10% off on MRI and CT scans": businesses.lab_offer, set in the lab's
-- settings, shown in the list of labs and with the question.
-- ============================================================================

alter table businesses add column if not exists lab_offer text;
do $$ begin
  alter table businesses add constraint businesses_lab_offer_short check (lab_offer is null or char_length(lab_offer) <= 60);
exception when duplicate_object then null; end $$;

-- The lab's one-line offer. Owner or manager; empty clears it.
create or replace function sehat_lab_offer_save(p_business uuid, p_offer text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v text := nullif(btrim(regexp_replace(coalesce(p_offer, ''), '\s+', ' ', 'g')), '');
begin
  perform sehat_lab_check(p_business, 'manage');
  if char_length(coalesce(v, '')) > 60 then raise exception 'Keep the offer to 60 characters.' using errcode = 'P0001'; end if;
  update businesses set lab_offer = v where id = p_business;
  return v;
end $$;
revoke all on function sehat_lab_offer_save(uuid, text) from public, anon;
grant execute on function sehat_lab_offer_save(uuid, text) to authenticated;

create or replace function bot_lab_list_json(p_pincode text, p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pin text := bot_pincode(p_pincode);
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_rows jsonb;
begin
  if v_pin is null then return jsonb_build_object('ok', false, 'route', 'ask_pin'); end if;
  select jsonb_agg(jsonb_build_object(
           'id', 'lab:b:' || b.business_id, 'title', left(b.title, 24),
           'description', left(coalesce((select '🏷 ' || nullif(btrim(x.lab_offer), '') || ' · ' from businesses x where x.id = b.business_id), '')
             || b.title || coalesce(' · ' || b.area, '')
             || case when coalesce(b.total_reviews, 0) > 0 then ' · ' || trim(to_char(b.avg_rating, '0.0')) || '★' else '' end, 72),
           -- 0246: with an offer, the offer is what is said under the name.
           'offer', (select nullif(btrim(x.lab_offer), '') from businesses x where x.id = b.business_id),
           'name', b.title) order by b.rn)
    into v_rows
    from bot_bookable('business', 'lab', v_pin) b
   where sehat_lab_does(b.business_id, v_kind);
  if v_rows is null then
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification)
    values ('bot', v_pin, coalesce('lab_' || v_kind, 'lab'), false);
  end if;
  return jsonb_build_object('ok', true, 'pin', v_pin, 'rows', coalesce(v_rows, '[]'::jsonb));
end $$;
alter function bot_lab_list_json(text, text) volatile;

create or replace function bot_lab_menu_json(p_pincode text, p_selection text, p_query text default null, p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_biz uuid;
  b record;
  q text := nullif(btrim(coalesce(p_query, '')), '');
  k text := nullif(btrim(coalesce(p_kind, '')), '');
  v_rows jsonb; v_total integer;
begin
  if coalesce(p_selection, '') ~* '^[0-9a-f-]{36}$' then v_biz := p_selection::uuid;
  else select x.business_id into v_biz from bot_pick('business', 'lab', p_pincode, p_selection) x limit 1; end if;
  select x.id, x.name, coalesce(x.lab_home_fee, 0) as home_fee, nullif(btrim(x.lab_offer), '') as offer into b
    from businesses x where x.id = v_biz and x.status = 'active' and (x.vertical = 'lab' or coalesce(x.lab_module, false));
  if b.id is null then return jsonb_build_object('ok', false); end if;

  with items as (
    select 0 as grp, 'p:' || p.id as id, p.name, p.price, 'pathology'::text as cat,
           coalesce(nullif(btrim(p.description), ''), 'Package') as about
      from lab_packages p where p.business_id = b.id and p.is_active and coalesce(k, 'pathology') = 'pathology'
       and (q is null or p.name ilike '%' || q || '%' or p.description ilike '%' || q || '%')
    union all
    select 1, 't:' || t.id, t.name, t.price, t.category, coalesce(nullif(btrim(t.sample_type), ''), t.category, 'Test')
      -- 0246: only pathology is chosen from a list; a scan is described in words.
      from lab_tests t where t.business_id = b.id and t.is_active and t.category = 'pathology' and coalesce(k, 'pathology') = 'pathology'
       and (q is null or t.name ilike '%' || q || '%')
  ), ranked as (
    select i.*, row_number() over (order by i.grp, i.name) rn, count(*) over () n from items i
  )
  select jsonb_agg(jsonb_build_object('id', 'lab:i:' || r.id, 'title', left(r.name, 24),
           'description', left('₹' || trim(to_char(coalesce(r.price, 0), '99,99,990')) || ' · ' || r.name || ' · ' || r.about, 72),
           'name', r.name, 'cat', r.cat) order by r.rn), max(r.n)
    into v_rows, v_total from ranked r where r.rn <= 9;

  return jsonb_build_object('ok', true, 'business', b.id, 'name', b.name, 'home_fee', b.home_fee,
    'has_menu', coalesce(k, 'pathology') = 'pathology'
                and (exists (select 1 from lab_tests t where t.business_id = b.id and t.is_active and t.category = 'pathology')
                  or exists (select 1 from lab_packages p where p.business_id = b.id and p.is_active)),
    'offer', b.offer,
    -- A centre that does scans and no pathology: whatever was asked, it is a scan.
    'only_scans', (sehat_lab_does(b.id, 'radiology') or sehat_lab_does(b.id, 'cardiology')) and not sehat_lab_does(b.id, 'pathology'),
    'rows', coalesce(v_rows, '[]'::jsonb), 'total', coalesce(v_total, 0));
end $$;

notify pgrst, 'reload schema';
