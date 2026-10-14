# Sehatsandhi launch films in Google Flow

Seven films, each four 8-second clips (32 s) plus a 4–6 s end card = about 36–38 s.

| Film | For | File id |
|---|---|---|
| Sehatsandhi — aapki sehat, ek jagah | Everyone (launch film, health records) | V1 |
| For doctors & clinics | Doctors, clinics, hospitals | V2 |
| For pharmacies | Chemists | V3 |
| For diagnostic labs | Labs, scan centres | V4 |
| Ambulance | Patients and ambulance services | V5 |
| For insurance advisors | Advisors | V6 |
| The app for patients | Patients and families | V7 |

Everything you paste is in `sehatsandhi-flow-videos.json`: for each clip, the full **prompt**, the **Hindi line** he speaks, its meaning, and the **text to add in the editor**.

## Before you start

1. **Your photo.** One sharp, front-facing photo, good light, plain background, shoulders visible, no sunglasses. A second photo at a slight angle helps.
2. **Flow settings.** Open labs.google/flow → New project. Model **Veo 3 – Quality** (the faster models don't do speech/lip-sync well). Aspect ratio **16:9**. Outputs per prompt: **2** (pick the better one).

## Making one film

**Clip 1**
1. Choose **Ingredients to Video**, add your photo as the ingredient.
2. Paste clip 1's `prompt`. Generate.
3. Pick the take where the face looks most like you and the lips match the words. Regenerate if not — expect 2–4 tries.

**Clips 2, 3, 4**
1. Hover the clip you chose → **Extend** (or add it to the Scene builder and click **+ → Extend**).
2. Paste the next clip's `prompt`. Extending carries his look, the suit, the light and the voice forward, which separate generations do not.
3. If an extension drifts (face changes, voice changes), go back and extend from the last good clip again.

**Export** the scene from Flow at 1080p (or download each clip).

## Finishing in an editor (CapCut, Premiere, DaVinci)

Do the typography here, not in Flow — AI video garbles text, especially Hindi.

- **Lower third** in clip 1: "Nitin Garg · Founder, Sehatsandhi" — white Poppins SemiBold on a green (#0F6B4A) bar, bottom-left, in at 1 s, out at 5 s.
- **Feature titles** (the `title` lines): one per clip, top-left or beside him in the empty third of the frame; cream (#FAF6EE) or white, 2–3 s, simple fade or slide. One message per screen.
- **Hindi subtitles** of his words along the bottom — many people watch muted. Noto Sans Devanagari SemiBold, white with a soft shadow.
- **Real app screens.** Flow cannot show the real app. Where a clip mentions the app, cut away for 2–3 s to a screen recording of the actual app (or a phone mock-up of it), then back to you. This also keeps the ads truthful.
- **End card** (make once, reuse): logo on cream, "स्वास्थ्य की नई साझेदारी", sehatsandhi.com. Add the **Google Play badge only after the app is live** on the Play Store.
- **Music:** keep one soft track across the whole film at −22 dB under his voice; Flow's own music changes between clips, so lower or mute it.
- **Colour:** apply one grade to all clips so they match.
- Cuts: 0.2–0.3 s cross-dissolve between clips, or hard cuts on his gestures.

## Things to know

- **Voice.** Flow invents a voice; it will not be your real voice, and it can change between generations even with Extend. If it bothers you, record the Hindi lines yourself on your phone in a quiet room and lay them over the clips in the editor (mute Flow's audio). That also makes every word exactly right.
- **Hindi speech.** Veo speaks Hindi, but sometimes slurs or mispronounces. The `dialogue_roman` line is the same text in Latin letters — if the Devanagari version comes out badly, replace the quoted line in the prompt with the roman one and try again.
- **8 seconds is short.** Each line is written to fit about 7 seconds. If he rushes, remove a few words rather than accept fast speech.
- **Your face.** Google may refuse some photos of real people, or the likeness may drift. Better light and a clearer photo help most. If a clip refuses, remove words like "exact face" from the prompt and try again.
- **Label it as AI.** These videos show an AI-generated version of you. When posting, mark them as AI-generated (YouTube and Instagram have a toggle; India's IT rules expect synthetic media to be labelled), and keep a small "AI-generated" note in a corner. It protects the brand's credibility in healthcare.
- **Claims.** The wording matches what Sehatsandhi does today. Don't add claims like "best", "No. 1", "guaranteed" or prices in the editor.
- **Ambulance film:** it tells people to call 108 first — keep that line.
