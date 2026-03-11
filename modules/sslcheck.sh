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

# Fetch cert chain; take leaf cert — captured directly into a variable
cert_info=""
if ! cert_info="$(echo | openssl s_client -servername "$host" -connect "$host:$port" 2>/dev/null \
  | openssl x509 -noout -enddate -issuer -subject 2>/dev/null)"; then
  log_error "Could not fetch certificate for $host:$port"
  exit 1
fi

enddate="$(printf '%s\n' "$cert_info" | grep -i '^notAfter=' | sed 's/notAfter=//')"
issuer="$(printf '%s\n' "$cert_info" | grep -i '^issuer=' | sed 's/issuer=//')"
subject="$(printf '%s\n' "$cert_info" | grep -i '^subject=' | sed 's/subject=//')"

log_ok "SSL OK: $host:$port"
log_info "notAfter: $enddate"
log_info "issuer:  $issuer"
log_info "subject: $subject"
