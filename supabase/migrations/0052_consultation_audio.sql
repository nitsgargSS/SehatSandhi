-- ============================================================================
-- Sehatsandhi — somewhere to put the audio, and a way to be rid of it
--
-- Run AFTER 0051. Safe to re-run.
--
-- 0047 gave consultation_recordings an audio_path and an audio_deleted_at and
-- described the lifecycle: capture, transcribe, doctor confirms, audio goes.
-- Nothing implemented it — the toggle recorded consent and opened a row, and no
-- audio was ever captured. This is the storage half.
--
-- ── AUDIO IS THE MOST SENSITIVE THING THIS SYSTEM WILL EVER HOLD ────────────
-- A consultation recording is a named person describing their symptoms in their
-- own voice. It is worse than the transcript in every way: it carries identity
-- as well as content, it cannot be redacted, and a leak of it is unrecoverable
-- in a way a leak of text is not.
--
-- So it is treated as a courier, not a record:
--   • its own bucket, separate from patient-documents, so a policy mistake on
--     one cannot expose the other
--   • deleted the moment the doctor confirms the transcript
--   • swept anyway after 7 days, because a transcript nobody got round to
--     confirming is not a reason to keep the voice of the person who spoke
--
-- What survives is transcript_confirmed: what a doctor read and signed.
-- ============================================================================

-- Where the machine's suggestions live until a doctor accepts them. Separate
-- from the prescription entirely: these are proposals, and 0048 already refuses
-- to build a prescription from anything but a confirmed transcript.
alter table consultation_recordings
  add column if not exists suggested_medicines jsonb;
alter table consultation_recordings
  add column if not exists transcribed_at timestamptz;
alter table consultation_recordings
  add column if not exists transcribe_error text;

comment on column consultation_recordings.suggested_medicines is
  'What a model read out of the CONFIRMED transcript, as a draft for the '
  'prescription form. Never a prescription: a doctor edits and issues, and '
  '0048''s trigger enforces the same rule from the other end.';

-- Private, and its own bucket. patient-documents holds things a clinic uploads
-- deliberately; this holds a voice recording that exists for minutes. Sharing a
-- bucket would mean one wrong policy exposes both.
insert into storage.buckets (id, name, public)
values ('consultation-audio', 'consultation-audio', false)
on conflict (id) do nothing;

do $$
begin
  execute 'drop policy if exists "clinic reads own consultation audio" on storage.objects';
  execute $p$
    create policy "clinic reads own consultation audio" on storage.objects
      for select using (
        bucket_id = 'consultation-audio'
        and sehat_caller_owns_business(sehat_path_business(name))
      )$p$;

  execute 'drop policy if exists "clinic writes own consultation audio" on storage.objects';
  execute $p$
    create policy "clinic writes own consultation audio" on storage.objects
      for insert with check (
        bucket_id = 'consultation-audio'
        and sehat_caller_owns_business(sehat_path_business(name))
      )$p$;

  execute 'drop policy if exists "clinic removes own consultation audio" on storage.objects';
  execute $p$
    create policy "clinic removes own consultation audio" on storage.objects
      for delete using (
        bucket_id = 'consultation-audio'
        and sehat_caller_owns_business(sehat_path_business(name))
      )$p$;
exception when insufficient_privilege then
  raise warning 'could not create consultation-audio policies — create them in the dashboard before recording anything';
end $$;


-- ============================================================================
-- Everything still holding audio that should not be
--
-- Read by the sweeper, which does the deleting: a SQL function cannot remove an
-- object from storage, so the row-side bookkeeping and the file-side deletion
-- are separate steps and this is the list that joins them.
-- ============================================================================

create or replace view consultation_audio_to_purge as
  select
    r.id, r.business_id, r.audio_path,
    r.status, r.started_at, r.confirmed_at,
    case
      when r.status = 'confirmed'  then 'confirmed'
      when r.status = 'discarded'  then 'discarded'
      when r.status = 'failed'     then 'failed'
      else 'stale'
    end as reason
  from consultation_recordings r
 where r.audio_path is not null
   and r.audio_deleted_at is null
   and (
     r.status in ('confirmed', 'discarded', 'failed')
     -- Nobody confirmed it. That is a reason to lose the audio, not to keep it.
     or r.started_at < now() - interval '7 days'
   );

comment on view consultation_audio_to_purge is
  'Recordings whose audio should already be gone: confirmed, discarded, failed, '
  'or simply older than a week. Read by the audio sweeper — a database function '
  'cannot delete a storage object, so the deletion happens outside and calls '
  'sehat_mark_audio_deleted() back.';

create or replace function sehat_mark_audio_deleted(p_recording_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update consultation_recordings
     set audio_deleted_at = now(),
         audio_path = null,          -- the path is a pointer to nothing now
         updated_at = now()
   where id = p_recording_id;
end $$;

comment on function sehat_mark_audio_deleted is
  'Records that the audio for one recording is gone. Clears audio_path too: a '
  'path that no longer resolves is worse than no path, because it reads as '
  'though the file is still there.';

grant select on consultation_audio_to_purge to authenticated;
revoke all on function sehat_mark_audio_deleted(uuid) from anon, authenticated;


-- ============================================================================
-- SCHEDULING
--   The sweeper is the transcribe-consultation function's `purge` action, which
--   deletes the objects and calls sehat_mark_audio_deleted for each. Run it
--   hourly alongside the jobs 0008 describes:
--
--     select cron.schedule('purge-consultation-audio', '17 * * * *',
--       $$select net.http_post(
--           url := '<project-url>/functions/v1/transcribe-consultation',
--           headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>',
--                                         'Content-Type', 'application/json'),
--           body := '{"action":"purge"}'::jsonb)$$);
--
--   The confirm path deletes the audio immediately; this only catches what that
--   path missed — a browser closed mid-consultation, a transcription that
--   failed, a doctor who never came back.
-- ============================================================================
