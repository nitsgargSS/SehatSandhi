# WhatsApp on Meta — rolling it out to production

Written 9 Oct 2026, from what the two databases and projects actually hold on
that day. Sandbox is `xmsycnlztqmyvtcyxkmg`, production `ctxkkqqtasegoowuqbmi`.

## Where things stand

| | Sandbox | Production |
|---|---|---|
| Migrations 0216–0220 | applied by hand in the SQL editor; **not in the ledger** | not applied |
| Other migrations pending | none | 0082, 0085, 0101 — held back on purpose (see below) |
| Migrations edited after being applied | six (0170, 0177, 0178, 0189, 0193, 0196) | none |
| Edge functions | today's versions | yesterday's; `wa-broadcast-send` does not exist |
| WhatsApp secrets | Meta token, app secret, bot number list | **none** — neither AiSensy's nor Meta's |
| Bot | answering on Meta's test number | not running |

Two things follow from that table.

**Production sends nothing on WhatsApp today.** It has no AiSensy key and no
Meta token, so login codes, bills and appointment messages have only ever gone
by email there. The AiSensy flow ("Testing only") calls the *sandbox* database.
So this rollout cannot break a WhatsApp feature in production: there is none
running. It switches WhatsApp on for the first time.

**`npm run migrate:prod` must not be used for this.** It applies everything
pending, and that includes 0082, 0085 and 0101, which are held back until
`compute-price` and `razorpay-order` are redeployed — 0101's own header warns
it would quote ₹15,000 for a year and charge ₹24,000. Use
`scripts/apply-one.mjs`, which applies one named migration and records it, as
has been done for production since 0082.

## Before starting

1. **Fix `.env.supabase`.** `SUPABASE_DB_URL_PROD`, `SUPABASE_DB_URL_SANDBOX`,
   `SANDBOX_SUPABASE_URL` and `SANDBOX_SERVICE_ROLE_KEY` are each defined twice,
   the second time empty, and the empty one wins — every script reports "not
   set". Delete the four empty lines. The file also holds unrelated notes and
   tokens below the settings; move those out.
2. **Merge `staging` to wherever production deploys from**, without deploying
   the website yet.
3. Meta side, all of which has waiting time:
   - the main number's display name approved (it was Rejected);
   - the second number added to the Sehatsandhi WhatsApp account;
   - a payment method on the account;
   - templates approved (`docs/whatsapp-templates.md`), at least `login_code`
     (already approved), `prescription_link`, `bill_link` and `rating_request`.

## Step 1 — Sandbox bookkeeping

0216–0220 were pasted into the SQL editor, so the sandbox ledger does not know
about them. Each is safe to run again; applying them through the script records
them:

```
for v in 0216_whatsapp_bot_sessions 0217_wallet_pays_for_direct_messages \
         0218_whatsapp_needs_the_addon 0219_broadcasts_go_out \
         0220_last_senders_leave_aisensy; do
  node scripts/apply-one.mjs $v sandbox
done
```

The six edited migrations on the sandbox do not block production — production
applied the committed versions and has no mismatch. They only stop
`migrate.mjs up` on the sandbox. Five of the six were applied from a working
copy that was never committed, so what the sandbox actually holds for them
cannot be compared with the repo by reading history. `npm run schema:diff`
against each database is the way to find out whether they differ in anything
that matters; that is its own piece of work.

## Step 2 — Prove the migrations on production, changing nothing

`scripts/dry-run.mjs` applies them in one transaction and rolls it back:

```
node scripts/dry-run.mjs prod 0216_whatsapp_bot_sessions \
  0217_wallet_pays_for_direct_messages 0218_whatsapp_needs_the_addon \
  0219_broadcasts_go_out 0220_last_senders_leave_aisensy
```

It takes brief locks on `whatsapp_marketing_settings`, `business_wa_accounts`,
`business_wallet_transactions`, `wa_broadcast_recipients`, `wa_message_templates`
and `messaging_settings` while it runs. Do it at a quiet time.

## Step 3 — Apply the migrations to production

In order, one at a time, stopping at the first failure:

```
node scripts/apply-one.mjs 0216_whatsapp_bot_sessions prod
node scripts/apply-one.mjs 0217_wallet_pays_for_direct_messages prod
node scripts/apply-one.mjs 0218_whatsapp_needs_the_addon prod
node scripts/apply-one.mjs 0219_broadcasts_go_out prod
node scripts/apply-one.mjs 0220_last_senders_leave_aisensy prod
```

What changes for clinics the moment these are in, before any function or site
deploy: nothing visible. They add columns, tables and functions; two existing
functions are replaced:

- `sehat_wa_broadcast_blocker` now also asks for the messaging terms. Broadcast
  sending is switched off in production anyway (`sending_enabled`).
- The rating and order senders gain the provider switch and stay on AiSensy
  (and stay switched off) until told otherwise.

0219 schedules the broadcast sender every minute. It calls the edge function
only when a broadcast is waiting, and needs `project_url` and
`service_role_key` in production's Vault, as the appointment drain (0075) does.

## Step 4 — Deploy the functions to production

Seventeen functions import a shared file that changed. Each keeps the JWT
setting it has in production today:

```
P=ctxkkqqtasegoowuqbmi
# verified JWT (the default)
for f in wa-broadcast-send prescription-send bill-send discharge-send \
         lab-report-send phone-verify invoice-send appointment-notify \
         business-staff-action admin-team admin-business-action; do
  npx supabase functions deploy $f --project-ref $P --use-api
done
# no JWT verification
for f in whatsapp-inbound clinic-otp patient-otp staff-join email-send contact-submit; do
  npx supabase functions deploy $f --no-verify-jwt --project-ref $P --use-api
done
```

`admin-business-action`'s setting was not checked; read it in the dashboard
first and move it to the second list if it is off.

With no WhatsApp secrets in production, the functions behave as now, with one
improvement: a document a clinic emails goes through ZeptoMail, which production
has, where the old code wanted MSG91 email, which it does not.

## Step 5 — Deploy the website, then the app

The site needs Step 3 first: the admin's price card and the Send menu read
columns and functions the migrations add. Then publish the app update over the
air; it carries no native change, so it reaches 1.1.0 installs.

After this step clinics can email documents from the new Send menu. WhatsApp
shows "add it to your plan" or the price, and sends nothing yet.

## Step 6 — Switch WhatsApp on in production

Secrets, in the production project's Edge Functions → Secrets:

| Secret | Value |
|---|---|
| `META_ACCESS_TOKEN` | the system user's token |
| `META_APP_SECRET` | the app secret |
| `META_PHONE_NUMBER_ID` | `1302831736238429` (main number) |
| `META_CLINIC_PHONE_NUMBER_ID` | the second number's id |
| `WA_PROVIDER` | `meta` |
| `WA_INBOUND_SECRET` | already there; it is also Meta's verify token |
| `META_PRESCRIPTION_TEMPLATE`, `META_BILL_TEMPLATE`, … | each template's name, as it is approved |
| `GOOGLE_GEOCODING_KEY` | optional; a shared location → PIN |

Leave `WA_BOT_PHONE_IDS` unset for now: the bot answers nobody until Step 7.

Then the database's own copies for the rating and order senders (0220), and
the switches, as written in `docs/whatsapp-templates.md`.

Test with one real prescription to your own number from a clinic whose wallet
you have topped up by an admin adjustment.

## Step 7 — Move the main number's bot

Meta sends an app's webhooks to one address. Today that is the sandbox function.

1. In the app's WhatsApp → Configuration, change the Callback URL to
   `https://ctxkkqqtasegoowuqbmi.supabase.co/functions/v1/whatsapp-inbound?key=<production WA_INBOUND_SECRET>`
   and the verify token to the same secret.
2. To keep testing on the test number against the sandbox, give the *test*
   WhatsApp account its own callback, which Meta allows per account:
   `POST /<test WABA id>/subscribed_apps` with `override_callback_uri` (the
   sandbox URL) and `verify_token`. Otherwise the test number also arrives in
   production.
3. In AiSensy, switch the flow off. It reads the sandbox, but it would answer
   the same patients on the same number.
4. Set `WA_BOT_PHONE_IDS` in production to the main number's id, and the second
   number's too if the bot should answer there.
5. Send "Hi" to +91 70153 99355 from a phone and book one appointment.

The bot's doctor links come from the database, so in production they point at
the real site.

## Step 8 — Leave AiSensy

Only after a few days of Step 7 working:

1. Check the WhatsApp account's payment method is yours and has been charged.
2. Business Settings → WhatsApp accounts → Partners → remove AiSensy.
3. Cancel the AiSensy plan.

## Undoing a step

- **The bot:** clear `WA_BOT_PHONE_IDS`. It stops answering at once; messages
  are still saved.
- **Sends:** remove `WA_PROVIDER` and the `META_*` secrets. Functions fall back
  to "not configured", as production is today.
- **Functions:** redeploy from commit `1b350f1`, the last one before this work.
- **Migrations:** they only add. Leave them; nothing reads the new columns once
  the functions and site are rolled back. The one behaviour to undo by hand is
  the terms check, if broadcasts were already in use — they are not.
- **The webhook:** point the Callback URL back at the sandbox.

## Not part of this rollout

- 0082, 0085 and 0101 stay pending in production until `compute-price` and
  `razorpay-order` are redeployed for them.
- The "Book appointment" button on clinic messages and clinic-specific replies
  on the second number are not built.
- The sandbox's six edited migrations.
