-- ============================================================================
-- Sehatsandhi — a clinic's WhatsApp broadcast waits for Sehatsandhi's approval
--
-- Run AFTER 0154. Safe to re-run.
--
-- Decided 28 Sep 2026 (admin Phase 3):
--
--   • Every broadcast a clinic sends starts as 'pending_approval'. An admin or
--     manager reads the rendered message, the audience size and the cost, and
--     approves it (→ 'queued', for the sender) or rejects it with a reason.
--     Nothing irrelevant or misleading goes out under our number.
--   • The wallet is still debited when the clinic sends — a hold, so the same
--     money cannot be spent twice while waiting. A rejection refunds it in
--     full, as a 'refund' wallet entry, and the clinic is emailed why.
--   • Admins AND managers may create and edit templates, and mark them
--     approved once Meta has approved them.
--   • Managers see the broadcasts to review, never the recipient list: that is
--     patients' phone numbers.
--
-- sehat_create_wa_broadcast (0116/0117) inserts without naming a status, so
-- changing the column default is enough to hold every new broadcast; the
-- function itself is not rewritten. Nothing sends broadcasts yet ("phase 2" in
-- 0116); whatever sender is built must pick up 'queued' only.
-- ============================================================================

alter table wa_broadcasts drop constraint if exists wa_broadcasts_status_check;
alter table wa_broadcasts add constraint wa_broadcasts_status_check
  check (status in ('pending_approval', 'rejected', 'queued', 'sending', 'sent', 'partly_sent', 'failed'));
alter table wa_broadcasts alter column status set default 'pending_approval';

alter table wa_broadcasts add column if not exists reviewed_by uuid;
alter table wa_broadcasts add column if not exists reviewed_by_label text;
alter table wa_broadcasts add column if not exists reviewed_at timestamptz;
alter table wa_broadcasts add column if not exists review_note text;

create index if not exists wa_broadcasts_pending_idx on wa_broadcasts (created_at) where status = 'pending_approval';

-- Managers read broadcasts (not recipients) to review them.
drop policy if exists "business_reads_own_broadcasts" on wa_broadcasts;
create policy "business_reads_own_broadcasts" on wa_broadcasts
  for select using (sehat_caller_is_business(business_id) or sehat_is_staff());

-- ── Templates: admins and managers ──────────────────────────────────────────
drop policy if exists "admins_insert_wa_templates" on wa_message_templates;
create policy "admins_insert_wa_templates" on wa_message_templates
  for insert with check (sehat_is_staff());
drop policy if exists "admins_update_wa_templates" on wa_message_templates;
create policy "admins_update_wa_templates" on wa_message_templates
  for update using (sehat_is_staff()) with check (sehat_is_staff());

-- ── What is waiting, for the reviewer ───────────────────────────────────────
create or replace function sehat_wa_broadcasts_for_review(p_status text default 'pending_approval')
returns table (id uuid, business_id uuid, business_name text, business_city text, template_name text,
               category text, body text, params text[], recipient_count integer, total_cost_paise integer,
               status text, created_at timestamptz, review_note text, reviewed_by_label text, reviewed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.business_id, biz.name, biz.own_city, t.name, t.category, t.body, b.params,
         b.recipient_count, b.total_cost_paise, b.status, b.created_at, b.review_note, b.reviewed_by_label, b.reviewed_at
    from wa_broadcasts b
    join businesses biz on biz.id = b.business_id
    join wa_message_templates t on t.id = b.template_id
   where sehat_is_staff()
     and (p_status is null or b.status = p_status)
   order by b.created_at desc
   limit 200;
$$;
revoke all on function sehat_wa_broadcasts_for_review(text) from public, anon;
grant execute on function sehat_wa_broadcasts_for_review(text) to authenticated;

-- ── Approve or reject ───────────────────────────────────────────────────────
alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check
  check (kind in ('business_welcome', 'admin_new_business', 'clinic_new_booking', 'doctor_invite',
                  'nurse_unassigned', 'wa_broadcast_rejected'));

create or replace function sehat_review_wa_broadcast(p_broadcast uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  b wa_broadcasts%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_label text;
  v_balance integer;
begin
  if not sehat_is_staff() then raise exception 'Admins and managers only.' using errcode = '42501'; end if;
  select * into b from wa_broadcasts where id = p_broadcast for update;
  if b.id is null then raise exception 'Not found.' using errcode = 'P0002'; end if;
  if b.status <> 'pending_approval' then
    raise exception 'This broadcast was already %.', replace(b.status, '_', ' ') using errcode = 'P0001';
  end if;
  if not p_approve and (v_note is null or length(v_note) < 5) then
    raise exception 'Say why it is rejected — the clinic is told.' using errcode = 'P0001';
  end if;
  v_label := coalesce((select coalesce(nullif(full_name, ''), email) from admin_users where auth_uid = auth.uid()), 'Sehatsandhi');

  if p_approve then
    update wa_broadcasts set status = 'queued', reviewed_by = auth.uid(), reviewed_by_label = v_label,
           reviewed_at = now(), review_note = v_note
     where id = b.id;
  else
    -- Give the held money back, in the same locked way it was taken.
    select balance_paise into v_balance from business_wallets where business_id = b.business_id for update;
    update business_wallets set balance_paise = balance_paise + b.total_cost_paise, updated_at = now()
     where business_id = b.business_id;
    insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, broadcast_id, note, created_by)
    values (b.business_id, 'refund', b.total_cost_paise, coalesce(v_balance, 0) + b.total_cost_paise, b.id,
            'Broadcast not approved: ' || v_note, auth.uid()::text);
    update wa_broadcast_recipients set status = 'refunded' where broadcast_id = b.id and status = 'queued';
    update wa_broadcasts set status = 'rejected', reviewed_by = auth.uid(), reviewed_by_label = v_label,
           reviewed_at = now(), review_note = v_note
     where id = b.id;
    insert into email_outbox (kind, business_id, payload)
    values ('wa_broadcast_rejected', b.business_id,
            jsonb_build_object('broadcast_id', b.id, 'reason', v_note, 'refund_paise', b.total_cost_paise,
                               'recipients', b.recipient_count));
  end if;

  perform sehat_log_staff_action(
    case when p_approve then 'wa_broadcast_approved' else 'wa_broadcast_rejected' end,
    'business', b.business_id, (select name from businesses where id = b.business_id),
    jsonb_build_object('broadcast_id', b.id, 'recipients', b.recipient_count, 'note', v_note));

  return jsonb_build_object('status', case when p_approve then 'queued' else 'rejected' end);
end $$;
revoke all on function sehat_review_wa_broadcast(uuid, boolean, text) from public, anon;
grant execute on function sehat_review_wa_broadcast(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
