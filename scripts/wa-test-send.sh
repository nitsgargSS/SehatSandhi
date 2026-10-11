#!/usr/bin/env bash
# Send one plain message from a WhatsApp number to your own phone, and print
# Meta's whole answer — to see exactly why a send is refused. The phone must
# have written to the number in the last 24 hours. Prints no secret.
#
#   bash scripts/wa-test-send.sh
set -euo pipefail

PHONE_ID="${1:-1302831736238429}"          # +91 70153 99355
GRAPH="https://graph.facebook.com/v25.0"

echo "Paste each value and press Enter. The first two are not shown."
read -r -s -p "1/3  Meta system user token (starts with EAA): " TOKEN; echo
read -r -s -p "2/3  Meta app secret: " SECRET; echo
read -r    -p "3/3  Your own WhatsApp number, 10 digits: " TO
TOKEN="$(printf '%s' "$TOKEN" | tr -d ' \r\n\t')"; SECRET="$(printf '%s' "$SECRET" | tr -d ' \r\n\t')"
TO="91$(printf '%s' "$TO" | tr -cd '0-9' | tail -c 10)"
PROOF="$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"
show() { python3 -c "
import sys, json
raw = sys.stdin.read()
try: d = json.loads(raw)
except Exception: print('   (not JSON)', raw[:300]); sys.exit()
if 'error' in d:
    e = d['error']
    for k in ('message', 'type', 'code', 'error_subcode', 'error_user_title', 'error_user_msg'):
        if e.get(k) is not None: print('   ' + k + ':', e[k])
    if e.get('error_data'): print('   error_data:', json.dumps(e['error_data'], ensure_ascii=False))
else:
    print('   ✓ accepted:', json.dumps({k: v for k, v in d.items() if k != 'contacts'}, ensure_ascii=False)[:300])
"; }
BODY="{\"messaging_product\":\"whatsapp\",\"to\":\"$TO\",\"type\":\"text\",\"text\":{\"body\":\"Sehatsandhi test message — please ignore.\"}}"

echo; echo "── A: as the production system sends (token only) ──"
curl -s -m 30 -X POST "$GRAPH/$PHONE_ID/messages" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY" | show

echo; echo "── B: the same, with the app-secret proof ──"
curl -s -m 30 -X POST "$GRAPH/$PHONE_ID/messages?appsecret_proof=$PROOF" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY" | show

echo; echo "── The account: who owns it, who it is shared with, who pays ──"
WABA="$(curl -s -m 30 -G "$GRAPH/$PHONE_ID" --data-urlencode "access_token=$TOKEN" --data-urlencode "appsecret_proof=$PROOF" --data-urlencode "fields=whatsapp_business_account" | python3 -c "import sys,json; print(json.load(sys.stdin).get('whatsapp_business_account',{}).get('id',''))" 2>/dev/null || true)"
WABA="${WABA:-3997937100511018}"
curl -s -m 30 -G "$GRAPH/$WABA" --data-urlencode "access_token=$TOKEN" --data-urlencode "appsecret_proof=$PROOF" \
  --data-urlencode "fields=name,ownership_type,owner_business_info,on_behalf_of_business_info,primary_funding_id,account_review_status,business_verification_status" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d: print('   Meta says:', d['error'].get('message')); sys.exit()
for k in ('name', 'ownership_type', 'owner_business_info', 'on_behalf_of_business_info', 'primary_funding_id', 'account_review_status', 'business_verification_status'):
    if k in d: print('   ' + k + ':', json.dumps(d[k], ensure_ascii=False) if isinstance(d[k], dict) else d[k])
"
echo; echo "Copy everything from '── A' down and send it. It contains no secret."
