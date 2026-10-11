#!/usr/bin/env bash
# Prove that our app can SEND from the WhatsApp account we own outright
# ("Sehatsandhi Direct"), using its placeholder number — before the real number
# is moved there. It:
#   1. subscribes the app to the account (so its messages reach our webhook),
#   2. registers the placeholder number for the Cloud API with a 6-digit PIN,
#   3. sends one plain message to your own phone and prints Meta's answer.
# A send Meta ACCEPTS proves the permission, even if the message is not
# delivered (a plain message only arrives if you wrote to that number first).
# Prints no secret.
#
#   bash scripts/wa-try-direct.sh
set -euo pipefail

WABA="${1:-28511562831799665}"             # Sehatsandhi Direct
PHONE_ID="${2:-1386268004563984}"          # its placeholder, +1 555-370-5514
GRAPH="https://graph.facebook.com/v25.0"

echo "Paste each value and press Enter. The first three are not shown."
read -r -s -p "1/4  Meta system user token (starts with EAA): " TOKEN; echo
read -r -s -p "2/4  Meta app secret: " SECRET; echo
read -r -s -p "3/4  Choose a 6-digit PIN for this number, and write it down: " PIN; echo
read -r    -p "4/4  Your own WhatsApp number, 10 digits: " TO
TOKEN="$(printf '%s' "$TOKEN" | tr -d ' \r\n\t')"; SECRET="$(printf '%s' "$SECRET" | tr -d ' \r\n\t')"
PIN="$(printf '%s' "$PIN" | tr -cd '0-9')"; TO="91$(printf '%s' "$TO" | tr -cd '0-9' | tail -c 10)"
[ "${#PIN}" -eq 6 ] || { echo "✗ The PIN must be exactly 6 digits. Nothing was changed."; exit 1; }
PROOF="$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"
show() { python3 -c "
import sys, json
raw = sys.stdin.read()
try: d = json.loads(raw)
except Exception: print('   (not JSON)', raw[:300]); sys.exit()
if 'error' in d:
    e = d['error']
    for k in ('message', 'code', 'error_subcode', 'error_user_title', 'error_user_msg'):
        if e.get(k) is not None: print('   ' + k + ':', e[k])
    if e.get('error_data'): print('   error_data:', json.dumps(e['error_data'], ensure_ascii=False))
else:
    print('   ✓', json.dumps({k: v for k, v in d.items() if k != 'contacts'}, ensure_ascii=False)[:300])
"; }
post() { curl -s -m 40 -X POST "$GRAPH/$1?appsecret_proof=$PROOF" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2"; }

echo; echo "── 1. Subscribe the app to the account ──"
post "$WABA/subscribed_apps" '{}' | show

echo; echo "── 2. Register the placeholder number for sending ──"
post "$PHONE_ID/register" "{\"messaging_product\":\"whatsapp\",\"pin\":\"$PIN\"}" | show

echo; echo "── 3. Send one message from it ──"
post "$PHONE_ID/messages" "{\"messaging_product\":\"whatsapp\",\"to\":\"$TO\",\"type\":\"text\",\"text\":{\"body\":\"Sehatsandhi test from the new account — please ignore.\"}}" | show

echo; echo "── The number now ──"
curl -s -m 30 -G "$GRAPH/$PHONE_ID" --data-urlencode "access_token=$TOKEN" --data-urlencode "appsecret_proof=$PROOF" \
  --data-urlencode "fields=display_phone_number,verified_name,status,name_status,platform_type,account_mode" | show
echo; echo "Copy everything from '── 1.' down and send it. It contains no secret."
