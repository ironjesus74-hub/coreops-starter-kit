#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$BASE_DIR/lib/log.sh"

host="${1:-}"
port="${2:-}"

if [ -z "$host" ] || [ -z "$port" ]; then
  log_error "Usage: coreops portscan <host> <port>"
  exit 1
fi

# bash /dev/tcp trick
timeout_sec=3
if (echo >/dev/tcp/"$host"/"$port") >/dev/null 2>&1; then
  log_ok "OPEN: $host:$port"
else
  log_warn "CLOSED/FAIL: $host:$port"
fi
