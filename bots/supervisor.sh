#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps — Supervisor Bot (Admin)
# Keeps builder1, builder2, and watchdog in check.
# Monitors their health, enforces resource limits, processes
# inter-bot signals, and maintains the task queue.
# Dumb but reliable: simple rules, strong authority.
# =============================================================
set -uo pipefail

BOT_NAME="supervisor"
BOTS_HOME="${BOTS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
export BOTS_HOME BOT_NAME

source "$BOTS_HOME/lib/bot-common.sh"
source "$BOTS_HOME/lib/registry.sh"

HEALTH_INTERVAL=20    # seconds between health checks
MAX_BOT_RESTARTS=3    # max restarts before quarantine
QUARANTINE_TIME=120   # seconds a quarantined bot stays offline

# Per-bot restart tracking
declare -A bot_restarts=([builder1]=0 [builder2]=0 [watchdog]=0)
declare -A bot_quarantined=([builder1]=0 [builder2]=0 [watchdog]=0)
declare -A quarantine_until=([builder1]=0 [builder2]=0 [watchdog]=0)

MANAGED_BOTS=(builder1 builder2 watchdog)

bot_trap_exit
bot_init_dirs
bot_write_pid

bot_log_info "Supervisor online (PID $$) — admin mode active"
bot_log_info "Managing: ${MANAGED_BOTS[*]}"

# ── Start a managed bot ───────────────────────────────────────
_start_bot() {
  local name="$1"
  local script="${BOTS_HOME}/${name}.sh"
  [ -f "$script" ] || { bot_log_error "Missing bot script: $script"; return 1; }
  nohup bash "$script" >> "${LOGS_DIR}/${name}.log" 2>&1 &
  local pid=$!
  echo "$pid" > "${PIDS_DIR}/${name}.pid"
  bot_log_ok "Started ${name} (PID ${pid})"
}

# ── Stop a managed bot (SIGTERM) ──────────────────────────────
_stop_bot() {
  local name="$1"
  local pid
  pid="$(bot_read_pid "$name")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 2
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    bot_log_warn "Stopped ${name} (PID ${pid})"
  fi
  bot_clear_pid "$name"
}

# ── Check if a bot needs to be restarted ─────────────────────
_supervise_bot() {
  local name="$1"
  local now
  now=$(date +%s)

  # Check quarantine
  if [ "${bot_quarantined[$name]:-0}" -eq 1 ]; then
    if [ "$now" -lt "${quarantine_until[$name]:-0}" ]; then
      bot_log_stealth "${name} is quarantined. Skipping."
      return
    else
      bot_log_info "Quarantine lifted for ${name}. Resuming."
      bot_quarantined[$name]=0
      bot_restarts[$name]=0
    fi
  fi

  if bot_is_running "$name"; then
    # Bot is alive — check for resource abuse via ps
    local pid cpu
    pid="$(bot_read_pid "$name")"
    cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ' | cut -d. -f1 || echo 0)
    if [ "${cpu:-0}" -gt 90 ]; then
      bot_log_warn "${name} (PID ${pid}) CPU=${cpu}% — sending PAUSE"
      bot_send_signal "$name" "PAUSE"
      sleep 10
      bot_send_signal "$name" "RESUME"
    fi
    return 0
  fi

  # Bot is down
  if [ "${bot_restarts[$name]:-0}" -ge "$MAX_BOT_RESTARTS" ]; then
    bot_log_error "${name} crashed ${MAX_BOT_RESTARTS}+ times. Quarantining for ${QUARANTINE_TIME}s."
    bot_quarantined[$name]=1
    quarantine_until[$name]=$(( now + QUARANTINE_TIME ))
    bot_restarts[$name]=0
    return
  fi

  bot_log_warn "${name} is down. Restarting... (attempt $((${bot_restarts[$name]:-0}+1)))"
  bot_restarts[$name]=$(( ${bot_restarts[$name]:-0} + 1 ))
  _start_bot "$name"
}

# ── Process incoming signals from watchdog ───────────────────
_process_signals() {
  local sig
  sig="$(bot_read_signal "supervisor")"
  case "$sig" in
    BOT_DOWN:*)
      local bot="${sig#BOT_DOWN:}"
      bot_log_warn "Watchdog reports ${bot} is down."
      _supervise_bot "$bot"
      ;;
    "") return 0 ;;
    *) bot_log_info "Received signal: ${sig}" ;;
  esac
}

# ── Initial launch of all bots ────────────────────────────────
bot_log_info "Launching all managed bots..."
for bot in "${MANAGED_BOTS[@]}"; do
  if ! bot_is_running "$bot"; then
    _start_bot "$bot"
  else
    bot_log_info "${bot} already running (PID $(bot_read_pid "$bot"))"
  fi
  sleep 2
done

# ── Main supervisor loop ──────────────────────────────────────
while true; do
  _process_signals

  for bot in "${MANAGED_BOTS[@]}"; do
    _supervise_bot "$bot"
  done

  total_tools=$(registry_count 2>/dev/null || echo 0)
  bot_log_stealth "Status: tools_built=${total_tools} bots_ok=$(
    ok=0
    for b in "${MANAGED_BOTS[@]}"; do bot_is_running "$b" && ((ok++)) || true; done
    echo $ok
  )/${#MANAGED_BOTS[@]}"

  sleep "$HEALTH_INTERVAL"
done
