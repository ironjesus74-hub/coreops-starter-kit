#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$BASE_DIR/lib/log.sh"

host="${1:-}"
port="${2:-443}"

if [ -z "$host" ]; then
  log_error "Usage: coreops sslcheck <host> [port]"
  exit 1
fi

tmp="$(mktemp)"
# Fetch cert chain; take leaf cert
if ! echo | openssl s_client -servername "$host" -connect "$host:$port" 2>/dev/null \
  | openssl x509 -noout -enddate -issuer -subject >"$tmp" 2>/dev/null; then
  log_error "Could not fetch certificate for $host:$port"
  rm -f "$tmp"
  exit 1
fi

enddate="$(grep -i '^notAfter=' "$tmp" | sed 's/notAfter=//')"
issuer="$(grep -i '^issuer=' "$tmp" | sed 's/issuer=//')"
subject="$(grep -i '^subject=' "$tmp" | sed 's/subject=//')"

log_ok "SSL OK: $host:$port"
log_info "notAfter: $enddate"
log_info "issuer:  $issuer"
log_info "subject: $subject"
rm -f "$tmp"
