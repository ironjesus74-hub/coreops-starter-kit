#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$BASE_DIR/lib/log.sh"

ts="$(date +%Y%m%d_%H%M%S)"
out="snapshot_${ts}.txt"

{
  echo "CoreOps Snapshot | $(date)"
  echo "-----------------------------"
  echo
  echo "[SYSTEM]"
  uname -a 2>/dev/null || true
  echo
  echo "[STORAGE]"
  df -h 2>/dev/null || true
  echo
  echo "[NETWORK]"
  ip a 2>/dev/null || true
  echo
  echo "[DNS]"
  getprop 2>/dev/null | grep -i dns || true
  echo
  echo "[PING]"
  ping -c 1 -W 2 1.1.1.1 2>/dev/null && echo "Ping 1.1.1.1: OK" || echo "Ping 1.1.1.1: FAIL"
  ping -c 1 -W 2 google.com 2>/dev/null && echo "Ping google.com: OK" || echo "Ping google.com: FAIL"
} > "$out"

log_ok "Saved: $out"
