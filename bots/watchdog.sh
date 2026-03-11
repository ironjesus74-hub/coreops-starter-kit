#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps — Watchdog Bot
# Stealth foreground/background health keeper.
# Silently monitors all other bots and restarts them if they
# crash. Monitors its own supervisor; restarts if needed.
# Writes only to log — no stdout noise unless run with -v.
# =============================================================
set -uo pipefail

BOT_NAME="watchdog"
BOTS_HOME="${BOTS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
export BOTS_HOME BOT_NAME

source "$BOTS_HOME/lib/bot-common.sh"

VERBOSE="${1:-}"   # pass -v for visible output

RESTART_DELAY=10    # seconds before restarting a crashed bot
CHECK_INTERVAL=30   # seconds between health sweeps
MAX_RESTARTS=5      # max restarts per bot before alerting supervisor
STABILITY_THRESHOLD=300  # seconds a bot must stay up before resetting restart counter

# ── Track restart counts and last-seen timestamps ─────────────
declare -A restart_count=([supervisor]=0 [builder1]=0 [builder2]=0)
declare -A last_seen_up=([supervisor]=0 [builder1]=0 [builder2]=0)

bot_trap_exit
bot_init_dirs
bot_write_pid

_log() {
  bot_log_stealth "$1"
  [ -n "$VERBOSE" ] && echo -e "${C_GRAY}[watchdog]${C_RESET} $1"
}

_log "Watchdog started (PID $$, interval=${CHECK_INTERVAL}s)"

# ── Launch a bot if not running ───────────────────────────────
_ensure_bot() {
  local name="$1"
  local script="$BOTS_HOME/${name}.sh"

  if bot_is_running "$name"; then
    return 0   # healthy
  fi

  _log "⚠ ${name} is NOT running."

  if [ "${restart_count[$name]:-0}" -ge "$MAX_RESTARTS" ]; then
    _log "✖ ${name} has crashed ${MAX_RESTARTS}+ times. Notifying supervisor."
    bot_send_signal "supervisor" "BOT_DOWN:${name}"
    return 1
  fi

  [ -f "$script" ] || { _log "✖ Script missing: $script"; return 1; }

  _log "↺ Restarting ${name}..."
  sleep "$RESTART_DELAY"
  nohup bash "$script" >> "${LOGS_DIR}/${name}.log" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "${PIDS_DIR}/${name}.pid"
  restart_count[$name]=$(( ${restart_count[$name]:-0} + 1 ))
  last_seen_up[$name]=0  # reset stability timer on restart
  _log "✔ ${name} restarted (PID ${new_pid}, restart #${restart_count[$name]})"
}

# ── Health metrics ────────────────────────────────────────────
_collect_metrics() {
  local metrics=""
  for bot in supervisor builder1 builder2; do
    local pid status
    pid="$(bot_read_pid "$bot")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      status="UP:${pid}"
    else
      status="DOWN"
    fi
    metrics="${metrics}${bot}=${status} "
  done
  _log "Health: ${metrics}"
}

# ── Main loop ─────────────────────────────────────────────────
while true; do
  # Handle our own signals
  bot_check_signal

  _collect_metrics

  # Ensure all bots are alive
  for bot in supervisor builder1 builder2; do
    _ensure_bot "$bot" || true
  done

  # Reset restart counters only after a bot has been stable for STABILITY_THRESHOLD seconds.
  # This prevents rapid crash-restart cycles from slipping under the MAX_RESTARTS limit.
  now=$(date +%s)
  for bot in supervisor builder1 builder2; do
    if bot_is_running "$bot"; then
      if [ "${last_seen_up[$bot]:-0}" -eq 0 ]; then
        last_seen_up[$bot]=$now
      elif [ $(( now - last_seen_up[$bot] )) -ge "$STABILITY_THRESHOLD" ]; then
        if [ "${restart_count[$bot]:-0}" -gt 0 ]; then
          _log "${bot} stable for ${STABILITY_THRESHOLD}s — resetting restart counter"
          restart_count[$bot]=0
        fi
        last_seen_up[$bot]=$now
      fi
    else
      last_seen_up[$bot]=0
    fi
  done

  sleep "$CHECK_INTERVAL"
done
