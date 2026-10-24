#!/bin/sh
# Button-pressing tests on the simulator (D-182). Run before every TestFlight build:
#   sh scripts/ui-test.sh            all flows
#   sh scripts/ui-test.sh 02         flows whose file name starts with 02
# Needs: Maestro + Java 17 (Homebrew), the RapidRecall Dev app on the "iPhone 18 Pro Max"
# simulator (never the PersonalMax ones), and maestro/.env.maestro with the test account
# (MAESTRO_EMAIL with +clerk_test, MAESTRO_PASSWORD). Screenshots: maestro/screens/<time>/.
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1

[ -f maestro/.env.maestro ] || { echo "Missing maestro/.env.maestro (test account)."; exit 1; }
# Read the values literally (a password's symbols must not be touched by the shell).
MAESTRO_EMAIL=$(sed -n 's/^MAESTRO_EMAIL=//p' maestro/.env.maestro)
MAESTRO_PASSWORD=$(sed -n 's/^MAESTRO_PASSWORD=//p' maestro/.env.maestro)
[ -n "$MAESTRO_PASSWORD" ] || { echo "MAESTRO_PASSWORD is empty in maestro/.env.maestro."; exit 1; }
case "$MAESTRO_EMAIL" in *+clerk_test*) ;; *) echo "MAESTRO_EMAIL must contain +clerk_test."; exit 1;; esac

DEVICE=$(xcrun simctl list devices available | grep "iPhone 18 Pro Max (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$DEVICE" ] || { echo "No iPhone 18 Pro Max simulator."; exit 1; }
xcrun simctl boot "$DEVICE" 2>/dev/null || true

# Metro on this Mac (all addresses, so the simulator's 127.0.0.1 reaches it).
if ! curl -s -m 2 http://127.0.0.1:8081/status | grep -q running; then
  APP_VARIANT=development CI=1 npx expo start --dev-client --port 8081 --lan > /tmp/rapidrecall-ui-metro.log 2>&1 &
  until curl -s -m 2 http://127.0.0.1:8081/status | grep -q running; do sleep 2; done
fi

OUT="maestro/screens/$(date +%Y-%m-%d_%H-%M-%S)"
mkdir -p "$OUT"
if [ -n "$1" ]; then FLOWS=$(ls maestro/"$1"*.yaml); else FLOWS=maestro; fi
maestro --device "$DEVICE" test $FLOWS \
  -e MAESTRO_EMAIL="$MAESTRO_EMAIL" -e MAESTRO_PASSWORD="$MAESTRO_PASSWORD" \
  --test-output-dir "$OUT" --format junit --output "$OUT/report.xml"
echo "Screenshots: $OUT"
