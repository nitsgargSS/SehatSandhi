#!/usr/bin/env bash
# app-point — an over-the-air update that points the installed Android apps at
# a Supabase project. For the move to Mumbai (docs/2026-10-mumbai-migration.md)
# and its rollback.
#
#   bash scripts/app-point.sh mumbai            build it and check it; publishes nothing
#   bash scripts/app-point.sh mumbai --publish  the same, then send it to the production channel
#   bash scripts/app-point.sh tokyo [--publish] the rollback
#
# The project's address and public key are baked into the app bundle, so this
# rewrites app/eas.json's production env (commit it afterwards — the next Play
# Store build must carry the same), builds the bundle with those values only
# (app/.env.local holds staging values and Metro would use them, so it is moved
# aside and put back), and refuses to publish unless the bundle names the
# target project and no other.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  mumbai) REF="tbmlhawtnrvvnemcljma" ;;
  tokyo)  REF="ctxkkqqtasegoowuqbmi" ;;
  *) echo "usage: bash scripts/app-point.sh mumbai|tokyo [--publish]"; exit 1 ;;
esac
PUBLISH=""; [ "${2:-}" = "--publish" ] && PUBLISH=1
OTHERS="tbmlhawtnrvvnemcljma ctxkkqqtasegoowuqbmi xmsycnlztqmyvtcyxkmg"

SB_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' .env.supabase | cut -d= -f2- | tr -d '"'"'"' \r')"
[ -n "$SB_TOKEN" ] || { echo "✗ SUPABASE_ACCESS_TOKEN is not in .env.supabase"; exit 1; }

# The same kind of public key the app uses today: a publishable key (sb_publishable_…) or the legacy anon JWT.
KEY="$(SB_TOKEN="$SB_TOKEN" REF="$REF" python3 - <<'PY'
import json, os, urllib.request
cur = json.load(open('app/eas.json'))['build']['production']['env']['EXPO_PUBLIC_SUPABASE_ANON_KEY']
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{os.environ['REF']}/api-keys?reveal=true",
                             headers={'Authorization': 'Bearer ' + os.environ['SB_TOKEN']})
keys = json.load(urllib.request.urlopen(req))
pick = [k for k in keys if k.get('type') == 'publishable'] if cur.startswith('sb_publishable_') else [k for k in keys if k.get('name') == 'anon']
if not pick: raise SystemExit('no matching public key for this project')
print(pick[0]['api_key'])
PY
)"

REF="$REF" KEY="$KEY" python3 - <<'PY'
import json, os
p = 'app/eas.json'
e = json.load(open(p))
env = e['build']['production']['env']
env['EXPO_PUBLIC_SUPABASE_URL'] = f"https://{os.environ['REF']}.supabase.co"
env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = os.environ['KEY']
env['EXPO_PUBLIC_IS_STAGING'] = 'false'
open(p, 'w').write(json.dumps(e, indent=2) + '\n')
PY
echo "✓ app/eas.json production env → $1 ($REF)"

cd app
[ -f .env.local ] && mv .env.local .env.local.moved
trap '[ -f .env.local.moved ] && mv .env.local.moved .env.local' EXIT
export EXPO_PUBLIC_SUPABASE_URL="https://$REF.supabase.co" EXPO_PUBLIC_SUPABASE_ANON_KEY="$KEY" EXPO_PUBLIC_IS_STAGING=false
rm -rf dist
npx expo export --platform android --output-dir dist --clear >/dev/null
HBC="$(find dist -name '*.hbc' | head -1)"
[ -n "$HBC" ] || { echo "✗ no bundle was built"; exit 1; }
for R in $OTHERS; do
  N="$(grep -a -c "$R" "$HBC" || true)"
  if [ "$R" = "$REF" ]; then [ "$N" -ge 1 ] || { echo "✗ the bundle does not name $REF"; exit 1; }
  else [ "$N" -eq 0 ] || { echo "✗ the bundle still names $R"; exit 1; }; fi
done
echo "✓ bundle checked: it talks to $REF and to no other project"

if [ -z "$PUBLISH" ]; then
  echo "Not published. Run again with --publish to send it to installed apps."
  exit 0
fi
npx eas-cli@latest update --skip-bundler --input-dir dist --channel production --environment production \
  --platform android --message "Database: $1 ($REF)" --non-interactive
echo "✓ Published. Apps pick it up when next opened and switch on the launch after."
