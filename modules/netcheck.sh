#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$BASE_DIR/lib/log.sh"

targets=("1.1.1.1" "8.8.8.8" "google.com")

log_info "NetCheck (ping 1 packet, 2s timeout)"
for t in "${targets[@]}"; do
  if ping -c 1 -W 2 "$t" >/dev/null 2>&1; then
    log_ok "Ping OK: $t"
  else
    log_warn "Ping FAIL: $t"
  fi
done
