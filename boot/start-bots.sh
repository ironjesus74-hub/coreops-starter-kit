#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps — Termux:Boot Auto-Start Script
# Place this file in ~/.termux/boot/ and install the
# Termux:Boot app to auto-launch bots on phone restart.
# See boot/README.md for full setup instructions.
# =============================================================
set -uo pipefail

# Locate CoreOps install directory (adjust if you cloned elsewhere)
COREOPS_INSTALL="${HOME}/coreops-starter-kit"
BOTS_HOME="${COREOPS_INSTALL}/bots"

# Verify installation exists
if [ ! -d "$BOTS_HOME" ]; then
  # Try common Termux storage path
  COREOPS_INSTALL="${HOME}/storage/shared/coreops-starter-kit"
  BOTS_HOME="${COREOPS_INSTALL}/bots"
fi

if [ ! -d "$BOTS_HOME" ]; then
  echo "[CoreOps Boot] Installation not found. Edit COREOPS_INSTALL in this script."
  exit 1
fi

export BOTS_HOME COREOPS_HOME="${COREOPS_INSTALL}"

# Output factory directory
if [ -d "${HOME}/storage/shared/Documents" ]; then
  export FACTORY_DIR="${HOME}/storage/shared/Documents/CoreOps-Factory"
else
  export FACTORY_DIR="${HOME}/Documents/CoreOps-Factory"
fi

mkdir -p "${FACTORY_DIR}/logs" "${FACTORY_DIR}/.pids"

LOGFILE="${FACTORY_DIR}/logs/boot.log"
printf "[%s] CoreOps:Boot starting...\n" "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOGFILE"

# Give the system a moment to fully boot
sleep 10

# Start the supervisor (it will launch builder1, builder2, watchdog)
if [ -f "${BOTS_HOME}/supervisor.sh" ]; then
  nohup bash "${BOTS_HOME}/supervisor.sh" \
    >> "${FACTORY_DIR}/logs/supervisor.log" 2>&1 &
  echo "$!" > "${FACTORY_DIR}/.pids/supervisor.pid"
  printf "[%s] Supervisor started (PID %s)\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$!" >> "$LOGFILE"
fi

# Start the watchdog independently (so it can restart supervisor if needed)
if [ -f "${BOTS_HOME}/watchdog.sh" ]; then
  nohup bash "${BOTS_HOME}/watchdog.sh" \
    >> "${FACTORY_DIR}/logs/watchdog.log" 2>&1 &
  echo "$!" > "${FACTORY_DIR}/.pids/watchdog.pid"
  printf "[%s] Watchdog started (PID %s)\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$!" >> "$LOGFILE"
fi

printf "[%s] CoreOps:Boot complete.\n" "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOGFILE"
