#!/bin/bash
# Health check for storage.kawamonn.com: verifies the site responds and that
# the backend/frontend pm2 processes are genuinely alive (not zombies).
# On failure: restart the broken pm2 app once, re-check, and email only if
# it's still broken after that (at most once per hour while down).

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$SCRIPT_DIR/state"
LAST_ALERT_FILE="$STATE_DIR/last_alert"
ALERT_COOLDOWN_SECONDS=3600
URL="https://storage.kawamonn.com"
# Any guarded endpoint works: 401 without a token proves Nest is up and routing.
# A crash-looping backend (pm2 briefly says "online", then dies) fails this.
API_URL="${API_URL:-http://localhost:3000/api/v1/users/me}"
NODE_BIN="$(command -v node)"

mkdir -p "$STATE_DIR"

LOG_FILE="$SCRIPT_DIR/healthcheck.log"
if [[ -f "$LOG_FILE" ]] && [[ $(wc -l < "$LOG_FILE") -gt 20000 ]]; then
  tail -n 5000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

is_app_alive() {
  local app="$1"
  pm2 jlist 2>/dev/null | "$NODE_BIN" -e "
    const apps = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const app = apps.find(a => a.name === '$app');
    process.exit(app && app.pid && app.pm2_env.status === 'online' ? 0 : 1);
  "
}

site_ok() {
  local code
  code=$(curl -s -o /dev/null -m 10 -w "%{http_code}" "$URL")
  [[ "$code" =~ ^2|^3 ]]
}

api_ok() {
  local code
  code=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$API_URL")
  [[ "$code" =~ ^[234] ]]
}

backend_healthy() {
  is_app_alive "kawamonn-backend" && api_ok
}

check_all() {
  site_ok && backend_healthy && is_app_alive "kawamonn-frontend"
}

send_alert() {
  local subject="$1"
  local body="$2"
  local now last
  now=$(date +%s)
  last=$(cat "$LAST_ALERT_FILE" 2>/dev/null || echo 0)
  if (( now - last < ALERT_COOLDOWN_SECONDS )); then
    log "Alert suppressed (cooldown active): $subject"
    return
  fi
  if "$NODE_BIN" "$SCRIPT_DIR/mailer.js" "$subject" "$body"; then
    echo "$now" > "$LAST_ALERT_FILE"
    log "Alert email sent: $subject"
  else
    log "Failed to send alert email"
  fi
}

# Recent error excerpts for the alert email, so the cause is visible without
# logging in. Long lines are cut and credentials in connection strings masked.
collect_diagnostics() {
  local app="$1" logfile="$HOME/.pm2/logs/$1-error.log"
  if [[ -f "$logfile" ]]; then
    local out
    out=$(tail -n 400 "$logfile" \
      | sed -E 's/\x1b\[[0-9;]*m//g' \
      | awk 'length($0) < 400' \
      | grep -E "Error|ERROR|FATAL|EACCES|ECONN|P1000|P1001|Authentication failed|Cannot find module" \
      | tail -n 6 | cut -c1-300 \
      | sed -E 's#(://[^:/@ ]+:)[^@ ]+@#\1****@#g')
    echo "${out:-(該当なし)}"
  else
    echo "(log file not found: $logfile)"
  fi
}

collect_db_diagnostics() {
  docker logs kawamonn_db --tail 300 2>&1 | grep -E "FATAL|PANIC" | tail -n 3 | cut -c1-300
}

if check_all; then
  log "OK"
  rm -f "$STATE_DIR/was_down"
  exit 0
fi

log "Health check FAILED — attempting recovery"
FAILED_APPS=""
backend_healthy || FAILED_APPS="$FAILED_APPS kawamonn-backend"
is_app_alive "kawamonn-frontend" || FAILED_APPS="$FAILED_APPS kawamonn-frontend"

if [[ -n "$FAILED_APPS" ]]; then
  for app in $FAILED_APPS; do
    log "Restarting $app"
    pm2 restart "$app" >/dev/null 2>&1
  done
  # Nest needs ~10s to boot on the Pi; poll up to 40s so a slow start is not
  # reported as "still failing".
  for _ in 1 2 3 4 5 6 7 8; do
    sleep 5
    check_all && break
  done
fi

if check_all; then
  log "Recovered automatically after restart of:$FAILED_APPS"
  touch "$STATE_DIR/was_down"
  exit 0
fi

log "Still failing after recovery attempt — sending alert"
BODY="storage.kawamonn.com health check failed and did not recover after a pm2 restart.

Time: $(date '+%Y-%m-%d %H:%M:%S %Z')
Site check: $(site_ok && echo OK || echo FAIL) ($URL)
kawamonn-backend (pm2): $(is_app_alive kawamonn-backend && echo OK || echo DOWN)
kawamonn-backend (API, $API_URL): $(api_ok && echo OK || echo DOWN)
kawamonn-frontend: $(is_app_alive kawamonn-frontend && echo OK || echo DOWN)

Restart was attempted for:$FAILED_APPS

Recent kawamonn-backend errors (log末尾から抽出。古い行を含む場合あり):
$(collect_diagnostics kawamonn-backend)

Recent kawamonn-frontend errors:
$(collect_diagnostics kawamonn-frontend)

Recent kawamonn_db (Postgres) FATAL lines:
$(collect_db_diagnostics)

Check logs:
  pm2 logs kawamonn-backend --err --lines 50
  pm2 logs kawamonn-frontend --err --lines 50
  docker logs kawamonn_db --tail 50
"
send_alert "[ALERT] storage.kawamonn.com is DOWN" "$BODY"
touch "$STATE_DIR/was_down"
