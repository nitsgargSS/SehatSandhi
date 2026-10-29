#!/bin/zsh
# Deploy edge functions, keeping each one's current "verify JWT" setting as
# the project has it (a webhook deployed without --no-verify-jwt stops working).
#   scripts/deploy-functions.sh <project-ref> fn1 fn2 …
#   scripts/deploy-functions.sh <project-ref> --shared   every function that imports a changed _shared file
set -e
cd "${0:A:h}/.."
set -a; . ./.env.supabase; set +a
REF=$1; shift
FNS=("$@")
if [[ $1 == --shared ]]; then
  FNS=($(grep -l -E "_shared/(caller|serviceKey)\.ts" supabase/functions/*/index.ts | sed -E 's#supabase/functions/([^/]+)/index.ts#\1#'))
fi
NOJWT=" $(curl -s "https://api.supabase.com/v1/projects/$REF/functions" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).filter(f=>!f.verify_jwt).map(f=>f.slug).join(' ')))") "
for f in $FNS; do
  flag=(); [[ $NOJWT == *" $f "* ]] && flag=(--no-verify-jwt)
  printf '%-28s %s … ' $f "${flag:-jwt}"
  npx -y supabase@latest functions deploy $f --project-ref $REF --use-api $flag 2>&1 | grep -q "Deployed Functions" && echo ok || { echo FAILED; exit 1; }
done
