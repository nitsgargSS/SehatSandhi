#!/usr/bin/env bash
# Stop OUR app receiving a WhatsApp account's messages — for the provider's old
# account, once the number is also linked to an account of our own: otherwise
# every message arrives twice (once through each) and the bot answers twice.
# The provider's own app is not touched. Prints no secret.
#
#   bash scripts/wa-unsubscribe.sh            the provider's account, 3997937100511018
#   bash scripts/wa-unsubscribe.sh <account id>
set -euo pipefail

WABA="${1:-3997937100511018}"
GRAPH="https://graph.facebook.com/v25.0"

echo "Paste each value and press Enter. Nothing you paste is shown."
read -r -s -p "1/2  Meta system user token (starts with EAA): " TOKEN; echo
read -r -s -p "2/2  Meta app secret: " SECRET; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d ' \r\n\t')"; SECRET="$(printf '%s' "$SECRET" | tr -d ' \r\n\t')"
PROOF="$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"
apps() { curl -s -m 30 -G "$GRAPH/$WABA/subscribed_apps" --data-urlencode "access_token=$TOKEN" --data-urlencode "appsecret_proof=$PROOF" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d: print('   Meta says:', d['error'].get('message')); sys.exit()
names = [a.get('whatsapp_business_api_data', {}).get('name', '?') for a in d.get('data', [])]
print('   ' + (', '.join(names) if names else 'none'))"; }

echo; echo "Apps receiving account $WABA's messages now:"; apps
R="$(curl -s -m 30 -X DELETE "$GRAPH/$WABA/subscribed_apps" --data-urlencode "access_token=$TOKEN" --data-urlencode "appsecret_proof=$PROOF")"
if printf '%s' "$R" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then echo "✓ Our app no longer receives account $WABA's messages."
else echo "✗ Meta refused:"; printf '%s\n' "$R" | python3 -c "import sys,json
try: print('  ', json.load(sys.stdin)['error']['message'])
except Exception: print('   (no readable answer)')"; fi
echo "Apps receiving it after:"; apps
