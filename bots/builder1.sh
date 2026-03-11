#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps — Builder Bot 1 (Networking & Developer Tools)
# Builds networking tools one at a time, never duplicating,
# placing completed scripts in ~/Documents/CoreOps-Factory/networking/
# =============================================================
set -uo pipefail

BOT_NAME="builder1"
BOTS_HOME="${BOTS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
export BOTS_HOME BOT_NAME

source "$BOTS_HOME/lib/bot-common.sh"
source "$BOTS_HOME/lib/registry.sh"
source "$BOTS_HOME/lib/catalog.sh"
source "$BOTS_HOME/tools/networking.sh"

BUILD_INTERVAL=45   # seconds between builds (polite pacing)
IDLE_INTERVAL=300   # seconds to sleep when all tools are built

bot_trap_exit
bot_init_dirs
bot_write_pid

bot_log_info "Builder Bot 1 online (PID $$)"
bot_log_info "Factory dir: ${FACTORY_DIR}/networking"

# ── Main loop ─────────────────────────────────────────────────
while true; do
  # Check supervisor signals first
  bot_check_signal

  # Check resource limits
  if ! bot_resource_ok; then
    bot_log_warn "High CPU detected — throttling for 30s"
    sleep 30
    continue
  fi

  # Pick the next unbuilt networking tool
  next_tool="$(net_tool_next_unbuilt)"

  if [ -z "$next_tool" ]; then
    bot_log_ok "All networking tools are built. Resting for ${IDLE_INTERVAL}s."
    sleep "$IDLE_INTERVAL"
    continue
  fi

  bot_log_info "Building: ${next_tool}"

  # Build it
  if outpath="$(net_build_tool "$next_tool")"; then
    bot_log_ok "Built → ${outpath}"
  else
    bot_log_error "Failed to build: ${next_tool}"
  fi

  # Paced delay between builds
  bot_log_info "Next build in ${BUILD_INTERVAL}s..."
  sleep "$BUILD_INTERVAL"
done
