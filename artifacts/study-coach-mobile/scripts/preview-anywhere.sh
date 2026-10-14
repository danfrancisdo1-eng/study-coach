#!/bin/sh
# The Expo Go preview through Dan's own ngrok account, so the phone reaches it from anywhere
# (Expo's shared tunnel hit ngrok's 5000-session limit on 2026-10-13: ERR_NGROK_108).
# The address is Dan's free ngrok dev domain; it never changes, so the QR code is the same every day.
# Run from artifacts/study-coach-mobile:  sh scripts/preview-anywhere.sh        (Expo Go)
#                                         sh scripts/preview-anywhere.sh dev    (the RapidRecall development build, D-096)
DOMAIN="${NGROK_DOMAIN:-overfactiously-aedilitian-lettie.ngrok-free.dev}"
ngrok http --url="https://$DOMAIN" 8081 --log=stdout --log-level=warn > /tmp/rapidrecall-ngrok.log 2>&1 &
NGROK_PID=$!
trap 'kill $NGROK_PID 2>/dev/null' EXIT INT TERM
echo "Tunnel: https://$DOMAIN  (in Expo Go: Enter URL manually → exp://$DOMAIN)"
MODE_FLAG="--go"
[ "$1" = "dev" ] && MODE_FLAG="--dev-client"
EXPO_PACKAGER_PROXY_URL="https://$DOMAIN" npx expo start $MODE_FLAG --port 8081
