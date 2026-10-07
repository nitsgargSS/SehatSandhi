-- 0203: the admin's Message Review — the learning loop for 0201's matcher.
--
-- Admins and managers (sehat_is_staff) read typed messages and the vocabulary;
-- every change goes through the functions below, which stamp who made it, so a
-- reviewer cannot edit what a patient wrote. Admins keep 0201's full access.

drop policy if exists free_text_log_staff_read on free_text_log;
create policy free_text_log_staff_read on free_text_log for select to authenticated using (sehat_is_staff());
drop policy if exists intent_keywords_staff_read on intent_keywords;
create policy intent_keywords_staff_read on intent_keywords for select to authenticated using (sehat_is_staff());
drop policy if exists emergency_keywords_staff_read on emergency_keywords;
create policy emergency_keywords_staff_read on emergency_keywords for select to authenticated using (sehat_is_staff());
drop policy if exists location_aliases_staff_read on location_aliases;
create policy location_aliases_staff_read on location_aliases for select to authenticated using (sehat_is_staff());
drop policy if exists speciality_names_staff_read on speciality_names;
create policy speciality_names_staff_read on speciality_names for select to authenticated using (sehat_is_staff());

-- What happens to a message, said by the reviewer: right as matched, or what
-- it should have been. p_intent 'none' = nothing to route (a greeting, junk).
create or replace function sehat_admin_review_free_text(p_id bigint, p_correct boolean, p_intent text default null, p_speciality text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not sehat_is_staff() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if not p_correct then
    if p_intent is null or p_intent not in ('doctor', 'lab', 'medicine', 'ambulance', 'insurance', 'camps', 'emergency', 'none') then
      raise exception 'Choose what it should have been.' using errcode = 'P0001';
    end if;
    if p_speciality is not null and (p_intent <> 'doctor' or not exists (select 1 from speciality_names where code = p_speciality)) then
      raise exception 'A speciality goes with a doctor.' using errcode = 'P0001';
    end if;
  end if;
  update free_text_log
     set corrected_intent = case when p_correct then null else p_intent end,
         corrected_speciality = case when p_correct then null else p_speciality end,
         reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_id;
  if not found then raise exception 'No such message.' using errcode = 'P0002'; end if;
end $$;

-- Teach the matcher a word (source 'learned'): for an intent / speciality, an
-- emergency, or a place. Returns what the word now normalises to.
create or replace function sehat_admin_add_term(
  p_kind text, p_term text, p_intent text default null, p_speciality text default null,
  p_weight numeric default 1, p_pin text default null, p_place text default null, p_severity text default 'critical')
returns text language plpgsql security definer set search_path = public as $$
declare v_norm text := normalize_text(p_term);
begin
  if not sehat_is_staff() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if v_norm = '' then raise exception 'Type the word or phrase.' using errcode = 'P0001'; end if;
  if array_length(string_to_array(v_norm, ' '), 1) > 4 then raise exception 'Four words at most.' using errcode = 'P0001'; end if;
  if p_kind = 'intent' then
    if p_intent is null or p_intent not in ('doctor', 'lab', 'medicine', 'ambulance', 'insurance', 'camps') then
      raise exception 'Choose what it means.' using errcode = 'P0001';
    end if;
    if p_speciality is not null and p_intent <> 'doctor' then raise exception 'A speciality goes with a doctor.' using errcode = 'P0001'; end if;
    if coalesce(p_weight, 1) <= 0 or coalesce(p_weight, 1) > 3 then raise exception 'Weight between 0.1 and 3.' using errcode = 'P0001'; end if;
    insert into intent_keywords (term, intent, speciality, weight, source, created_by)
    values (btrim(p_term), p_intent, p_speciality, coalesce(p_weight, 1), 'learned', auth.uid())
    on conflict (normalized_term, intent, coalesce(speciality, ''))
      do update set is_active = true, weight = excluded.weight;
  elsif p_kind = 'emergency' then
    insert into emergency_keywords (term, severity, source) values (btrim(p_term), coalesce(p_severity, 'critical'), 'learned')
    on conflict (normalized_term) do update set is_active = true, severity = excluded.severity;
  elsif p_kind = 'place' then
    if coalesce(p_pin, '') !~ '^[1-9][0-9]{5}$' then raise exception 'A place needs its 6-digit PIN.' using errcode = 'P0001'; end if;
    insert into location_aliases (alias, pin_code, location_name, source)
    values (btrim(p_term), p_pin, coalesce(nullif(btrim(p_place), ''), btrim(p_term)), 'learned')
    on conflict (normalized_alias) do update set pin_code = excluded.pin_code, location_name = excluded.location_name, is_active = true;
  else
    raise exception 'Unknown kind of word.' using errcode = 'P0001';
  end if;
  return v_norm;
end $$;

-- "Try a message": what the matcher says now, logging nothing.
create or replace function sehat_admin_try_match(p_text text, p_pin text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_is_staff() then raise exception 'Admins only.' using errcode = '42501'; end if;
  return match_message(p_text, p_pin);
end $$;

-- The counters: last p_days, by channel and by outcome, and the words that
-- most often appear in messages nobody understood (joining words and numbers
-- left out) — the first candidates for "Add term".
create or replace function sehat_admin_free_text_stats(p_days integer default 7, p_channel text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 365)));
  v jsonb;
begin
  if not sehat_is_staff() then raise exception 'Admins only.' using errcode = '42501'; end if;
  with l as (
    select * from free_text_log where created_at >= v_since and (p_channel is null or channel = p_channel)
  ), words as (
    select w, count(*) as n
      from l, unnest(string_to_array(l.normalized_text, ' ')) w
     where l.action = 'menu' and l.normalized_text is not null
       and length(w) >= 3 and w !~ '^[0-9]+$'
       and w <> all (array['hai', 'hain', 'mein', 'mujhe', 'mera', 'meri', 'mere', 'kya', 'kar', 'karna', 'karni', 'chahiye',
                           'the', 'and', 'for', 'you', 'koi', 'bhi', 'aur', 'nahi', 'raha', 'rahi', 'rahe', 'hello', 'kaise',
                           'है', 'हैं', 'में', 'मुझे', 'क्या', 'और', 'भी', 'नहीं', 'चाहिए'])
       and not exists (select 1 from intent_keywords k where k.normalized_term = w and k.is_active)
     group by w order by count(*) desc, w limit 15
  )
  select jsonb_build_object(
    'total',        (select count(*) from l),
    'by_channel',   (select coalesce(jsonb_object_agg(channel, n), '{}') from (select channel, count(*) n from l group by channel) c),
    'proceed',      (select count(*) from l where action = 'proceed'),
    'confirm',      (select count(*) from l where action = 'confirm'),
    'menu',         (select count(*) from l where action = 'menu'),
    'emergency',    (select count(*) from l where is_emergency),
    'to_review',    (select count(*) from free_text_log where needs_review and reviewed_at is null and (p_channel is null or channel = p_channel)),
    'corrected',    (select count(*) from l where corrected_intent is not null),
    'top_unmatched', (select coalesce(jsonb_agg(jsonb_build_object('word', w, 'n', n)), '[]') from words)
  ) into v;
  return v;
end $$;

revoke all on function sehat_admin_review_free_text(bigint, boolean, text, text) from public, anon;
revoke all on function sehat_admin_add_term(text, text, text, text, numeric, text, text, text) from public, anon;
revoke all on function sehat_admin_try_match(text, text) from public, anon;
revoke all on function sehat_admin_free_text_stats(integer, text) from public, anon;
grant execute on function sehat_admin_review_free_text(bigint, boolean, text, text) to authenticated;
grant execute on function sehat_admin_add_term(text, text, text, text, numeric, text, text, text) to authenticated;
grant execute on function sehat_admin_try_match(text, text) to authenticated;
grant execute on function sehat_admin_free_text_stats(integer, text) to authenticated;

notify pgrst, 'reload schema';
