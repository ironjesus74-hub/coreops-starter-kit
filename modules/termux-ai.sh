#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps Module — termux-ai
# Launches the AI wrapper from the coreops CLI.
# Usage: coreops termux-ai [--agent] [--fix] [--task "desc"]
# =============================================================
set -uo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$BASE_DIR/lib/log.sh" 2>/dev/null || true
source "$BASE_DIR/lib/common.sh" 2>/dev/null || true

WRAPPER="${BASE_DIR}/termux-ai-wrapper.sh"

if [ ! -f "$WRAPPER" ]; then
  log_error "AI wrapper not found: $WRAPPER"
  exit 1
fi

# Pass all args directly to the wrapper
export COREOPS_HOME="$BASE_DIR"
exec bash "$WRAPPER" "$@"
