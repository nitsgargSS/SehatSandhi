-- ============================================================================
-- 0266 — Finding a patient by any word of their name
-- ============================================================================
-- Reported 26 Oct 2026: patients are often registered as "Mrs. Anjana Sharma"
-- or "Smt Anjana Kumari", and the desk then searches "Anjana Sharma", "Mrs
-- Anjana" or "Anjana Kumari Sharma". The search (0193) matched the name as one
-- piece of text, so any title, dot, middle name or different order between
-- what was typed and what was registered found nothing.
--
-- Now a name is compared word by word:
--   - case, dots and commas do not matter ("Mrs.Anjana" = "mrs anjana");
--   - titles are ignored on both sides: Mr, Mrs, Ms, Miss, Smt, Shri, Sri,
--     Shrimati, Kumari as a title (Km, Ku), Dr, Master, Baby, Late, Sh, Md;
--   - every word typed must be the start of some word in the name, in any
--     order: "anj sha" finds "Mrs. Anjana Kumari Sharma", and so does
--     "Sharma Anjana".
-- The old whole-text match is kept too, so nothing that was found before is
-- lost. Phone and file number search are unchanged.
-- ============================================================================

-- The words of a name, without titles or punctuation, in lower case.
create or replace function sehat_name_words(p_name text)
returns text[]
language sql immutable as $$
  select coalesce(array_agg(w), '{}') from (
    select w from regexp_split_to_table(
             lower(regexp_replace(coalesce(p_name, ''), '[^[:alnum:][:space:]]+', ' ', 'g')), '\s+') w
     where w <> ''
       and w not in ('mr', 'mrs', 'ms', 'miss', 'smt', 'shri', 'sri', 'shrimati', 'km', 'ku', 'dr', 'master', 'baby', 'late', 'sh', 'md', 'mst')
  ) x;
$$;

-- Does every word of the query start some word of the name?
create or replace function sehat_name_matches(p_name text, p_query text)
returns boolean
language sql immutable as $$
  select cardinality(sehat_name_words(p_query)) > 0
     and not exists (
       select 1 from unnest(sehat_name_words(p_query)) q
        where not exists (select 1 from unnest(sehat_name_words(p_name)) n where n like q || '%'));
$$;

create or replace function sehat_search_patients(p_query text, p_business uuid default null)
returns table (
  patient_member_id uuid, business_id uuid, full_name text, relation text,
  phone text, age_years integer, gender text, mrn text,
  last_seen_at timestamptz, visit_count integer
)
language sql stable security definer set search_path = public as $$
  with q as (select btrim(coalesce(p_query, '')) as raw,
                    regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g') as digits,
                    sehat_name_words(p_query) as words)
  select m.id, bp.business_id, m.full_name, m.relation,
         p.phone, m.age_years, m.gender, bp.mrn,
         bp.last_seen_at, bp.visit_count
    from business_patients bp
    join patient_members m on m.id = bp.patient_member_id
    join patients p on p.id = m.patient_id
   cross join q
   where bp.business_id in (select sehat_caller_business_ids())
     and (p_business is null or bp.business_id = p_business)
     and m.status = 'active'
     and length(q.raw) >= 2
     and (
       m.full_name ilike '%' || q.raw || '%'
       -- 0266: any word, in any order, titles and dots ignored.
       or (length(q.digits) = 0 and sehat_name_matches(m.full_name, q.raw))
       -- 0193: only a query with digits in it is a phone search.
       or (length(q.digits) >= 3 and p.phone like '%' || q.digits || '%')
       or (length(q.digits) >= 3 and exists (select 1 from patient_phones x where x.patient_member_id = m.id and x.phone like '%' || q.digits || '%'))
       or upper(coalesce(bp.mrn, '')) = upper(q.raw)
     )
   order by
     -- The first word of the name starting with the first word typed comes first.
     ((sehat_name_words(m.full_name))[1] like coalesce(q.words[1], '') || '%') desc,
     bp.last_seen_at desc nulls last, m.full_name
   limit 50;
$$;
