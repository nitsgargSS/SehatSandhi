#!/usr/bin/env bash
# Ask Meta what a token and the app may do for a WhatsApp number — when a send
# is refused with "Application does not have permission for this action (10)".
# Reads only; changes nothing. Prints no secret.
#
#   bash scripts/wa-check-sending.sh                      the main number's account
#   bash scripts/wa-check-sending.sh <account id> <phone number id>
set -euo pipefail

APP_ID="2239815556798206"                  # Sehatsandhi Bot
WABA="${1:-3997937100511018}"              # the account holding +91 70153 99355
PHONE_ID="${2:-1302831736238429}"
GRAPH="https://graph.facebook.com/v25.0"

echo "Paste each value and press Enter. Nothing you paste is shown."
read -r -s -p "1/2  Meta system user token (starts with EAA): " TOKEN; echo
read -r -s -p "2/2  Meta app secret: " SECRET; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d ' \r\n\t')"; SECRET="$(printf '%s' "$SECRET" | tr -d ' \r\n\t')"
PROOF="$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"
get() { curl -s -m 30 -G "$GRAPH/$1" --data-urlencode "access_token=$TOKEN" --data-urlencode "appsecret_proof=$PROOF" "${@:2}"; }

echo; echo "── The token ──"
curl -s -m 30 -G "$GRAPH/debug_token" --data-urlencode "input_token=$TOKEN" --data-urlencode "access_token=$APP_ID|$SECRET" | python3 -c "
import sys, json, datetime
d = json.load(sys.stdin)
if 'error' in d: print('  Meta says:', d['error'].get('message')); sys.exit()
d = d.get('data', {})
print('  valid:', d.get('is_valid'), '| type:', d.get('type'), '| for app:', d.get('application'), '(' + str(d.get('app_id')) + ')')
e = d.get('expires_at'); print('  expires:', 'never' if not e else datetime.datetime.fromtimestamp(e).strftime('%d %b %Y'))
s = d.get('scopes', [])
print('  permissions:', ', '.join(s) or 'none')
for need in ('whatsapp_business_messaging', 'whatsapp_business_management'):
    print('   ', '✓' if need in s else '✗ MISSING', need)
for g in d.get('granular_scopes', []):
    t = g.get('target_ids')
    print('   ', g.get('scope'), '→', 'every account' if not t else 'only accounts ' + ', '.join(t), ('' if not t or '$WABA' in t else '  ✗ NOT this account'))
"

echo; echo "── What Meta says about sending from this number ──"
get "$PHONE_ID" --data-urlencode "fields=display_phone_number,verified_name,status,name_status,platform_type,account_mode,health_status" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d: print('  Meta says:', d['error'].get('message'), '(' + str(d['error'].get('code')) + ')'); sys.exit()
print('  ', d.get('display_phone_number'), '|', d.get('verified_name'), '| status:', d.get('status'), '| name:', d.get('name_status'), '| platform:', d.get('platform_type'), '| mode:', d.get('account_mode'))
h = d.get('health_status', {})
print('   can send overall:', h.get('can_send_message'))
for e in h.get('entities', []):
    print('    ', e.get('entity_type'), e.get('id'), '→', e.get('can_send_message'))
    for x in e.get('errors', []) or []:
        print('        ', x.get('error_code'), x.get('error_description'), '|', x.get('possible_solution', ''))
    for k in ('additional_info',):
        for x in e.get(k, []) or []: print('         note:', x)
"

echo; echo "── Numbers in account $WABA ──"
get "$WABA/phone_numbers" --data-urlencode "fields=id,display_phone_number,verified_name,status,name_status,platform_type,account_mode" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d: print('  Meta says:', d['error'].get('message'), '(' + str(d['error'].get('code')) + ')'); sys.exit()
if not d.get('data'): print('  none')
for n in d.get('data', []):
    print('  ', n.get('display_phone_number'), '|', n.get('verified_name'), '| phone number ID:', n.get('id'), '| status:', n.get('status'), '| name:', n.get('name_status'), '| platform:', n.get('platform_type'), '| mode:', n.get('account_mode'))
"

echo; echo "── Apps subscribed to this account ──"
get "$WABA/subscribed_apps" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d: print('  Meta says:', d['error'].get('message')); sys.exit()
for a in d.get('data', []):
    w = a.get('whatsapp_business_api_data', {})
    print('  ', w.get('name'), '(' + str(w.get('id')) + ')', '| has its own address:', bool(a.get('override_callback_uri')))
"
echo; echo "Copy everything from '── The token ──' down and send it. It contains no secret."
