#!/usr/bin/env bash
# Point one WhatsApp account's messages at PRODUCTION's whatsapp-inbound, and
# save the three secrets that function needs — without anyone copying a secret
# by hand, and without printing one.
#
#   bash scripts/wa-connect-production.sh                      the provider's account holding the main number
#   bash scripts/wa-connect-production.sh <account id> [<account id> …]
#
# Every account named gets the same new address, in one run. Each run makes a
# new inbound secret, so an account left out of a run stops reaching
# production until it is included again.
#
# It asks (typing hidden) for the Meta system user token and the app secret,
# checks both against Meta, makes a fresh WA_INBOUND_SECRET, saves all three as
# production Edge Function secrets, waits until the function answers Meta's
# handshake with the new secret, and then sets the account's
# override_callback_uri. The bot does not start answering: that is
# WA_BOT_PHONE_IDS, set separately (docs/whatsapp-rollout.md, Step 7).
#
# Needs SUPABASE_ACCESS_TOKEN in .env.supabase. Safe to run again: each run
# makes a new inbound secret and points Meta at it.
set -euo pipefail

REF="ctxkkqqtasegoowuqbmi"                 # production
[ "$#" -gt 0 ] || set -- 3997937100511018  # the provider's account holding +91 70153 99355
WABA="$1"                                  # the token and app secret are checked against the first
GRAPH="https://graph.facebook.com/v25.0"
FN="https://$REF.supabase.co/functions/v1/whatsapp-inbound"
cd "$(dirname "$0")/.."

SB_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' .env.supabase | cut -d= -f2- | tr -d '"'"'"' \r')"
[ -n "$SB_TOKEN" ] || { echo "SUPABASE_ACCESS_TOKEN is not in .env.supabase"; exit 1; }

echo "Paste each value and press Enter. Nothing you paste is shown."
read -r -s -p "1/2  Meta system user token (starts with EAA): " META_TOKEN; echo
read -r -s -p "2/2  Meta app secret (App settings > Basic > Show): " APP_SECRET; echo
META_TOKEN="$(printf '%s' "$META_TOKEN" | tr -d ' \r\n\t')"
APP_SECRET="$(printf '%s' "$APP_SECRET" | tr -d ' \r\n\t')"
case "$META_TOKEN" in EAA*) ;; *) echo "✗ That does not look like a Meta token (it should start with EAA). Nothing was changed."; exit 1;; esac
[ "${#APP_SECRET}" -ge 20 ] || { echo "✗ That app secret is too short. Nothing was changed."; exit 1; }

# The token and the app secret, checked together: Meta refuses a proof made with the wrong secret.
PROOF="$(printf '%s' "$META_TOKEN" | openssl dgst -sha256 -hmac "$APP_SECRET" | awk '{print $NF}')"
NUMBERS="$(curl -s -m 30 -G "$GRAPH/$WABA/phone_numbers" --data-urlencode "access_token=$META_TOKEN" --data-urlencode "appsecret_proof=$PROOF" --data-urlencode "fields=display_phone_number")"
if ! printf '%s' "$NUMBERS" | grep -q '"display_phone_number"'; then
  echo "✗ Meta did not accept the token with that app secret. Nothing was changed."
  printf '%s\n' "$NUMBERS" | python3 -c "import sys,json
try: print('  Meta says:', json.load(sys.stdin)['error']['message'])
except Exception: print('  (no readable answer from Meta)')"
  exit 1
fi
echo "✓ Meta accepts the token and the app secret. Numbers in this account: $(printf '%s' "$NUMBERS" | python3 -c "import sys,json; print(', '.join(n['display_phone_number'] for n in json.load(sys.stdin)['data']))")"

INBOUND="$(openssl rand -hex 24)"
BODY="$(python3 -c "import json,sys; print(json.dumps([{'name':'META_ACCESS_TOKEN','value':sys.argv[1]},{'name':'META_APP_SECRET','value':sys.argv[2]},{'name':'WA_INBOUND_SECRET','value':sys.argv[3]}]))" "$META_TOKEN" "$APP_SECRET" "$INBOUND")"
CODE="$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "https://api.supabase.com/v1/projects/$REF/secrets" -H "Authorization: Bearer $SB_TOKEN" -H "Content-Type: application/json" -d "$BODY")"
case "$CODE" in 200|201) echo "✓ Saved META_ACCESS_TOKEN, META_APP_SECRET and a new WA_INBOUND_SECRET in production.";; *) echo "✗ Supabase refused the secrets (HTTP $CODE). Nothing was changed at Meta."; exit 1;; esac

# The function picks new secrets up within a few seconds; wait until it answers the handshake with the new one.
printf "  Waiting for production to pick them up"
OK=""
for _ in $(seq 1 30); do
  GOT="$(curl -s -m 15 -G "$FN" --data-urlencode "hub.mode=subscribe" --data-urlencode "hub.verify_token=$INBOUND" --data-urlencode "hub.challenge=ready")" || true
  [ "$GOT" = "ready" ] && { OK=1; break; }
  printf "."; sleep 3
done
echo
[ -n "$OK" ] || { echo "✗ Production did not answer with the new secret after 90 seconds. Meta was not changed; run this again."; exit 1; }

FAILED=""
for W in "$@"; do
  RES="$(curl -s -m 40 -X POST "$GRAPH/$W/subscribed_apps" --data-urlencode "access_token=$META_TOKEN" --data-urlencode "appsecret_proof=$PROOF" --data-urlencode "override_callback_uri=$FN?key=$INBOUND" --data-urlencode "verify_token=$INBOUND")"
  if printf '%s' "$RES" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
    echo "✓ Meta now sends account $W's messages to production."
  else
    FAILED=1
    echo "✗ Meta did not accept the address for account $W:"
    printf '%s\n' "$RES" | python3 -c "import sys,json
try: print('  ', json.load(sys.stdin)['error']['message'])
except Exception: print('   (no readable answer from Meta)')"
  fi
done
[ -z "$FAILED" ] || exit 1
echo
echo "Send \"Hi\" to the number, then check Edge Functions > whatsapp-inbound > Invocations: new POST rows should say 200."
