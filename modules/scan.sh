#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
# shellcheck source=lib/log.sh
source "$COREOPS_HOME/lib/log.sh"

START_TIME=$(date +%s)
STATUS_SCORE=0

HOST="${1:-}"
if [ -z "$HOST" ]; then
  log_error "Usage: coreops scan <host>"
  exit 1
fi

echo
log_info "Target: $HOST"
echo -e "${C_GRAY}------------------------------------------------${C_RESET}"

# Ping (best-effort)
if ping -c 1 -W 2 "$HOST" >/dev/null 2>&1; then
  log_success "Ping: OK"
  ((STATUS_SCORE+=1))
else
  log_warn "Ping: FAIL (may still be reachable via TCP)"
fi

# Port 443 check
if [ -x "$COREOPS_HOME/modules/portscan.sh" ]; then
  if "$COREOPS_HOME/modules/portscan.sh" "$HOST" 443; then
    ((STATUS_SCORE+=1))
  fi
else
  log_warn "portscan module missing"
fi

# SSL check
if [ -x "$COREOPS_HOME/modules/sslcheck.sh" ]; then
  if "$COREOPS_HOME/modules/sslcheck.sh" "$HOST" 443; then
    ((STATUS_SCORE+=1))
  fi
else
  log_warn "sslcheck module missing"
fi

echo -e "${C_GRAY}------------------------------------------------${C_RESET}"

ELAPSED=$(( $(date +%s) - START_TIME ))

# Simple “flagship” score label
if [ "$STATUS_SCORE" -ge 3 ]; then
  log_success "Scan complete. Score: $STATUS_SCORE/3 • ${ELAPSED}s • Status: STRONG"
elif [ "$STATUS_SCORE" -eq 2 ]; then
  log_warn "Scan complete. Score: $STATUS_SCORE/3 • ${ELAPSED}s • Status: OK"
else
  log_warn "Scan complete. Score: $STATUS_SCORE/3 • ${ELAPSED}s • Status: WEAK"
fi
