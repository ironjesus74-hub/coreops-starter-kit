#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps — Bot Control Panel
# Full-screen ANSI TUI with dialog fallback.
# Shows bot status, lets you start/stop/restart bots,
# view logs, browse the factory output, and manage the task queue.
# =============================================================
set -uo pipefail

BOT_NAME="control-panel"
BOTS_HOME="${BOTS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
export BOTS_HOME BOT_NAME

source "$BOTS_HOME/lib/bot-common.sh"
source "$BOTS_HOME/lib/registry.sh"
source "$BOTS_HOME/lib/catalog.sh"

REFRESH_INTERVAL=5   # auto-refresh seconds for status view
USE_DIALOG=0
command -v dialog >/dev/null 2>&1 && USE_DIALOG=1

# ── Terminal helpers ──────────────────────────────────────────
_clear()  { printf '\033[2J\033[H'; }
_hide_cursor() { printf '\033[?25l'; }
_show_cursor() { printf '\033[?25h'; }
_reset_all()   { _show_cursor; printf '\033[0m'; }

trap '_reset_all; echo; exit 0' INT TERM EXIT

# ── Banner ────────────────────────────────────────────────────
_banner() {
  printf "%b" "${C_CYAN}${C_BOLD}"
  cat <<'ART'
  ██████╗ ██████╗ ██████╗ ███████╗ ██████╗ ██████╗ ███████╗
 ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝
 ██║     ██║   ██║██████╔╝█████╗  ██║   ██║██████╔╝███████╗
 ██║     ██║   ██║██╔══██╗██╔══╝  ██║   ██║██╔═══╝ ╚════██║
 ╚██████╗╚██████╔╝██║  ██║███████╗╚██████╔╝██║     ███████║
  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝
ART
  printf "%b" "${C_RESET}"
  printf "%b  ⚡ Bot Control Panel  %b%s%b\n\n" \
    "${C_DIM}" "${C_GRAY}" "$(ts)" "${C_RESET}"
}

# ── Bot status line ───────────────────────────────────────────
_bot_status_line() {
  local name="$1" label="$2"
  local pid status_str color icon
  pid="$(bot_read_pid "$name")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    status_str="RUNNING  (PID ${pid})"
    color="${C_NEON}"; icon="✔"
  else
    status_str="STOPPED"
    color="${C_RED}"; icon="✖"
  fi
  printf "  %b%s%b  %-22s %b%s%b\n" \
    "$color" "$icon" "${C_RESET}" \
    "$label" \
    "$color" "$status_str" "${C_RESET}"
}

# ── Factory stats ─────────────────────────────────────────────
_factory_stats() {
  local net_count wrap_count total
  net_count=$(registry_count_category "networking" 2>/dev/null || echo 0)
  wrap_count=$(registry_count_category "wrappers"   2>/dev/null || echo 0)
  total=$(registry_count 2>/dev/null || echo 0)
  printf "  %bFactory output:%b  " "${C_BOLD}" "${C_RESET}"
  printf "%b%s%b tools built  " "${C_NEON}" "$total" "${C_RESET}"
  printf "(networking: %b%s%b  wrappers: %b%s%b)\n" \
    "${C_CYAN}" "$net_count" "${C_RESET}" \
    "${C_AMBER}" "$wrap_count" "${C_RESET}"
  printf "  %bOutput dir:%b  %s\n" "${C_BOLD}" "${C_RESET}" "${FACTORY_DIR}"
}

# ── Status dashboard ─────────────────────────────────────────
_show_status() {
  bot_init_dirs
  _clear
  _banner

  printf "%b════ BOT STATUS ═══════════════════════════════════════%b\n" \
    "${C_CYAN}" "${C_RESET}"
  _bot_status_line "supervisor" "Supervisor (Admin)"
  _bot_status_line "builder1"   "Builder Bot 1 (Networking)"
  _bot_status_line "builder2"   "Builder Bot 2 (Wrappers)"
  _bot_status_line "watchdog"   "Watchdog (Stealth)"
  printf "\n"

  printf "%b════ FACTORY STATS ════════════════════════════════════%b\n" \
    "${C_CYAN}" "${C_RESET}"
  _factory_stats
  printf "\n"
}

# ── Start all bots ────────────────────────────────────────────
_start_all() {
  bot_init_dirs
  echo ""
  printf "%b  Starting all bots...%b\n" "${C_CYAN}" "${C_RESET}"
  for bot in supervisor builder1 builder2 watchdog; do
    local script="${BOTS_HOME}/${bot}.sh"
    if bot_is_running "$bot"; then
      printf "  %b⚠%b  %-22s already running\n" "${C_AMBER}" "${C_RESET}" "$bot"
    elif [ -f "$script" ]; then
      nohup bash "$script" >> "${LOGS_DIR}/${bot}.log" 2>&1 &
      local pid=$!
      echo "$pid" > "${PIDS_DIR}/${bot}.pid"
      printf "  %b✔%b  %-22s started (PID %d)\n" "${C_NEON}" "${C_RESET}" "$bot" "$pid"
    else
      printf "  %b✖%b  %-22s script missing!\n" "${C_RED}" "${C_RESET}" "$bot"
    fi
    sleep 1
  done
  printf "\n  %bAll bots launched.%b Press Enter to continue.\n" "${C_NEON}" "${C_RESET}"
  read -r _
}

# ── Stop all bots ─────────────────────────────────────────────
_stop_all() {
  echo ""
  printf "%b  Stopping all bots...%b\n" "${C_AMBER}" "${C_RESET}"
  for bot in watchdog builder1 builder2 supervisor; do
    local pid
    pid="$(bot_read_pid "$bot")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
      bot_clear_pid "$bot"
      printf "  %b✔%b  %-22s stopped\n" "${C_AMBER}" "${C_RESET}" "$bot"
    else
      printf "  %b─%b  %-22s not running\n" "${C_GRAY}" "${C_RESET}" "$bot"
    fi
  done
  printf "\n  %bAll bots stopped.%b Press Enter to continue.\n" "${C_AMBER}" "${C_RESET}"
  read -r _
}

# ── Restart a specific bot ────────────────────────────────────
_restart_bot() {
  local name="$1"
  local script="${BOTS_HOME}/${name}.sh"
  local pid
  pid="$(bot_read_pid "$name")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true; sleep 1
  fi
  bot_clear_pid "$name"
  if [ -f "$script" ]; then
    nohup bash "$script" >> "${LOGS_DIR}/${name}.log" 2>&1 &
    local new_pid=$!
    echo "$new_pid" > "${PIDS_DIR}/${name}.pid"
    printf "  %b✔%b  %s restarted (PID %d)\n" "${C_NEON}" "${C_RESET}" "$name" "$new_pid"
  else
    printf "  %b✖%b  Script not found: %s\n" "${C_RED}" "${C_RESET}" "$script"
  fi
}

# ── View log for a bot ────────────────────────────────────────
_view_log() {
  local name="$1"
  local logfile="${LOGS_DIR}/${name}.log"
  _clear
  printf "%b  Log: %s%b\n" "${C_CYAN}${C_BOLD}" "$name" "${C_RESET}"
  printf "%b  (Press Ctrl+C or q+Enter to stop)%b\n\n" "${C_DIM}" "${C_RESET}"
  if [ -f "$logfile" ]; then
    tail -n 40 -f "$logfile" 2>/dev/null &
    local tail_pid=$!
    read -r _
    kill "$tail_pid" 2>/dev/null || true
  else
    printf "  %bNo log yet: %s%b\n" "${C_DIM}" "$logfile" "${C_RESET}"
    read -r _
  fi
}

# ── Browse factory output ─────────────────────────────────────
_browse_factory() {
  _clear
  printf "%b  CoreOps Factory — Built Tools%b\n\n" "${C_CYAN}${C_BOLD}" "${C_RESET}"

  for cat in networking wrappers developer; do
    local dir="${FACTORY_DIR}/${cat}"
    if [ -d "$dir" ] && [ "$(ls -A "$dir" 2>/dev/null)" ]; then
      printf "%b  ▶ %-15s%b\n" "${C_AMBER}${C_BOLD}" "$cat" "${C_RESET}"
      while IFS= read -r f; do
        local fname size
        fname=$(basename "$f")
        size=$(du -sh "$f" 2>/dev/null | cut -f1 || echo "?")
        printf "      %b✔%b  %-40s %b%s%b\n" \
          "${C_NEON}" "${C_RESET}" "$fname" "${C_GRAY}" "$size" "${C_RESET}"
      done < <(find "$dir" -maxdepth 1 -name "*.sh" -type f | sort)
      echo ""
    fi
  done

  local total
  total=$(registry_count 2>/dev/null || echo 0)
  printf "  %bTotal tools built: %s%b\n\n" "${C_BOLD}" "$total" "${C_RESET}"
  printf "  Press Enter to return.\n"
  read -r _
}

# ── Send signal to a bot ──────────────────────────────────────
_send_signal_menu() {
  _clear
  printf "%b  Send Signal to Bot%b\n\n" "${C_CYAN}${C_BOLD}" "${C_RESET}"
  printf "  Bot: [1] builder1  [2] builder2  [3] watchdog  [4] supervisor\n"
  printf "  Bot> "; read -r bot_choice
  case "$bot_choice" in
    1) target="builder1" ;;
    2) target="builder2" ;;
    3) target="watchdog" ;;
    4) target="supervisor" ;;
    *) echo "  Invalid."; sleep 1; return ;;
  esac
  printf "  Signal: [1] PAUSE  [2] RESUME  [3] STOP  [4] RESTART\n"
  printf "  Signal> "; read -r sig_choice
  case "$sig_choice" in
    1) bot_send_signal "$target" "PAUSE"   ;;
    2) bot_send_signal "$target" "RESUME"  ;;
    3) bot_send_signal "$target" "STOP"    ;;
    4) bot_send_signal "$target" "RESTART" ;;
    *) echo "  Invalid."; sleep 1; return ;;
  esac
  printf "  %b✔%b Signal sent to %s.\n" "${C_NEON}" "${C_RESET}" "$target"
  sleep 1
}

# ── Auto-refresh status ───────────────────────────────────────
_live_status() {
  _hide_cursor
  while true; do
    _show_status
    printf "%b  [Auto-refresh every %ss — press Ctrl+C to return to menu]%b\n" \
      "${C_DIM}" "$REFRESH_INTERVAL" "${C_RESET}"
    sleep "$REFRESH_INTERVAL"
  done
}

# ── dialog-based menu (if available) ─────────────────────────
_dialog_menu() {
  while true; do
    choice=$(dialog --clear --backtitle "CoreOps Bot Control Panel" \
      --title "Main Menu" \
      --menu "Choose an action:" 20 60 12 \
      1 "▶  Start All Bots" \
      2 "■  Stop All Bots" \
      3 "↺  Restart Bot..." \
      4 "📊  Live Status (auto-refresh)" \
      5 "📋  View Bot Log..." \
      6 "📂  Browse Factory Output" \
      7 "✉  Send Signal to Bot" \
      8 "❌  Exit" \
      2>&1 >/dev/tty) || break

    case "$choice" in
      1) _start_all ;;
      2) _stop_all ;;
      3)
        bot=$(dialog --backtitle "CoreOps" --title "Restart Bot" \
          --menu "Select bot:" 12 40 4 \
          1 supervisor 2 builder1 3 builder2 4 watchdog \
          2>&1 >/dev/tty)
        case "$bot" in
          1) _restart_bot supervisor ;;
          2) _restart_bot builder1 ;;
          3) _restart_bot builder2 ;;
          4) _restart_bot watchdog ;;
        esac
        ;;
      4) _live_status ;;
      5)
        bot=$(dialog --backtitle "CoreOps" --title "View Log" \
          --menu "Select bot:" 12 40 4 \
          1 supervisor 2 builder1 3 builder2 4 watchdog \
          2>&1 >/dev/tty)
        case "$bot" in
          1) _view_log supervisor ;;
          2) _view_log builder1 ;;
          3) _view_log builder2 ;;
          4) _view_log watchdog ;;
        esac
        ;;
      6) _browse_factory ;;
      7) _send_signal_menu ;;
      8|*) break ;;
    esac
  done
  _reset_all
}

# ── Plain ANSI menu ───────────────────────────────────────────
_plain_menu() {
  while true; do
    _show_status

    printf "%b════ CONTROL PANEL ════════════════════════════════════%b\n" \
      "${C_CYAN}" "${C_RESET}"
    printf "  %b[1]%b Start All Bots       %b[5]%b View Log...\n" \
      "${C_BOLD}" "${C_RESET}" "${C_BOLD}" "${C_RESET}"
    printf "  %b[2]%b Stop All Bots        %b[6]%b Browse Factory Output\n" \
      "${C_BOLD}" "${C_RESET}" "${C_BOLD}" "${C_RESET}"
    printf "  %b[3]%b Restart Bot...       %b[7]%b Send Signal to Bot\n" \
      "${C_BOLD}" "${C_RESET}" "${C_BOLD}" "${C_RESET}"
    printf "  %b[4]%b Live Status View     %b[q]%b Quit\n" \
      "${C_BOLD}" "${C_RESET}" "${C_BOLD}" "${C_RESET}"
    printf "%b───────────────────────────────────────────────────────%b\n" \
      "${C_GRAY}" "${C_RESET}"
    printf "  %bChoice> %b" "${C_BOLD}" "${C_RESET}"
    read -r choice

    case "$choice" in
      1) _start_all ;;
      2) _stop_all ;;
      3)
        printf "\n  Restart which bot? [supervisor/builder1/builder2/watchdog]: "
        read -r bname
        case "$bname" in
          supervisor|builder1|builder2|watchdog) _restart_bot "$bname" ;;
          *) printf "  %bUnknown bot.%b\n" "${C_RED}" "${C_RESET}" ;;
        esac
        sleep 1
        ;;
      4)
        printf "  %b  Entering live status. Press Ctrl+C to return.%b\n" "${C_DIM}" "${C_RESET}"
        sleep 1
        _live_status
        ;;
      5)
        printf "\n  View log for which bot? [supervisor/builder1/builder2/watchdog]: "
        read -r bname
        case "$bname" in
          supervisor|builder1|builder2|watchdog) _view_log "$bname" ;;
          *) printf "  %bUnknown bot.%b\n" "${C_RED}" "${C_RESET}" ;;
        esac
        ;;
      6) _browse_factory ;;
      7) _send_signal_menu ;;
      q|Q|quit|exit) break ;;
      *) printf "  %bInvalid choice.%b\n" "${C_RED}" "${C_RESET}"; sleep 0.5 ;;
    esac
  done
}

# ── Entry point ───────────────────────────────────────────────
bot_init_dirs

_clear
_banner

if [ "$USE_DIALOG" -eq 1 ]; then
  _dialog_menu
else
  _plain_menu
fi

_reset_all
echo "CoreOps Control Panel closed."
