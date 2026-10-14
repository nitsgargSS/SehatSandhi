# Sehatsandhi launch films in Google Flow — version 2

Seven films. Each is five clips: **you speaking → a text card → you → a text card → you**, then the end card.
Three 8 s founder clips + two text cards trimmed to 4–5 s + a 4 s end card ≈ **36–38 seconds**.

| Film | For | id |
|---|---|---|
| Aapki sehat, ek jagah (launch) | Everyone — health records in one place | V1 |
| Doctors & clinics | Doctors, clinics, hospitals | V2 |
| Pharmacies | Chemists | V3 |
| Diagnostic labs | Labs, scan centres | V4 |
| Ambulance | Patients, ambulance services | V5 |
| Insurance advisors | Advisors | V6 |
| The patient app | Patients, families | V7 |

All prompts are in `sehatsandhi-flow-videos.json`.

## Why version 2 should look much better

Most bad AI video comes from asking for too much at once. Each founder clip now asks for **one thing**:
- He **stands** (only clip 1 has two slow steps), waist-up, facing the camera.
- **One** small hand gesture — no finger counting, no phone in hand (hands and objects are where AI fails most).
- **Empty, blurred backgrounds** — no other people.
- **Static camera** with a slow push-in.
- **Short Hindi lines** (about 6 seconds), so he never rushes or mumbles.

## Text inside the video

The main points now appear **inside the video**, in their own title-card clips: big green English words on a cream background, e.g. **"TOKEN · OPD · BILLS"** with a small line under it. Veo writes short English words cleanly when nothing else is in the frame; it still struggles with text next to a person and with Hindi script, so we don't ask for that.

Always read the words in the generated card. If a letter is wrong, regenerate once; if still wrong, keep the clip and type the words over it in the editor.

## Settings

labs.google/flow → New project → **Veo 3 – Quality**, **16:9**, **2 outputs** per prompt.

## Making one film (e.g. V1)

1. **Clip 1 (you):** *Ingredients to Video* → add your photo → paste clip 1's `prompt` → Generate. Pick the take most like you with good lip-sync. Expect 2–3 tries.
2. **Clip 3 and clip 5 (you):** hover clip 1 → **Extend** → paste the next founder prompt. Extend keeps your face, suit, light and voice consistent. If it drifts, extend from the last good clip again, or start a new *Ingredients to Video* with your photo.
3. **Clip 2 and clip 4 (text cards):** *Text to Video* (new clip, no photo) → paste the card's `prompt`. Check spelling.
4. Download all five clips.

**Your photo:** sharp, front-facing, good daylight, plain background, shoulders visible, no glasses or cap. This matters more than any prompt.

## In the editor (CapCut / Premiere / DaVinci)

- Order: 1 → 2 → 3 → 4 → 5 → end card. Trim text cards to 4–5 s.
- **Name strip** on clip 1: "Nitin Garg · Founder, Sehatsandhi", white on green (#0F6B4A), bottom-left, 1–5 s.
- **Hindi subtitles** of his lines (in the JSON) along the bottom — many people watch muted. Noto Sans Devanagari SemiBold.
- **End card** (make once): logo on cream (#FAF6EE), "स्वास्थ्य की नई साझेदारी", sehatsandhi.com. Google Play badge **only after the app is live**.
- One music track for the whole film at −22 dB; lower Flow's own music. One colour grade across all clips.
- Optional: cut away 2 s to a real screen recording of the app when he mentions it.

## Still worth knowing

- **Voice:** Flow's voice is not yours and can change between clips. For a perfect result, record the lines yourself and place them over the clips.
- **Hindi pronunciation:** if a line comes out slurred, replace the Hindi in the prompt with the `dialogue_roman` version and try again.
- **Label as AI-generated** when you post (YouTube/Instagram toggle) — important for a healthcare brand.
- Keep the wording as written: no "best", "No. 1", "guaranteed" or prices. Keep "call 108 first" in the ambulance film.
