#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$BASE_DIR/lib/log.sh"

log_info "CoreOps Doctor"
echo
log_info "System:"
uname -a || true
echo
log_info "Termux prefix:"
echo "${PREFIX:-"(unknown)"}"
echo
log_info "Storage:"
df -h 2>/dev/null || true
echo
log_info "Network:"
ip a 2>/dev/null || true
