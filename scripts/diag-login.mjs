// Why is this address not getting a login code? Read-only.
//
//   node scripts/diag-login.mjs <prod|sandbox> <email>
//
// Reports the registered rows for the address (the exact match the login-code
// helper, _shared/loginAccount.ts, uses), whether a Supabase login exists for
// it, and when Supabase last handed a login code for it to the mail server.
import pg from 'pg'; import dotenv from 'dotenv'
dotenv.config({ path: '.env.supabase' })

const [envArg, rawEmail] = process.argv.slice(2)
const env = (envArg ?? '').toUpperCase()
if (!['PROD', 'SANDBOX'].includes(env) || !rawEmail) {
  console.error('usage: node scripts/diag-login.mjs <prod|sandbox> <email>'); process.exit(1)
}
const email = rawEmail.trim().toLowerCase()
const c = new pg.Client({ connectionString: process.env[`SUPABASE_DB_URL_${env}`], ssl: { rejectUnauthorized: false } })
await c.connect()
await c.query('set default_transaction_read_only = on')
const show = (label, rows) => { console.log(`\n${label}`); console.table(rows.length ? rows : [{ none: '—' }]) }

// Near matches too: a stray space or capital is enough for the helper to skip it.
show('Staff/doctor rows with this address (exact = what the helper matches)', (await c.query(`
  select p.full_name, p.email, lower(btrim(p.email)) = $1 as exact, p.auth_uid is not null as linked,
         bp.role, bp.status, b.name as clinic
    from practitioners p
    left join business_practitioners bp on bp.practitioner_id = p.id
    left join businesses b on b.id = bp.business_id
   where p.email ilike '%' || $2 || '%'`, [email, email.split('@')[0]])).rows)

show('Business rows with this address', (await c.query(`
  select name, email, lower(btrim(email)) = $1 as exact, status from businesses where email ilike '%' || $2 || '%'`,
  [email, email.split('@')[0]])).rows)

// recovery_sent_at is stamped when Supabase hands an email login code to the
// mail server (ZeptoMail over SMTP). Set and recent = sent; look at Spam or the
// ZeptoMail log. Empty = the code was never sent.
show('Supabase login for this address (code_last_sent = last login code handed to the mail server)', (await c.query(`
  select u.email, u.created_at, u.email_confirmed_at is not null as confirmed, u.last_sign_in_at,
         u.recovery_sent_at as code_last_sent, u.banned_until,
         exists (select 1 from auth.one_time_tokens t where t.user_id = u.id) as code_pending
    from auth.users u where lower(u.email) = $1`, [email])).rows)

await c.end()
