// Validate a Supabase Postgres connection string before trying to use it.
//
// Two mistakes account for nearly every failed first run, and both surface as
// errors that point somewhere unhelpful:
//
//   • The retired db.<ref>.supabase.co host — fails as a bare DNS ENOTFOUND,
//     which reads like a network problem rather than a wrong URL.
//   • An unencoded @ or ! in the password — the URL parses against the wrong
//     host boundary, so the pooler answers "Tenant or user not found", which
//     reads like the project does not exist.
//
// Catching both here turns ten minutes of confusion into one clear sentence.

/** Human-readable problems with a connection string, or [] if it looks usable. */
export function checkDbUrl(name, raw) {
  const problems = []
  if (!raw) return [`${name} is not set.`]

  // Parse manually: URL() splits credentials on the LAST '@', so an unencoded
  // '@' in the password silently yields a wrong hostname rather than an error.
  const body = raw.replace(/^postgresql:\/\//, '')
  const lastAt = body.lastIndexOf('@')
  if (lastAt === -1) return [`${name} is not a postgresql:// URL with credentials.`]

  const cred = body.slice(0, lastAt)
  const hostPart = body.slice(lastAt + 1)
  const firstColon = cred.indexOf(':')
  const user = firstColon === -1 ? cred : cred.slice(0, firstColon)
  const pass = firstColon === -1 ? '' : cred.slice(firstColon + 1)
  const host = hostPart.split(':')[0]

  // Unencoded specials in the password, judged on the RAW text: an already
  // encoded %40 is correct and must not be reported. (Decoding first would
  // turn every correctly-encoded password back into a "problem".)
  // Only characters that actually break parsing — '!' and other sub-delims are
  // legal unencoded in userinfo, so flagging them would suggest a no-op fix.
  const bad = [...new Set([...pass].filter(ch => '@:/?#[]'.includes(ch)))]
  if (bad.length) {
    // Decode before re-encoding so a partly-fixed value is not double-escaped.
    let decoded = pass
    try { decoded = decodeURIComponent(pass) } catch { /* stray % — treat as literal */ }
    problems.push(
      `${name}: the password contains ${bad.map(c => `"${c}"`).join(', ')}, which must be percent-encoded.\n` +
      `      Replace the password with: ${encodeURIComponent(decoded)}`,
    )
  }

  // Retired direct-connection host.
  if (/^db\..*\.supabase\.co$/.test(host)) {
    const ref = host.split('.')[1]
    problems.push(
      `${name}: "${host}" is the retired direct-connection host and no longer resolves.\n` +
      `      Use the Session pooler URI from Dashboard → Connect, which looks like:\n` +
      `        postgresql://postgres.${ref}:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres\n` +
      `      Note the username becomes postgres.${ref}, not bare "postgres".`,
    )
  }

  // Pooler host with the wrong username shape.
  if (host.includes('pooler.supabase.com') && !user.includes('.')) {
    problems.push(
      `${name}: on the pooler the username must embed the project ref ` +
      `(postgres.<ref>), but it is "${user}".`,
    )
  }

  // Transaction pooler cannot run pg_dump or multi-statement migrations.
  if (hostPart.includes(':6543')) {
    problems.push(
      `${name}: port 6543 is the transaction pooler, which cannot hold a session. ` +
      `Use the Session pooler on port 5432.`,
    )
  }

  return problems
}

/** Print problems for several URLs and exit non-zero if any are fatal. */
export function assertDbUrls(entries) {
  const all = entries.flatMap(([name, url]) => checkDbUrl(name, url))
  if (all.length) {
    console.error('\n  ✗ Connection string problems:\n')
    all.forEach(p => console.error(`  • ${p}\n`))
    console.error('  See .env.migrate.example for the expected format.\n')
    process.exit(1)
  }
}
