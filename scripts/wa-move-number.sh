#!/usr/bin/env bash
# Move a WhatsApp number from the account a provider made (AiSensy's credit
# line) to the account we own ("Sehatsandhi Direct"), then let production's bot
# answer on it. This is Meta's own migration: the number, its name and its
# quality rating come across; the old provider stops working on it the moment
# the code is verified. ONE-WAY in practice — read docs/whatsapp-rollout.md.
#
#   bash scripts/wa-move-number.sh
#
# Stages, each announced and each stopping on any refusal:
#   1. ask Meta to add the number to our account as a migration   (nothing moves yet)
#   2. Meta texts a 6-digit code to the SIM                        (nothing moves yet)
#   3. verify the code                                             (THE MOVE: provider stops here)
#   4. register the number for sending, with a new 6-digit PIN
#   5. tell production's bot to answer on the number's new id
#
# Before running: scripts/wa-connect-production.sh <our account id>, so the
# account's messages already go to production. Needs SUPABASE_ACCESS_TOKEN in
# .env.supabase. Prints no secret.
set -euo pipefail

WABA="28511562831799665"                   # Sehatsandhi Direct
CC="91"; NUMBER="7015399355"
REF="ctxkkqqtasegoowuqbmi"                 # production
GRAPH="https://graph.facebook.com/v25.0"
cd "$(dirname "$0")/.."
SB_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' .env.supabase | cut -d= -f2- | tr -d '"'"'"' \r')"

echo "This moves +$CC $NUMBER to the account we own. The current provider stops answering at stage 3."
echo "Have the SIM for the number in a phone that can receive an SMS."
echo
echo "Paste each value and press Enter. They are not shown."
read -r -s -p "Meta system user token (starts with EAA): " TOKEN; echo
read -r -s -p "Meta app secret: " SECRET; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d ' \r\n\t')"; SECRET="$(printf '%s' "$SECRET" | tr -d ' \r\n\t')"
PROOF="$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"
post() { curl -s -m 40 -X POST "$GRAPH/$1?appsecret_proof=$PROOF" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2"; }
get() { curl -s -m 30 -G "$GRAPH/$1" --data-urlencode "access_token=$TOKEN" --data-urlencode "appsecret_proof=$PROOF" "${@:2}"; }
why() { python3 -c "
import sys, json
try: e = json.load(sys.stdin).get('error', {})
except Exception: print('   (no readable answer from Meta)'); sys.exit()
for k in ('message', 'code', 'error_subcode', 'error_user_title', 'error_user_msg'):
    if e.get(k) is not None: print('   ' + k + ':', e[k])
if e.get('error_data'): print('   error_data:', json.dumps(e['error_data'], ensure_ascii=False))
"; }
field() { python3 -c "import sys,json
try: print(json.load(sys.stdin).get('$1','') or '')
except Exception: print('')"; }
ok() { printf '%s' "$1" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; }

# Already added on an earlier run? Then carry on from there.
NEW_ID="$(get "$WABA/phone_numbers" --data-urlencode "fields=id,display_phone_number" | python3 -c "
import sys, json, re
try:
    for n in json.load(sys.stdin).get('data', []):
        if re.sub(r'\D', '', n.get('display_phone_number', '')).endswith('$NUMBER'): print(n['id'])
except Exception: pass" | head -1)"

echo
if [ -n "$NEW_ID" ]; then
  echo "── 1. The number is already in our account from an earlier run (id $NEW_ID) ──"
else
  echo "── 1. Ask Meta to add the number to our account, as a migration ──"
  R="$(post "$WABA/phone_numbers" "{\"cc\":\"$CC\",\"phone_number\":\"$NUMBER\",\"migrate_phone_number\":true}")"
  NEW_ID="$(printf '%s' "$R" | field id)"
  if [ -z "$NEW_ID" ]; then echo "✗ Meta refused. Nothing has moved; the provider is still answering."; printf '%s' "$R" | why; exit 1; fi
  echo "   ✓ accepted. The number's id in our account will be $NEW_ID. Nothing has moved yet."
fi

echo
read -r -p "── 2. Send the 6-digit code to the SIM by SMS now? Type yes: " GO
[ "$GO" = "yes" ] || { echo "Stopped. Nothing has moved; the provider is still answering. Run this again when ready."; exit 0; }
R="$(post "$NEW_ID/request_code" '{"code_method":"SMS","language":"en"}')"
if ! ok "$R"; then echo "✗ Meta did not send the code. Nothing has moved; the provider is still answering."; printf '%s' "$R" | why; exit 1; fi
echo "   ✓ code sent to +$CC $NUMBER."

echo
echo "── 3. THE MOVE. Entering the code moves the number; the provider stops answering on it. ──"
read -r -p "   The 6-digit code from the SMS (or type stop): " CODE
CODE="$(printf '%s' "$CODE" | tr -cd '0-9')"
[ "${#CODE}" -eq 6 ] || { echo "Stopped. Nothing has moved; the provider is still answering."; exit 0; }
R="$(post "$NEW_ID/verify_code" "{\"code\":\"$CODE\"}")"
if ! ok "$R"; then echo "✗ Meta did not accept the code. Check whether the provider is still answering; run this again for a new code."; printf '%s' "$R" | why; exit 1; fi
echo "   ✓ verified. The number is now in our account."

echo
echo "── 4. Register it for sending ──"
read -r -s -p "   Choose a 6-digit PIN for this number, and write it down: " PIN; echo
PIN="$(printf '%s' "$PIN" | tr -cd '0-9')"
while [ "${#PIN}" -ne 6 ]; do read -r -s -p "   It must be exactly 6 digits: " PIN; echo; PIN="$(printf '%s' "$PIN" | tr -cd '0-9')"; done
R="$(post "$NEW_ID/register" "{\"messaging_product\":\"whatsapp\",\"pin\":\"$PIN\"}")"
if ! ok "$R"; then echo "✗ Registering was refused. The number has moved but cannot send yet. Send this output; do not run the script again until told."; printf '%s' "$R" | why; exit 1; fi
echo "   ✓ registered."

echo
echo "── 5. Production's bot answers on the number's new id ──"
BODY="$(python3 -c "import json,sys; print(json.dumps([{'name':'WA_BOT_PHONE_IDS','value':sys.argv[1]},{'name':'META_PHONE_NUMBER_ID','value':sys.argv[1]}]))" "$NEW_ID")"
C="$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "https://api.supabase.com/v1/projects/$REF/secrets" -H "Authorization: Bearer $SB_TOKEN" -H "Content-Type: application/json" -d "$BODY")"
case "$C" in 200|201) echo "   ✓ WA_BOT_PHONE_IDS and META_PHONE_NUMBER_ID set to $NEW_ID.";; *) echo "   ✗ Supabase refused (HTTP $C). Set WA_BOT_PHONE_IDS to $NEW_ID by hand in production's Edge Function secrets.";; esac

echo
echo "── The number now ──"
get "$NEW_ID" --data-urlencode "fields=display_phone_number,verified_name,status,name_status,platform_type,quality_rating,messaging_limit_tier" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  ', json.dumps(d, ensure_ascii=False)[:400])"
echo
echo "Wait a minute, then send \"Hi\" to +$CC $NUMBER. Our own menu should answer."
echo "Copy everything from '── 1.' down and send it. It contains no secret."
