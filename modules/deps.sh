#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$BASE_DIR/lib/log.sh"
source "$BASE_DIR/lib/common.sh"

log_info "Checking dependencies..."
missing=0

for c in bash date uname grep sed awk curl ping openssl; do
  if have "$c"; then
    log_ok "OK: $c"
  else
    log_error "Missing: $c"
    missing=1
  fi
done

if [ "$missing" -eq 0 ]; then
  log_ok "All core dependencies look good."
else
  log_warn "Some deps are missing. In Termux: pkg install <name>"
fi
