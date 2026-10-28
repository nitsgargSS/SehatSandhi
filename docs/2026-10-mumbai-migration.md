# Moving production from Tokyo to Mumbai

Written 28 Oct 2026. Production (`ctxkkqqtasegoowuqbmi`, "SehatSandhi Project")
runs in `ap-northeast-1` (Tokyo). Supabase cannot change a project's region, so
the move is: make a new project in `ap-south-1` (Mumbai), copy everything into
it, point every caller at it, and keep Tokyo untouched as the fallback for a
week. The sandbox (`xmsycnlztqmyvtcyxkmg`) stays in Tokyo; it holds no real data.

Downtime: one window of 30–60 minutes, late at night, after a full rehearsal.

Roles: **N** = Nitin (accounts, dashboards, secret values), **C** = Claude (scripts,
commands, checks).

---

## What is tied to the Tokyo project

| Thing | Where it lives | How it moves |
|---|---|---|
| Tables, functions, triggers, RLS, views | `public` and the other schemas | `pg_dump` schema + data → restore |
| Logins (staff, owners, patients) and their passwords | `auth` schema | in the same data dump — nobody resets a password |
| 20 scheduled jobs (`wa-auto-send`, `billing-notify`, purges, ticks…) | `cron.job` | come with the dump; checked afterwards |
| Vault: `free_text_phone_salt` | `vault.secrets` | **copied by value** — it hashes phone numbers; a new salt breaks matching of every stored hash |
| Vault: `meta_access_token`, `meta_phone_number_id`, `meta_clinic_phone_number_id`, `aisensy_api_key` | `vault.secrets` | copied by value |
| Vault: `project_url`, `service_role_key` | `vault.secrets` | set to the **new** project's values (cron jobs call functions through these) |
| Vault: `wa_clinic_token_<business>` (own-number tokens) | `vault.secrets` | not copied; each connected clinic presses Connect again (today: only the demo clinic) |
| Files: `consultation-audio`, `letterheads`, `patient-documents`, `patient-uploads`, `profile-photos`, `wa-broadcast-images` | Storage | bucket rows in the dump; the files copied by script |
| 47 Edge Functions | `supabase/functions` | redeployed from the repo |
| Edge Function secrets (Meta ×12, Razorpay ×3, ZeptoMail, WA_*, REVIEW_*, ADMIN_*, SITE_URL, PHONE_VERIFY_ENABLED) | project settings | set again — **values cannot be read back from Supabase**, see step 1.3 |
| Auth settings: SMTP (ZeptoMail), Site URL, redirect URLs, password policy, OTP length/expiry, email templates, rate limits | dashboard only | re-entered by hand, from screenshots of the old project |
| Website | Vercel env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Production) | changed + redeploy |
| Mobile app | `app/eas.json` production env (baked into the bundle) | over-the-air update; next store build carries it |
| Meta webhooks | main WABA's `override_callback_uri` → Tokyo `whatsapp-inbound` | re-pointed with `scripts/wa-connect-production.sh` |
| Razorpay webhook | Razorpay dashboard → Tokyo `razorpay-webhook` | URL changed in Razorpay |
| Hardcoded ref | `app/eas.json`, `supabase/config.toml`, `scripts/wa-connect-production.sh`, `scripts/wa-move-number.sh`, `scripts/seed-demo-hospital.mjs`, `scripts/test-metrics.mjs`, `docs/whatsapp-rollout.md` | updated in one commit |
| `.env.supabase` | `SUPABASE_DB_URL_PROD` (migrate/apply-one scripts) | new connection string |

Not tied to the project: Vercel itself, ZeptoMail, Google Places, Expo push, the
Play Store listing, Meta templates (they belong to the WhatsApp accounts).

---

## Phase 1 — Prepare (no downtime, any day)

1.1 **N** — Supabase → New project in the same org: name `SehatSandhi Mumbai`,
region **South Asia (Mumbai) `ap-south-1`**, a strong database password (keep it).
Note the new project ref.

1.2 **N** — Screenshot every page of the OLD project's **Authentication** settings
(Providers → Email, SMTP, URL Configuration, Policies/password, Rate Limits,
Email Templates). Re-enter them on the new project. C checks them afterwards with
`scripts/check-auth-config.mjs`.

1.3 **N + C** — Edge Function secrets. Supabase shows only fingerprints, so the
values must come from their sources (Meta system-user token and app secret,
Razorpay keys and webhook secret, ZeptoMail token, …). Two ways:
- **a)** N collects each value from its source into a local file
  `.env.mumbai.local` (git-ignored by `.env.*.local`), and C runs
  `npx supabase secrets set --env-file .env.mumbai.local --project-ref <NEW>`.
- **b)** C writes a one-off Tokyo function that copies its own environment into
  the new project's secrets through the Management API, guarded by a one-time
  key, run once and deleted at once. Faster; needs N's Supabase access token
  for one command.
`WA_INBOUND_SECRET` is NOT copied — step 3.6 makes a fresh one.

1.4 **C** — Install the Postgres 17 client tools (`brew install postgresql@17`),
since the Supabase CLI's `db dump` needs Docker, which is not running here.
Add `SUPABASE_DB_URL_MUMBAI` (session pooler string from the new project's
Connect panel) to `.env.supabase`.

1.5 **C** — Write `scripts/move-region.sh`, which does phase 2 end to end and is
safe to re-run against an empty target:
1. roles + schema dump from Tokyo → restore into Mumbai;
2. data dump (`--data-only`, incl. `auth`, `storage`, `cron`) → restore with
   `session_replication_role = replica` (triggers off, so nothing fires twice);
3. Vault: read every secret decrypted from Tokyo and recreate it in Mumbai,
   except `project_url` / `service_role_key` (set to the new values) and
   `wa_clinic_token_*` (skipped);
4. Storage: copy every object of the 6 buckets through the Storage API;
5. checks: row counts per table equal on both sides; `auth.users` count equal;
   object count per bucket equal; `select jobname from cron.job` lists the 20 jobs;
   `select count(*) from vault.secrets` as expected;
6. deploy all 47 functions to Mumbai (same `--no-verify-jwt` set as today).

1.6 **C** — Add a maintenance switch: `public/maintenance.html` (Hindi + English,
"back in a few minutes", phone number) and a Vercel env `VITE_MAINTENANCE=true`
that makes the app render only that page. Ship it to production switched OFF.

---

## Phase 2 — Rehearsal (no downtime)

Run `scripts/move-region.sh` from live Tokyo into Mumbai while Tokyo keeps
serving. Then, against Mumbai only:
- a Vercel **preview** build with Mumbai's URL and key: log in as the demo clinic
  (password and email code), open patients, issue and print a prescription,
  open a stored lab report and a letterhead (files), take a Razorpay **test**
  payment on the sandbox keys if available;
- `node scripts/test-suite.mjs` pointed at Mumbai;
- compare timings: the same dashboard page on Tokyo and Mumbai.

Note how long the script took — that is the real downtime. Then **empty the
Mumbai project** (`drop schema public cascade` + auth/storage data, or delete
and recreate the project — simpler) so the real copy starts clean.

Go / no-go: every check green, the script under ~30 minutes.

---

## Phase 3 — Cutover (the night; ~30–60 min)

Pick a weekday around 00:30 IST (fewest bookings). N and C both present.

| Time | Who | Step |
|---|---|---|
| T−1 day | N | WhatsApp/email note to active clinics: "Sehatsandhi will be down for maintenance ~00:30–01:30 tonight." |
| T−0 | N | Vercel: set `VITE_MAINTENANCE=true` → redeploy. Website shows the maintenance page. |
| T−0 | C | Tokyo: unset `WA_BOT_PHONE_IDS` (bot stops answering) and pause all cron jobs (`cron.alter_job(..., active := false)`), so nothing writes during the copy. |
| +2 min | C | Run `scripts/move-region.sh` Tokyo → Mumbai; all checks must pass. |
| +30 | C | Mumbai: set `project_url` / `service_role_key` in Vault; cron jobs active. |
| +32 | N | Razorpay dashboard → Webhooks: URL → `https://<NEW>.supabase.co/functions/v1/razorpay-webhook` (same secret). |
| +34 | C | `scripts/wa-connect-production.sh` with the new ref: fresh `WA_INBOUND_SECRET` in Mumbai, main WABA's `override_callback_uri` → Mumbai `whatsapp-inbound`. Then set `WA_BOT_PHONE_IDS` in Mumbai. |
| +38 | N | Vercel Production env: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → Mumbai; `VITE_MAINTENANCE` → false; redeploy. |
| +42 | C | App: OTA update to the `production` channel with Mumbai values (the `.env.local` swap from the Play Store notes); verify the bundle contains only the new ref. |
| +45 | N + C | Smoke test on www.sehatsandhi.com: demo clinic login, open a patient, send a prescription on WhatsApp (arrives), message the bot from a phone (replies), a ₹1 Razorpay live payment if wanted, an email login code. |
| +55 | C | Tokyo: revoke `anon`/`authenticated` writes (so an old app copy that has not updated yet fails loudly instead of writing into Tokyo); leave reads; leave everything else as is. |
| +60 | N | Demo clinic: WhatsApp → Connect again (its own-number token was not copied). |

---

## Phase 4 — After

- Commit: new ref in `app/eas.json`, `supabase/config.toml`, scripts, docs;
  `.env.supabase` updated; privacy policy "Mumbai, India" (English + Hindi).
- Next Play Store build uses the new values (store profile).
- Watch for 2 days: function logs, cron runs (`cron.job_run_details`), Meta
  webhook deliveries, Razorpay webhook deliveries.
- Day 7: if nothing points at Tokyo any more, take a final dump of Tokyo to a
  file, then pause or delete the Tokyo project.

## Rollback (any time before Tokyo is deleted)

Until Mumbai has taken real writes: Vercel env back to Tokyo + redeploy, OTA
update back, Razorpay webhook back, `wa-connect-production.sh` with the Tokyo
ref, cron jobs active again, `WA_BOT_PHONE_IDS` back. Five minutes.

After Mumbai has taken real writes, rolling back loses them — so decide during
the smoke test, not the next morning.

## Optional: a stable address

Supabase's custom domain add-on would let the API live at `api.sehatsandhi.com`,
so a future move changes nothing in Vercel, the app, Meta or Razorpay. It needs a
paid Supabase plan (the org is on Free today) plus the add-on. Worth deciding
before the cutover, since adding it later means one more round of URL changes.

---

## Switch-night commands (as built, 28 Oct 2026)

Everything up to here was rehearsed: copy 571 s, all checks green; auth settings
copied (`auth-config`); 46 functions deployed (`functions`); 21 secrets copied
(`secrets`), 5 held back. Run in this order; `!` = typed into Claude Code,
**T** = run in the Terminal app (asks for hidden input).

| # | Who | Command / action |
|---|---|---|
| 0 | N | Vercel → sehat-sandhi → Settings → Environment Variables (Production): `VITE_MAINTENANCE` = `true` → Deployments → latest → Redeploy. Site shows the maintenance page. |
| 1 | ! | `npx supabase secrets set WA_BOT_PHONE_IDS= --project-ref ctxkkqqtasegoowuqbmi` (Tokyo bot stops answering) |
| 2 | ! | `bash scripts/move-region.sh pause-tokyo --cutover --yes` (Tokyo's scheduled jobs off; their state saved) |
| 3 | ! | `bash scripts/move-region.sh wipe --yes` (empty the rehearsal copy) |
| 4 | ! | `bash scripts/move-region.sh --cutover --yes` (the copy, ~10 min; jobs as they were in Tokyo; must end "✓ Everything matches") |
| 5 | ! | `npx supabase functions deploy move-secrets --no-verify-jwt --project-ref ctxkkqqtasegoowuqbmi` → `bash scripts/move-region.sh secrets --cutover` → `npx supabase functions delete move-secrets --project-ref ctxkkqqtasegoowuqbmi` |
| 6 | T | `REF=tbmlhawtnrvvnemcljma bash scripts/wa-connect-production.sh <main account id> [<business number account id>]` — new WA_INBOUND_SECRET in Mumbai, Meta's webhook → Mumbai. Then `! npx supabase secrets set WA_BOT_PHONE_IDS=<main number id> --project-ref tbmlhawtnrvvnemcljma` if step 5 did not already carry it. |
| 7 | N | Razorpay → Settings → Webhooks → edit → URL `https://tbmlhawtnrvvnemcljma.supabase.co/functions/v1/razorpay-webhook` (secret unchanged). |
| 8 | N | Vercel Production env: `VITE_SUPABASE_URL` = `https://tbmlhawtnrvvnemcljma.supabase.co`, `VITE_SUPABASE_ANON_KEY` = Mumbai's public key (same kind as now), `VITE_MAINTENANCE` = `false` → Redeploy. |
| 9 | ! | `bash scripts/app-point.sh mumbai` (build + check) → `bash scripts/app-point.sh mumbai --publish`; commit `app/eas.json`. |
| 10 | N+C | Smoke test on www.sehatsandhi.com: password + email-code login, a patient, Send prescription on WhatsApp (arrives), "Hi" to the bot (answers), a booking. |
| 11 | ! | Revoke writes on Tokyo for anon/authenticated (C gives the SQL), so an app copy that has not updated yet fails instead of writing into Tokyo. |
| 12 | N | Demo clinic → WhatsApp → Connect again (its own-number token was not copied). |
| 13 | C | Privacy policy → Mumbai; `supabase/config.toml`, scripts and docs → new ref; delete `~/sehatsandhi-move/`. |

Rollback (before Mumbai takes real writes): Vercel env back to Tokyo + redeploy,
`bash scripts/app-point.sh tokyo --publish`, Razorpay URL back,
`bash scripts/wa-connect-production.sh <ids>` (REF defaults to Tokyo),
`bash scripts/move-region.sh resume-tokyo --cutover`, `WA_BOT_PHONE_IDS` back on Tokyo.

Open before the night: the account ids for step 6 — the main number's WhatsApp
account and the business number's — confirm which currently point at Tokyo.
