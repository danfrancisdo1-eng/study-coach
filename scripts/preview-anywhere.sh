#!/bin/sh
# Phone preview from anywhere (not just home Wi-Fi): Metro for the RapidRecall development build,
# reachable at Dan's ngrok domain. Run after a Mac restart:  sh scripts/preview-anywhere.sh
# On the iPhone open "RapidRecall Dev" (the development build, not Expo Go or the TestFlight app) → Enter URL →
#   https://overfactiously-aedilitian-lettie.ngrok-free.dev
# Stops only this preview's ngrok and Metro; never the PersonalMax tunnel (another project).
DOMAIN=https://overfactiously-aedilitian-lettie.ngrok-free.dev
cd "$(dirname "$0")/../artifacts/study-coach-mobile" || exit 1
pkill -f "ngrok http --url=$DOMAIN" 2>/dev/null
pkill -f "expo start --dev-client --port 8081" 2>/dev/null
sleep 1
nohup /opt/homebrew/bin/ngrok http --url=$DOMAIN 8081 --log=stdout --log-level=warn > /tmp/rapidrecall-ngrok.log 2>&1 &
APP_VARIANT=development EXPO_PACKAGER_PROXY_URL=$DOMAIN nohup npx expo start --dev-client --port 8081 --clear > /tmp/rapidrecall-expo.log 2>&1 &
echo "Starting. In about a minute, check: curl -s $DOMAIN/status   (should print packager-status:running)"
