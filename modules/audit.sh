#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# shellcheck source=lib/log.sh
source "$COREOPS_HOME/lib/log.sh"

START_TIME=$(date +%s)
SCORE=0

HOST="${1:-}"
if [ -z "$HOST" ]; then
  log_error "Usage: coreops audit <host>"
  exit 1
fi

# DNS check availability (Termux may not have getent)
TOTAL=3
DNS_MODE=""
if command -v nslookup >/dev/null 2>&1; then
  TOTAL=4
  DNS_MODE="nslookup"
elif command -v getent >/dev/null 2>&1; then
  TOTAL=4
  DNS_MODE="getent"
fi

echo "========================================"
echo "        CoreOps Audit Report"
echo "========================================"
log_info "Host: $HOST"
echo

# 1) Ping (best-effort)
if ping -c 1 -W 2 "$HOST" >/dev/null 2>&1; then
  log_success "Ping: OK"
  ((SCORE+=1))
else
  log_warn "Ping: FAIL"
fi

# 2) Port 443 (uses portscan module)
if [ -x "$COREOPS_HOME/modules/portscan.sh" ]; then
  if "$COREOPS_HOME/modules/portscan.sh" "$HOST" 443 >/dev/null 2>&1; then
    log_success "Port 443: OPEN"
    ((SCORE+=1))
  else
    log_warn "Port 443: CLOSED"
  fi
else
  log_warn "Portscan module missing"
fi

# 3) TLS (uses sslcheck module)
if [ -x "$COREOPS_HOME/modules/sslcheck.sh" ]; then
  if "$COREOPS_HOME/modules/sslcheck.sh" "$HOST" 443 >/dev/null 2>&1; then
    log_success "TLS: VALID"
    ((SCORE+=1))
  else
    log_warn "TLS: INVALID"
  fi
else
  log_warn "SSL module missing"
fi

# 4) DNS (only if tool exists)
if [ "$DNS_MODE" = "nslookup" ]; then
  if nslookup "$HOST" >/dev/null 2>&1; then
    log_success "DNS: RESOLVED"
    ((SCORE+=1))
  else
    log_warn "DNS: FAILED"
  fi
elif [ "$DNS_MODE" = "getent" ]; then
  if getent hosts "$HOST" >/dev/null 2>&1; then
    log_success "DNS: RESOLVED"
    ((SCORE+=1))
  else
    log_warn "DNS: FAILED"
  fi
else
  log_warn "DNS: SKIPPED (install dnsutils for nslookup)"
fi

ELAPSED=$(( $(date +%s) - START_TIME ))

echo
echo "----------------------------------------"

PCT=$(( SCORE * 100 / TOTAL ))
if [ "$PCT" -ge 80 ]; then
  log_success "Score: $SCORE/$TOTAL • Status: STRONG"
elif [ "$PCT" -ge 50 ]; then
  log_warn "Score: $SCORE/$TOTAL • Status: MODERATE"
else
  log_warn "Score: $SCORE/$TOTAL • Status: WEAK"
fi

echo "Completed in ${ELAPSED}s"
echo "========================================"
