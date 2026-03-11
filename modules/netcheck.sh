#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$BASE_DIR/lib/log.sh"

targets=("1.1.1.1" "8.8.8.8" "google.com")

log_info "NetCheck (ping 1 packet, 2s timeout)"
_nc_tmpdir="$(mktemp -d)"
trap 'rm -rf "$_nc_tmpdir"' EXIT INT TERM
for i in "${!targets[@]}"; do
  t="${targets[$i]}"
  (
    if ping -c 1 -W 2 "$t" >/dev/null 2>&1; then
      log_ok "Ping OK: $t"
    else
      log_warn "Ping FAIL: $t"
    fi
  ) > "$_nc_tmpdir/$i" &
done
wait
for i in "${!targets[@]}"; do
  cat "$_nc_tmpdir/$i"
done
rm -rf "$_nc_tmpdir"
