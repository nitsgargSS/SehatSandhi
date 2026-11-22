#!/usr/bin/env zsh
# razorpay-test-mode — put Razorpay TEST keys on the SANDBOX project only.
#
# Run it yourself in a normal terminal (not through Claude), from the repo root:
#   zsh scripts/razorpay-test-mode.sh                 keys + new webhook secret
#   zsh scripts/razorpay-test-mode.sh --webhook-only  only a new webhook secret
#
# It asks for the test Key ID and Key Secret (the secret is not shown as you
# type), makes a new random webhook secret, sets all three as sandbox Edge
# Function secrets, and copies the webhook secret to your clipboard so you can
# paste it into Razorpay → Test Mode → Webhooks. Nothing is printed or saved.
# Production is never touched: the project ref is fixed to sandbox, and it
# refuses live keys.

set -euo pipefail
SANDBOX_REF=xmsycnlztqmyvtcyxkmg
cd "$(dirname "$0")/.."
set -a; . ./.env.supabase; set +a

# --webhook-only: just make a new webhook secret (keys unchanged), e.g. when the
# clipboard copy was lost. Paste it into the existing Razorpay test webhook.
if [[ "${1:-}" == --webhook-only ]]; then
  WS=$(openssl rand -hex 24)
  npx -y supabase@latest secrets set --project-ref "$SANDBOX_REF" --yes RAZORPAY_WEBHOOK_SECRET="$WS" >/dev/null
  printf %s "$WS" | pbcopy
  unset WS
  echo "New sandbox webhook secret is on your clipboard. Razorpay (Test Mode) → Settings → Webhooks → edit the"
  echo "https://$SANDBOX_REF.supabase.co/functions/v1/razorpay-webhook webhook → Secret → paste (Cmd+V) → Save."
  exit 0
fi

read "KID?Razorpay TEST Key ID (rzp_test_…): "
[[ "$KID" == rzp_test_* ]] || { echo "That is not a test Key ID (it must start with rzp_test_). Nothing changed."; exit 1; }
read -s "KSEC?Razorpay TEST Key Secret: "; echo
[[ -n "$KSEC" ]] || { echo "No secret entered. Nothing changed."; exit 1; }

# Check the pair with Razorpay before saving it (lists one order; creates nothing).
code=$(curl -s -o /dev/null -w '%{http_code}' -u "$KID:$KSEC" 'https://api.razorpay.com/v1/orders?count=1')
[[ "$code" == 200 ]] || { echo "Razorpay did not accept that key pair (HTTP $code). Nothing changed."; exit 1; }

WS=$(openssl rand -hex 24)
npx -y supabase@latest secrets set --project-ref "$SANDBOX_REF" --yes \
  RAZORPAY_KEY_ID="$KID" RAZORPAY_KEY_SECRET="$KSEC" RAZORPAY_WEBHOOK_SECRET="$WS" >/dev/null
printf %s "$WS" | pbcopy
unset KSEC WS

cat <<MSG
Done: sandbox now uses Razorpay TEST keys.
The new webhook secret is on your clipboard. In Razorpay (Test Mode) → Settings → Webhooks → Add New Webhook:
  URL     https://$SANDBOX_REF.supabase.co/functions/v1/razorpay-webhook
  Secret  paste (Cmd+V)
  Events  payment.captured, refund.processed
MSG
