# Sandbox mode — setup and testing

An isolated Supabase project for testing registration and payment end to end:
real forms, real Razorpay Checkout in test mode, no junk rows in production and
no money moving.

The application code is already built. What remains needs credentials and
dashboard access, so it has to be done by hand — this is that runbook.

**Time:** about 45 minutes, most of it waiting for a project to provision.

---

## How it works

One Vercel deployment, two backends. `src/lib/env.ts` decides which is active:

- The choice lives in `sessionStorage`, so it dies with the tab.
- Anything unrecognised resolves to production.
- Sandbox must be **built in** to be reachable. With `VITE_SANDBOX_*` unset,
  Vite inlines `sandbox:{url:"",anon:""}` and `getEnv()` can only ever return
  `'prod'` — no query param or storage value can override it.
- Every client reads `activeConfig()`, so the Supabase client and the
  edge-function calls cannot end up on different projects.

In sandbox you get a non-dismissible magenta banner, an autofill button on the
three registration forms, and a Sandbox tab in the admin panel. In production
none of those exist.

---

## Part 1 — Fix the schema drift (do this first)

The repo currently **cannot rebuild its own database**. Ten tables the app
queries (`camps_offers`, `organizations`, `org_specialities`,
`org_subscriptions`, `doctor_availability`, `rating_aggregate`,
`unmet_demand_log`, `patient_profiles`, `sehat_points`, `discount_code_usage`)
exist in no committed SQL, and `discount_codes` has a different primary key live
than `legacy/schema.sql` declares.

A sandbox built from the repo files would 400 on the admin dashboard and
silently apply ₹0 coupons. So capture production first.

### 1.1 Install the CLI

```bash
brew install supabase/tap/supabase
```

### 1.2 Capture the real schema

Get the project ref and database password from
**Dashboard → Settings → Database**.

```bash
supabase db dump \
  --db-url "postgresql://postgres.<PROD_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres" \
  --schema public \
  -f supabase/migrations/0001_baseline.sql
```

Sanity-check before continuing:

```bash
grep -c "CREATE TABLE" supabase/migrations/0001_baseline.sql   # expect > 23
grep -A15 "CREATE TABLE.*discount_codes" supabase/migrations/0001_baseline.sql
```

The `discount_codes` block must show a **uuid `id`** column. If it shows `code
text primary key`, you dumped the wrong database.

Then make sure `create extension if not exists pgcrypto;` appears near the top
(needed for `gen_random_uuid()`), and delete any `ALTER ... OWNER TO` lines if
they error on a fresh project.

### 1.3 Record it as already applied to production

Production already *has* this schema — it was dumped from there. Running it
would fail on duplicate objects.

```bash
cp .env.migrate.example .env.migrate     # then fill in both connection strings
node scripts/migrate.mjs baseline --env prod --version 0001_baseline --yes
```

### 1.4 Capture reference data

Sandbox needs real pricing or the payment test cannot run. In the **production**
SQL Editor:

```sql
select 'insert into pricing_tiers (tier_number,tier_name,monthly_price,premium_slot_1_weekly,premium_slot_2_weekly,premium_slot_3_weekly,is_active) values ('
  || tier_number || ',' || quote_literal(tier_name) || ',' || monthly_price || ','
  || premium_slot_1_weekly || ',' || premium_slot_2_weekly || ',' || premium_slot_3_weekly || ',true'
  || ') on conflict (tier_number) do nothing;'
from pricing_tiers order by tier_number;
```

Repeat for `service_areas` and `vertical_billing`, and save the output to
`supabase/seeds/reference_data.sql`. Safe to commit — public reference data, no
PII.

> Seed `is_active = true` explicitly. `useServiceAreas` filters on it (anon) but
> the pricing edge function does not (service role bypasses RLS), so inactive
> rows would show ₹0 in the UI while the server charged correctly.

Once `0001_baseline.sql` exists, `npm run schema:check` will start reporting the
ten drifted tables as resolved.

---

## Part 2 — Create the sandbox project

1. **Dashboard → New Project**, name it `sehatsandhi-sandbox`, **same region as
   production** so latency-sensitive behaviour matches.

2. Add its connection string to `.env.migrate` as `SUPABASE_DB_URL_SANDBOX`,
   then apply the schema:
   ```bash
   node scripts/migrate.mjs up --env sandbox
   node scripts/migrate.mjs status --env sandbox   # 0001 applied, none pending
   ```

3. Apply `supabase/seeds/reference_data.sql` in the sandbox SQL Editor.

4. **Auth → Providers → Email → uncheck "Confirm email."**
   `/doctor` calls `signUp()`; with confirmation on, Supabase's default SMTP
   rate-limits after a few sends and repeat runs fail with
   `over_email_send_rate_limit`, surfacing as a generic error. `.test` addresses
   are also undeliverable and may be rejected outright.

5. Seed the fixed logins (needs `SANDBOX_SUPABASE_URL` and
   `SANDBOX_SERVICE_ROLE_KEY` in `.env.migrate`):
   ```bash
   node scripts/seed-sandbox-accounts.mjs
   ```
   Creates `sandbox-doctor@sehatsandhi.test` and `sandbox-admin@sehatsandhi.test`
   with password `Sandbox@123`. These survive purges.

---

## Part 3 — Deploy the edge functions

Get **test-mode** Razorpay keys: Razorpay Dashboard → toggle to **Test Mode** →
Settings → API Keys → Generate. They start `rzp_test_`.

```bash
supabase link --project-ref <SANDBOX_REF>

supabase secrets set \
  RAZORPAY_KEY_ID=rzp_test_xxxxx \
  RAZORPAY_KEY_SECRET=xxxxx \
  SANDBOX_PURGE_ENABLED=true \
  SANDBOX_PURGE_TOKEN=$(openssl rand -hex 24)

supabase functions deploy compute-price
supabase functions deploy razorpay-order
supabase functions deploy razorpay-verify
supabase functions deploy sandbox-purge
```

Note the purge token — it goes in the frontend env below.

> **`SANDBOX_PURGE_ENABLED` must never be set on the production project.** It is
> the outermost guard: without it, `sandbox-purge` refuses every request even
> with a valid token and the confirmation phrase.

> `supabase link` leaves the CLI pointed at sandbox. Pass `--project-ref`
> explicitly on future production deploys, or you will ship to the wrong place.

---

## Part 4 — Frontend env

In **Vercel → Settings → Environment Variables**, add to Production (alongside
the existing prod vars, which stay unchanged):

```
VITE_SANDBOX_SUPABASE_URL=https://<sandbox-ref>.supabase.co
VITE_SANDBOX_SUPABASE_ANON_KEY=<sandbox anon key>
VITE_SANDBOX_PURGE_TOKEN=<the token from Part 3>
```

Redeploy. Add the same three to your local `.env` for `npm run dev`.

---

## Part 5 — End-to-end test

### Step 0 — Pre-flight (do not skip)

In the sandbox SQL Editor:

```sql
select count(*) from service_areas where is_active;               -- > 0
select tier_number, monthly_price, is_active from pricing_tiers;  -- 4 rows, prices > 0
select count(*) from camps_offers;                                -- 0, NOT an error
select count(*) from organizations;                               -- 0, NOT an error
```

If the last two error, the baseline dump was incomplete — go back to 1.2.

Then open `/ng-ctrl-2026/dashboard?env=sandbox`, click **every** tab with
DevTools open. Any `[admin] … query failed` warning means a missing table.

### Step 1 — Business registration with payment (the main test)

1. Go to `<your-domain>/business/register?env=sandbox`.
2. Confirm the magenta banner and the bottom-left **⚡ Autofill test data**
   button. If they're missing, the sandbox env vars aren't in this deployment.
3. Step 1: pick **Doctors / Clinic**.
   **This matters** — pharmacy, insurance and ambulance are on the commission
   plan and never reach Razorpay. `razorpay-order` rejects them by design.
4. Click autofill → Continue → Continue.
5. **Checkpoint:** step 3 must show a **non-zero ₹ total** over 2 pincodes.
   ₹0 means reference data didn't seed — stop and fix Part 1.4.
6. Continue → **Pay with Razorpay**.
7. **Confirm the modal says "Test Mode."** If it says live, the sandbox project
   has production keys — abort immediately.
8. Card `4111 1111 1111 1111`, expiry `12/30`, CVV `123`, OTP `1234`.
9. Expect **"Payment received — listing active!"**

Other test instruments: failure card `4000 0000 0000 0002`, UPI
`success@razorpay` / `failure@razorpay`.

### Step 2 — Verify in the database

```sql
select name, speciality, status, pin_codes from doctors
where name like '[TEST]%' order by created_at desc limit 5;
-- status = 'active', flipped by razorpay-verify

select amount, type, status, razorpay_order_id, razorpay_payment_id
from payments order by created_at desc limit 5;
-- type='listing', status='paid', payment id starts 'pay_', amount matches step 3
```

Cross-check in Razorpay Dashboard (Test Mode) → Transactions. Paise = 100×
rupees.

### Step 3 — The other two forms

- `/doctor` → autofill → Continue ×3 → Submit. Expect `status='pending'` and a
  `sandbox+NNNN@sehatsandhi.test` user under Auth → Users.
- `/partner` → autofill (defaults to Lab) → Submit. Expect `speciality='LAB'`,
  `qualification='Diagnostic Lab'`.

### Step 4 — Purge

Admin → **🧪 Sandbox** → type `PURGE SANDBOX` → Purge.

```sql
select count(*) from doctors;        -- 0
select count(*) from payments;       -- 0
select count(*) from service_areas;  -- UNCHANGED, non-zero   ← the key assertion
```

`sandbox-doctor@` and `sandbox-admin@` must still exist under Auth → Users;
`sandbox+NNNN@` accounts must be gone.

> The purge keeps the seeded **auth accounts** but does delete the seeded
> **doctors row** — `doctors` is user-generated data, and carving out an
> exception would mean the purge no longer leaves a truly clean database.
> Re-run `node scripts/seed-sandbox-accounts.mjs` afterwards to restore it; the
> script is idempotent and will report the accounts as already existing.

### Step 5 — Reference sync

```bash
npm run sync:reference:dry     # counts only, writes nothing
npm run sync:reference         # mirror mode
```

`mirror` makes sandbox an exact copy of production's reference tables;
`--mode upsert` keeps sandbox-only rows you added by hand. Verify
`select count(*) from doctors;` is **unchanged** — the sync must never touch
user data.

---

## Day-to-day

```bash
npm run schema:check      # every table classified, purge manifest current
npm run schema:diff       # has production drifted from the repo?
npm run sync:reference    # refresh sandbox pricing after a production change
```

**Every schema change from here is a new numbered migration** applied to both
databases via `scripts/migrate.mjs`. Editing an already-applied migration is a
hard error — the runner checksums them, which is what stops the drift from
coming back.

Adding a table? `supabase/tables.config.yaml` needs a classification for it or
`npm run schema:check` fails. That is deliberate: an unclassified table is
never synced and never purged, and you would not find out for months.

---

## Known gaps

These are pre-existing and out of scope for the sandbox work, but sandbox
testing will surface them:

1. **No Razorpay webhook.** The flow depends entirely on the browser `handler`
   callback. Close the modal at the moment of success and the payment captures
   at Razorpay while `payments.status` stays `pending` forever. Worth
   reproducing deliberately in sandbox to see the orphan row.

2. **`Partner.tsx` discards its type-specific fields.** `handleSubmit` never
   persists `license`, `nabl`, `irda`, `permit` or `ambulance_type` — a
   pharmacy's drug licence number is collected and thrown away. Autofill fills
   them anyway, so the gap is obvious when you compare the form to the row.

3. **Free-tier Supabase projects pause after 7 days idle.** First thing to check
   when "sandbox is broken".
