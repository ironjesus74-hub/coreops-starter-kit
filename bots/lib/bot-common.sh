#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps Bot Common Library
# Shared utilities for all bots: colors, logging, PID helpers,
# inter-bot signaling, and resource limits.
# =============================================================

# ── Theme (inherits from parent if already set) ───────────────
C_RESET="${C_RESET:-\033[0m}"
C_BOLD="${C_BOLD:-\033[1m}"
C_DIM="${C_DIM:-\033[2m}"
C_NEON="${C_NEON:-\033[38;5;46m}"
C_CYAN="${C_CYAN:-\033[38;5;51m}"
C_AMBER="${C_AMBER:-\033[38;5;214m}"
C_RED="${C_RED:-\033[38;5;196m}"
C_GRAY="${C_GRAY:-\033[38;5;245m}"
C_BLUE="${C_BLUE:-\033[38;5;33m}"
C_PURPLE="${C_PURPLE:-\033[38;5;141m}"

# ── Runtime paths ─────────────────────────────────────────────
BOTS_HOME="${BOTS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COREOPS_HOME="${COREOPS_HOME:-$(cd "$BOTS_HOME/.." && pwd)}"

# Output goes to ~/Documents/CoreOps-Factory (Termux & Linux)
# Respect pre-set FACTORY_DIR (e.g., for testing or custom installs)
if [ -z "${FACTORY_DIR:-}" ]; then
  if [ -d "${HOME}/storage/shared/Documents" ]; then
    FACTORY_DIR="${HOME}/storage/shared/Documents/CoreOps-Factory"
  else
    FACTORY_DIR="${HOME}/Documents/CoreOps-Factory"
  fi
fi
export FACTORY_DIR

LOGS_DIR="${FACTORY_DIR}/logs"
REGISTRY_FILE="${FACTORY_DIR}/registry.db"
CATALOG_FILE="${FACTORY_DIR}/catalog.json"
PIDS_DIR="${FACTORY_DIR}/.pids"
TASKS_DIR="${FACTORY_DIR}/.tasks"
SIGNALS_DIR="${FACTORY_DIR}/.signals"
export LOGS_DIR REGISTRY_FILE CATALOG_FILE PIDS_DIR TASKS_DIR SIGNALS_DIR

# ── Bootstrap output dirs ─────────────────────────────────────
bot_init_dirs() {
  mkdir -p \
    "${FACTORY_DIR}/networking" \
    "${FACTORY_DIR}/wrappers" \
    "${FACTORY_DIR}/developer" \
    "${LOGS_DIR}" \
    "${PIDS_DIR}" \
    "${TASKS_DIR}" \
    "${SIGNALS_DIR}"
}

# ── Timestamps ────────────────────────────────────────────────
ts()       { date "+%Y-%m-%d %H:%M:%S"; }
ts_short() { date "+%H:%M:%S"; }
ts_date()  { date "+%Y-%m-%d"; }

# ── Logging ───────────────────────────────────────────────────
_log_write() {
  local level="$1" bot="$2" msg="$3"
  local logfile="${LOGS_DIR}/${bot}.log"
  mkdir -p "${LOGS_DIR}"
  printf "[%s] [%s] %s\n" "$(ts)" "$level" "$msg" >> "$logfile"
  # keep log size sane (last 500 lines)
  if [ -f "$logfile" ]; then
    local lines
    lines=$(wc -l < "$logfile" 2>/dev/null || echo 0)
    if [ "$lines" -gt 500 ]; then
      tail -n 400 "$logfile" > "${logfile}.tmp" && mv "${logfile}.tmp" "$logfile"
    fi
  fi
}

bot_log_info()    { echo -e "${C_CYAN}ℹ${C_RESET}  [$BOT_NAME] $1"; _log_write INFO "$BOT_NAME" "$1"; }
bot_log_ok()      { echo -e "${C_NEON}✔${C_RESET}  [$BOT_NAME] $1"; _log_write OK   "$BOT_NAME" "$1"; }
bot_log_warn()    { echo -e "${C_AMBER}⚠${C_RESET}  [$BOT_NAME] $1"; _log_write WARN "$BOT_NAME" "$1"; }
bot_log_error()   { echo -e "${C_RED}✖${C_RESET}  [$BOT_NAME] $1"; _log_write ERR  "$BOT_NAME" "$1"; }
bot_log_stealth() { _log_write INFO "$BOT_NAME" "$1"; }  # silent (watchdog uses this)

# ── PID management ────────────────────────────────────────────
bot_write_pid() {
  local bot="${1:-$BOT_NAME}"
  mkdir -p "${PIDS_DIR}"
  echo "$$" > "${PIDS_DIR}/${bot}.pid"
}

bot_read_pid() {
  local bot="$1"
  local pidfile="${PIDS_DIR}/${bot}.pid"
  [ -f "$pidfile" ] && cat "$pidfile" || echo ""
}

bot_is_running() {
  local bot="$1"
  local pid
  pid="$(bot_read_pid "$bot")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# shellcheck disable=SC2120
bot_clear_pid() {
  local bot="${1:-$BOT_NAME}"
  rm -f "${PIDS_DIR}/${bot}.pid"
}

# ── Signal helpers (inter-bot communication) ──────────────────
# Supervisor writes signals; bots poll their signal file.
bot_send_signal() {
  local bot="$1" sig="$2"
  mkdir -p "${SIGNALS_DIR}"
  echo "$sig" > "${SIGNALS_DIR}/${bot}.sig"
}

# shellcheck disable=SC2120
bot_read_signal() {
  local bot="${1:-$BOT_NAME}"
  local sigfile="${SIGNALS_DIR}/${bot}.sig"
  if [ -f "$sigfile" ]; then
    cat "$sigfile"
    rm -f "$sigfile"
  fi
}

bot_check_signal() {
  # Call in bot main loop. Returns 0 if a pause/stop signal was handled.
  local sig
  sig="$(bot_read_signal)"
  case "$sig" in
    PAUSE)
      bot_log_warn "Received PAUSE from Supervisor. Sleeping..."
      while true; do
        sleep 5
        local s; s="$(bot_read_signal)"
        [ "$s" = "RESUME" ] && { bot_log_info "Resuming."; break; }
        [ "$s" = "STOP"   ] && { bot_log_warn "STOP received during pause. Exiting."; bot_clear_pid; exit 0; }
      done
      ;;
    STOP)
      bot_log_warn "Received STOP from Supervisor. Exiting."
      bot_clear_pid
      exit 0
      ;;
    RESTART)
      bot_log_info "Received RESTART. Re-execing..."
      bot_clear_pid
      exec "$0" "$@"
      ;;
  esac
}

# ── Task queue ────────────────────────────────────────────────
bot_enqueue_task() {
  local bot="$1" task="$2"
  mkdir -p "${TASKS_DIR}"
  echo "$task" >> "${TASKS_DIR}/${bot}.queue"
}

bot_dequeue_task() {
  local bot="${1:-$BOT_NAME}"
  local qfile="${TASKS_DIR}/${bot}.queue"
  if [ -f "$qfile" ] && [ -s "$qfile" ]; then
    head -n1 "$qfile"
    sed -i '1d' "$qfile" 2>/dev/null || true
  fi
}

bot_queue_length() {
  local bot="${1:-$BOT_NAME}"
  local qfile="${TASKS_DIR}/${bot}.queue"
  [ -f "$qfile" ] && wc -l < "$qfile" | tr -d ' ' || echo 0
}

# ── Resource check (prevent rogue behavior) ───────────────────
bot_resource_ok() {
  # Returns 1 if this bot is consuming too much CPU (>80% for >5s).
  # Simple check: read /proc/self/stat or use ps.
  local cpu=0
  if command -v ps >/dev/null 2>&1; then
    cpu=$(ps -p $$ -o %cpu= 2>/dev/null | tr -d ' ' | cut -d. -f1 || echo 0)
  fi
  [ "${cpu:-0}" -lt 80 ]
}

# ── Graceful shutdown trap ────────────────────────────────────
bot_trap_exit() {
  trap 'bot_log_warn "Shutting down $BOT_NAME"; bot_clear_pid; trap - EXIT' INT TERM
}
