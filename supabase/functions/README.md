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

## 4. Deploy

```bash
supabase functions deploy compute-price
supabase functions deploy razorpay-order
supabase functions deploy razorpay-verify
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
