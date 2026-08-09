# Sehatsandhi — Supabase Edge Functions

Server-side pieces for the business side. Deployed with the Supabase CLI. These
hold secrets (Razorpay key secret, service-role key) that must **never** reach
the browser bundle.

| Function | Purpose | Called by |
|---|---|---|
| `compute-price` | Authoritative price for a set of pincodes (joins `service_areas → pricing_tiers`, applies `doctor_pricing_overrides`). | Wizard step 3 live summary (`src/lib/businessApi.ts`) |
| `razorpay-order` | Creates a Razorpay order; **amount is computed server-side** from the pincodes, never trusted from the client. Writes a `pending` `payments` row. | Wizard step 4 → "Pay with Razorpay" |
| `razorpay-verify` | Verifies the Razorpay HMAC signature, marks the payment `paid`/`failed`, activates the listing (`doctors.status = active`). | Razorpay Checkout success handler |

The **AISensy WhatsApp bot** (patient booking) and **MSG91 SMS** are a separate
backend effort — not in this repo. The website only deep-links patients into the
bot via `wa.me/<number>?text=...`, and the interactive preview on `/business` is
a UI mockup (`src/pages/business/WhatsAppBotMock.tsx`), not the live bot.

## 1. Prerequisites

```bash
npm i -g supabase          # Supabase CLI
supabase login
supabase link --project-ref <your-project-ref>
```

## 2. Apply the schema

Run `supabase/schema.sql` in the Supabase SQL Editor (or `supabase db push`).
It creates/extends `service_areas` (+`population`), `pricing_tiers` (seeded with
the four tiers), `clinic_users`, `payments` (+`listing` type, `pin_codes`,
`razorpay_order_id`), plus the booking-side tables (`patients`, `ratings`,
`discount_codes`, `doctor_pricing_overrides`).

> `population` is additive — if the live `service_areas` predates it, the app
> falls back to a per-tier estimate until you backfill the column.

## 3. Set function secrets

```bash
supabase secrets set \
  RAZORPAY_KEY_ID=rzp_live_xxx \
  RAZORPAY_KEY_SECRET=xxxxxxxx
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
Supabase runtime — do not set them yourself.

### Clinic login codes (`clinic-otp`)

Delivered over WhatsApp through **AISensy**, on the same number and API key the
rest of the platform already sends through:

```bash
supabase secrets set \
  AISENSY_API_KEY=<the same key appointment-notify and invoice-send use> \
  AISENSY_LOGIN_CAMPAIGN=<the live campaign name, exactly as spelled in AISensy>
```

Both are required — with either missing the function does not send at all and the
login screen shows "we cannot send login codes right now".

The campaign must be **live** (not draft) in AISensy, and its approved template
must take the code as its **single variable**, because the function sends
`templateParams: [code]` positionally. A template with a different variable count
is rejected at send time, not at deploy time — the campaign name being right is
not sufficient.

Two things worth knowing before relying on this for login:

- **Category.** A code delivered through a UTILITY or MARKETING template is
  deliverable but not what WhatsApp intends for credentials; an AUTHENTICATION
  template also renders the tap-to-copy button. Ask AISensy to submit the login
  campaign under AUTHENTICATION.
- **Opt-in.** AISensy applies opt-in rules to campaign sends. A business logging
  in for the first time may never have messaged your number, so confirm with
  AISensy that this campaign reaches numbers with no prior inbound message —
  otherwise the first login of every new signup is the one that fails.

Failures are logged with the provider's own response body
(`supabase functions logs clinic-otp`), which is where a wrong campaign name, an
unapproved template, or an exhausted wallet will name itself. The code itself is
never logged.

`META_PHONE_NUMBER_ID` + `META_ACCESS_TOKEN` (plus optional `META_TEMPLATE_NAME`,
`META_TEMPLATE_LANG`) remain as a fallback for a directly-owned Meta sender
later; unset, that path costs nothing. With neither provider configured and
`CLINIC_OTP_ECHO=true`, the login screen shows the code instead of sending it.
`CLINIC_OTP_ECHO` returns a live credential in the HTTP response and must never
be set in production.

## 4. Deploy

```bash
supabase functions deploy compute-price
supabase functions deploy razorpay-order
supabase functions deploy razorpay-verify

# --no-verify-jwt is required: the caller is logging in and has no session yet.
supabase functions deploy clinic-otp --no-verify-jwt
```

## 5. Frontend env (`.env`, never committed)

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

`src/lib/businessApi.ts` derives the functions URL from `VITE_SUPABASE_URL`.
When these are unset, the wizard hides the Razorpay path and the price summary
falls back to a client-side sum, so the UI still works in a bare dev setup.

## Pricing is server-authoritative

Both `compute-price` and `razorpay-order` call the same `_shared/pricing.ts`, so
the total the business sees and the amount charged are computed by identical
server logic from the pincodes — the client total is display-only and is never
used to set the charge.

## Local testing

```bash
supabase functions serve --env-file supabase/functions/.env.local
curl -X POST http://localhost:54321/functions/v1/compute-price \
  -H 'Content-Type: application/json' \
  -d '{"pincodes":["135001","135101"]}'
```

### Visitor location (`record-visitor-location`)

Records where each visit is, for expansion planning. City-level from the request
IP via [ipwho.is](https://ipwho.is) (https, no key, commercial use allowed); exact
coordinates only when the visitor granted the browser permission prompt.

Deploy with `--no-verify-jwt` — patients are anonymous:

```bash
supabase functions deploy record-visitor-location --no-verify-jwt
```

No secrets needed. `IPGEO_ENDPOINT` optionally overrides the lookup provider.

Writes `visitor_locations` (migration 0034) under the service role — the table
grants the browser no insert policy on purpose, so a client cannot place a
session anywhere it likes. Rows are purged after 90 days idle by
`sehat_purge_stale_visitor_locations()`; schedule it in pg_cron beside
`sehat_purge_old_site_events()`.
