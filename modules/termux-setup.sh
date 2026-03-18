#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps Module — termux-setup
# Runs the Termux/Debian environment optimizer.
# Usage: coreops termux-setup [--debian] [--minimal] [--dev]
# =============================================================
set -uo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$BASE_DIR/lib/log.sh" 2>/dev/null || true
source "$BASE_DIR/lib/common.sh" 2>/dev/null || true

SETUP_SCRIPT="${BASE_DIR}/scripts/termux-setup.sh"

if [ ! -f "$SETUP_SCRIPT" ]; then
  log_error "Setup script not found: $SETUP_SCRIPT"
  exit 1
fi

exec bash "$SETUP_SCRIPT" "$@"
