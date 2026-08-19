// transcribe-consultation — audio in, a draft transcript out; and, separately,
// medicine suggestions read out of a transcript a doctor has already confirmed.
//
// Three actions on one function, because they share the same clients and the
// same audio lifecycle:
//
//   transcribe  audio → English transcript → DELETE THE AUDIO, status 'draft'
//   suggest     CONFIRMED transcript → structured medicine lines (Claude)
//   purge       safety net: audio a transcribe call never got to delete
//
// ── THE AUDIO DOES NOT SURVIVE THE TRANSCRIPT ───────────────────────────────
// The recording is deleted inside the same request that transcribes it, the
// moment the text is safely written. It is not kept until the doctor confirms
// the draft, and it is not kept for a retention window.
//
// A recording of a consultation is the most sensitive thing this system ever
// holds — a patient's voice, their symptoms, and whatever else they said in a
// room they believed was private. Once there is a transcript it has no further
// use: every step after this reads text.
//
// `purge` is now only a safety net, for audio whose transcription FAILED and
// which therefore still exists so it can be retried. That makes the purge cron
// required rather than housekeeping: without it, a failed transcription leaves
// audio sitting for seven days.
//
// ── THE TRANSCRIPT IS ENGLISH, NOT WHAT WAS SAID ────────────────────────────
// Consultations happen in Hindi, Punjabi, or code-mixed with English drug names
// dropped in. Sarvam's translate model detects the language and returns
// English, so the record is one language a later reader can rely on.
//
// This is a real trade-off, not a free win. The transcript is a RENDERING of
// the consultation, the audio it came from is already gone, and nobody can go
// back and check it. Which is exactly why the draft still has to be read and
// confirmed by the doctor before anything downstream touches it.
//
// ── THE RULE THIS FILE EXISTS TO KEEP ───────────────────────────────────────
// A machine transcript is a draft. `suggest` refuses to run on anything but a
// CONFIRMED transcript, and what it returns is written to suggested_medicines —
// never to a prescription. 0048's trigger enforces the same rule from the other
// side: a prescription citing a non-confirmed recording is rejected by the
// database. Two independent guards, because "15 mg" misheard as "50 mg" is a
// wrong dose in someone's hand.
//
// ── WHY TWO DIFFERENT VENDORS ───────────────────────────────────────────────
// Anthropic does not do speech-to-text, so recognition is a separate service.
// The default is Sarvam, which is built for Indian languages and handles the
// Hindi/English code-mixing an actual consultation is conducted in — and keeps
// the audio in India, which matters more for a voice recording of a patient
// than for most things. It sits behind one function; swapping it is one edit.
//
// Request:  { action: "transcribe", recordingId }
//           { action: "suggest",    recordingId }
//           { action: "purge" }
//   service-role auth required for all three
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      SARVAM_API_KEY            (or swap transcribeAudio below)
//      ANTHROPIC_API_KEY         (suggestions; absent = feature simply off)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { corsHeaders, json } from '../_shared/cors.ts'

const BUCKET = 'consultation-audio'

// ── Speech recognition ──────────────────────────────────────────────────────
//
// The one vendor-shaped function. Speech in, ENGLISH text out, or it throws.
//
// speech-to-text-translate, not speech-to-text. The consultation is in Hindi,
// or Punjabi, or code-mixed with English drug names dropped in — and the record
// has to be one language a later reader can rely on. Sarvam's translate models
// detect the source and return English in a single call, so there is no second
// hop and no window where an untranslated draft exists.
//
// The cost of this is worth naming: the transcript is no longer WHAT WAS SAID,
// it is an English rendering of it, and the audio is gone straight afterwards
// so nobody can go back and check. That is why the draft still has to be
// confirmed by the doctor before anything reads it.
async function transcribeAudio(audio: Blob): Promise<{ text: string; source: string | null }> {
  const key = Deno.env.get('SARVAM_API_KEY')
  if (!key) throw new Error('SARVAM_API_KEY is not set — transcription is unconfigured')

  const form = new FormData()
  form.append('file', audio, 'consultation.webm')
  // Detects the spoken language itself and renders it into English. No
  // language_code: telling it the wrong dominant language is worse than letting
  // it decide, and a clinic near a state border hears several.
  form.append('model', 'saaras:v2')

  const res = await fetch('https://api.sarvam.ai/speech-to-text-translate', {
    method: 'POST',
    headers: { 'api-subscription-key': key },
    body: form,
  })
  if (!res.ok) {
    throw new Error(`speech-to-text-translate ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const body = await res.json()
  const text = String(body.transcript ?? body.text ?? '').trim()
  if (!text) throw new Error('speech-to-text-translate returned nothing')
  // What it heard, recorded so a doctor reading an odd transcript knows whether
  // it came through a translation or was already English.
  const source = body.language_code ? String(body.language_code) : null
  return { text, source }
}

// ── Medicine extraction, from a CONFIRMED transcript only ───────────────────
//
// Structured outputs rather than asking for JSON and hoping: the schema is
// enforced, so the prescription form never has to parse a model's prose. The
// prompt says "may be empty" deliberately — a consultation that prescribed
// nothing must come back with nothing rather than something invented to fill
// the shape.
const MEDICINE_SCHEMA = {
  type: 'object',
  properties: {
    medicines: {
      type: 'array',
      description: 'Medicines the doctor actually prescribed. Empty if none were.',
      items: {
        type: 'object',
        properties: {
          drug_name: { type: 'string', description: 'As the doctor said it, spelling corrected.' },
          strength: { type: 'string', description: 'e.g. "500 mg". Empty string if not stated.' },
          dosage: { type: 'string', description: 'e.g. "1-0-1". Empty string if not stated.' },
          duration: { type: 'string', description: 'e.g. "5 days". Empty string if not stated.' },
          instructions: { type: 'string', description: 'e.g. "after food". Empty string if not stated.' },
          verbatim: { type: 'string', description: 'The exact phrase this was read from.' },
          uncertain: { type: 'boolean', description: 'True if the audio was unclear on any field.' },
        },
        required: ['drug_name', 'strength', 'dosage', 'duration', 'instructions', 'verbatim', 'uncertain'],
        additionalProperties: false,
      },
    },
    advice: { type: 'string', description: 'Non-medicine advice given. Empty string if none.' },
    follow_up: { type: 'string', description: 'Follow-up interval if stated, e.g. "1 week". Empty string if none.' },
  },
  required: ['medicines', 'advice', 'follow_up'],
  additionalProperties: false,
}

const EXTRACT_SYSTEM = `You read a doctor's confirmed consultation note and pull out what was prescribed.

The note is from an Indian clinic and is usually Hindi and English mixed together, often in Roman script. Drug names are frequently Indian brand names.

Rules:
- Extract only what the note actually says. If a dose, duration, or instruction was not stated, return an empty string for it. Never infer a "typical" dose.
- If you are unsure of a drug name or any field — the note is garbled, the name is ambiguous, two readings are plausible — set uncertain to true and put your best reading in the field. A flagged uncertain line is useful; a confidently wrong dose is dangerous.
- Copy the exact phrase you read each medicine from into verbatim, so the doctor can check your reading against their own words.
- Return an empty medicines array if nothing was prescribed. Do not invent an entry to fill the shape.

You are producing a draft for a doctor to correct. You are not writing a prescription.`

async function suggestMedicines(transcript: string): Promise<unknown | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return null   // feature simply off; not an error

  const anthropic = new Anthropic({ apiKey })

  const response = await anthropic.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    betas: ['server-side-fallback-2026-07-01'],
    // Safety classifiers can decline; "default" routes by refusal category so a
    // declined extraction is retried rather than lost.
    fallbacks: 'default',
    system: EXTRACT_SYSTEM,
    output_config: {
      // Reading a code-mixed clinical note is not a lookup — but it is bounded,
      // and this runs once per consultation, so medium rather than the default.
      effort: 'medium',
      format: { type: 'json_schema', schema: MEDICINE_SCHEMA },
    },
    messages: [{ role: 'user', content: transcript }],
  })

  // A refusal returns HTTP 200 with empty or partial content — reading
  // content[0] unconditionally would throw here rather than degrade.
  if (response.stop_reason === 'refusal') {
    throw new Error('the model declined to read this note')
  }

  const block = response.content.find((b: { type: string }) => b.type === 'text')
  if (!block) return null
  return JSON.parse((block as { text: string }).text)
}

// ── Audio deletion ──────────────────────────────────────────────────────────
async function dropAudio(
  supabase: ReturnType<typeof createClient>, id: string, path: string | null,
) {
  if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined)
  // Marked deleted even if the remove failed: the row must not keep pointing at
  // a file we intended to destroy, and the sweeper will try the object again.
  await supabase.rpc('sehat_mark_audio_deleted', { p_recording_id: id })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.includes(serviceKey)) return json({ error: 'unauthorised' }, 401)

  let action = ''
  let recordingId = ''
  try {
    const body = await req.json()
    action = String(body.action ?? '')
    recordingId = String(body.recordingId ?? '')
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

  // ── purge ────────────────────────────────────────────────────────────────
  if (action === 'purge') {
    const { data: rows, error } = await supabase
      .from('consultation_audio_to_purge').select('*').limit(200)
    if (error) return json({ error: error.message }, 500)

    let dropped = 0
    for (const r of (rows ?? []) as { id: string; audio_path: string | null }[]) {
      await dropAudio(supabase, r.id, r.audio_path)
      dropped++
    }
    return json({ purged: dropped })
  }

  if (!recordingId) return json({ error: 'recordingId required' }, 400)

  const { data: rec, error: recErr } = await supabase
    .from('consultation_recordings')
    .select('id, business_id, status, audio_path, transcript_confirmed, transcript_language')
    .eq('id', recordingId).maybeSingle()
  if (recErr) return json({ error: recErr.message }, 500)
  if (!rec) return json({ error: 'no such recording' }, 404)

  // ── transcribe ───────────────────────────────────────────────────────────
  if (action === 'transcribe') {
    if (!rec.audio_path) return json({ error: 'that recording has no audio' }, 409)

    try {
      const { data: file, error: dlErr } = await supabase.storage
        .from(BUCKET).download(rec.audio_path as string)
      if (dlErr || !file) throw new Error(dlErr?.message ?? 'audio could not be read')

      const { text, source } = await transcribeAudio(file)

      await supabase.from('consultation_recordings').update({
        transcript_draft: text,
        // Names the translation, so nobody later mistakes this for a verbatim
        // record of the room.
        transcript_engine: 'sarvam:saaras:v2 (translated to English)',
        transcript_language: source ?? rec.transcript_language ?? null,
        status: 'draft',
        transcribed_at: new Date().toISOString(),
        transcribe_error: null,
      }).eq('id', recordingId)

      // THE AUDIO GOES NOW.
      //
      // Not when the doctor confirms the draft, which is what this used to wait
      // for and could be days. The recording of a consultation is the most
      // sensitive thing this system ever holds, and the moment the transcript
      // exists it has no further use — every downstream step reads text.
      //
      // Deliberately after the update and not before: if writing the transcript
      // fails we still have the audio and the sweeper can retry. Losing the
      // audio and the transcript both would lose the consultation outright.
      await dropAudio(supabase, recordingId, rec.audio_path as string)

      return json({ ok: true, characters: text.length, audioDeleted: true })
    } catch (e) {
      const message = String((e as Error).message ?? e).slice(0, 400)
      // 'failed' rather than leaving it stuck at 'transcribing': the sweeper
      // treats failed as a reason to drop the audio, and a doctor sees that it
      // failed rather than a spinner that never resolves.
      await supabase.from('consultation_recordings').update({
        status: 'failed', transcribe_error: message,
      }).eq('id', recordingId)
      return json({ error: message }, 502)
    }
  }

  // ── suggest ──────────────────────────────────────────────────────────────
  if (action === 'suggest') {
    // The guard this whole file exists for. Suggestions come from what a doctor
    // read and signed, never from what a machine heard.
    if (rec.status !== 'confirmed' || !rec.transcript_confirmed) {
      return json({ error: 'suggestions need a confirmed transcript' }, 409)
    }

    try {
      const suggestions = await suggestMedicines(rec.transcript_confirmed as string)
      if (suggestions === null) return json({ ok: true, configured: false })

      await supabase.from('consultation_recordings')
        .update({ suggested_medicines: suggestions }).eq('id', recordingId)

      return json({ ok: true, configured: true, suggestions })
    } catch (e) {
      return json({ error: String((e as Error).message ?? e).slice(0, 400) }, 502)
    }
  }

  return json({ error: 'action must be transcribe, suggest or purge' }, 400)
})
