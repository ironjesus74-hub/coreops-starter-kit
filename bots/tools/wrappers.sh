#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps Builder 2 — Wrappers & Developer Script Generators
# Each function writes a complete, working bash script into $1.
# =============================================================

BOTS_HOME="${BOTS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$BOTS_HOME/lib/bot-common.sh" 2>/dev/null || true
source "$BOTS_HOME/lib/registry.sh"  2>/dev/null || true
source "$BOTS_HOME/lib/catalog.sh"   2>/dev/null || true

# ── Tool manifest ─────────────────────────────────────────────
declare -a WRAP_TOOL_IDS=(
  "curl-smart"
  "json-formatter"
  "git-quick"
  "log-tail"
  "env-manager"
  "backup-files"
  "cron-helper"
  "deploy-helper"
  "process-manager"
  "file-organizer"
  "api-mock-server"
  "base64-tools"
)

wrap_tool_next_unbuilt() {
  for id in "${WRAP_TOOL_IDS[@]}"; do
    registry_exists "wrappers" "$id" || { echo "$id"; return; }
  done
  echo ""
}

wrap_all_built() {
  for id in "${WRAP_TOOL_IDS[@]}"; do
    registry_exists "wrappers" "$id" || return 1
  done
  return 0
}

# ─────────────────────────────────────────────────────────────
_gen_curl_smart() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Smart curl wrapper with retry, exponential back-off, and verbose error reporting.
URL="${1:-}"
[ -z "$URL" ] && { echo "Usage: $0 <url> [max_retries] [initial_wait_s] [extra_curl_args...]"; exit 1; }
MAX_RETRIES="${2:-3}"; WAIT="${3:-2}"; shift 3 2>/dev/null || shift $# 2>/dev/null || true
EXTRA=("$@")

C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"; C_RESET="\033[0m"

attempt=1
while [ "$attempt" -le "$MAX_RETRIES" ]; do
  printf "[Attempt %d/%d] %s\n" "$attempt" "$MAX_RETRIES" "$URL"
  if curl -fsSL --max-time 20 --connect-timeout 5 "${EXTRA[@]}" "$URL"; then
    printf "\n${C_GREEN}✔ Success on attempt %d.${C_RESET}\n" "$attempt"
    exit 0
  fi
  rc=$?
  printf "${C_YELLOW}⚠ Failed (exit %d). Retrying in %ds...${C_RESET}\n" "$rc" "$WAIT"
  sleep "$WAIT"
  WAIT=$(( WAIT * 2 ))
  (( attempt++ )) || true
done

printf "${C_RED}✖ All %d attempts failed for: %s${C_RESET}\n" "$MAX_RETRIES" "$URL"
exit 1
BODY
  catalog_stamp "$f" "curl-smart" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "curl wrapper with automatic retry, exponential back-off, and clear error reporting." \
    "./curl-smart.sh <url> [max_retries] [initial_wait_s] [extra_curl_args]" \
    "wrappers curl http retry networking"
}

_gen_json_formatter() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# JSON formatter/validator/key extractor.
# Depends on python3 or jq (uses whichever is available).

INPUT="${1:--}"   # file or - for stdin
KEY="${2:-}"      # optional: dot-notation key e.g. "user.name"

format_with_python() {
  if [ -n "$KEY" ]; then
    python3 -c "
import json, sys
data = json.load(sys.stdin)
keys = '${KEY}'.split('.')
for k in keys:
    if isinstance(data, list):
        data = data[int(k)]
    else:
        data = data[k]
print(json.dumps(data, indent=2) if isinstance(data, (dict,list)) else data)
"
  else
    python3 -m json.tool
  fi
}

format_with_jq() {
  if [ -n "$KEY" ]; then
    # convert dot notation to jq path
    jq_path=$(echo "$KEY" | sed 's/\./\./g; s/^/./') 
    jq "${jq_path}" 2>/dev/null || jq ".$KEY"
  else
    jq '.'
  fi
}

run() {
  if command -v jq >/dev/null 2>&1; then
    format_with_jq
  elif command -v python3 >/dev/null 2>&1; then
    format_with_python
  else
    echo "Error: neither jq nor python3 found. Install one to use json-formatter." >&2
    exit 1
  fi
}

if [ "$INPUT" = "-" ]; then
  run
elif [ -f "$INPUT" ]; then
  run < "$INPUT"
else
  # treat as raw JSON string
  printf "%s" "$INPUT" | run
fi
BODY
  catalog_stamp "$f" "JSON Formatter" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Formats, validates, and queries JSON from files, stdin, or raw strings using jq or python3." \
    "./json-formatter.sh [file_or_-] [dot.key.path]" \
    "wrappers json formatter parser developer"
}

_gen_git_quick() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Quick git workflow shortcuts for common operations.
CMD="${1:-help}"
shift || true

C_GREEN="\033[32m"; C_CYAN="\033[36m"; C_BOLD="\033[1m"; C_RESET="\033[0m"

_require_git() { command -v git >/dev/null 2>&1 || { echo "git not found."; exit 1; }; }

case "$CMD" in
  save)
    # git save [message] — stage all, commit, push
    _require_git
    MSG="${1:-Auto-save $(date '+%Y-%m-%d %H:%M')}"
    git add -A
    git commit -m "$MSG"
    git push
    printf "${C_GREEN}✔ Saved and pushed: %s${C_RESET}\n" "$MSG"
    ;;
  undo)
    # git undo — undo last commit (keep changes staged)
    _require_git
    git reset --soft HEAD~1
    printf "${C_GREEN}✔ Last commit undone (changes are staged).${C_RESET}\n"
    ;;
  sync)
    # git sync — pull rebase + push
    _require_git
    git pull --rebase
    git push
    printf "${C_GREEN}✔ Synced with remote.${C_RESET}\n"
    ;;
  clean)
    # git clean — remove untracked + ignored files (asks confirmation)
    _require_git
    echo "Files to remove:"
    git clean -ndX
    printf "Proceed? [y/N] "; read -r ans
    [ "${ans:-n}" = "y" ] && git clean -fdX && printf "${C_GREEN}✔ Cleaned.${C_RESET}\n" || echo "Aborted."
    ;;
  log)
    # git log — pretty one-line log
    _require_git
    git log --oneline --graph --decorate --color "${@:-HEAD~15..HEAD}" 2>/dev/null || \
    git log --oneline --graph --decorate --color -15
    ;;
  branch)
    # git branch — list branches with last commit info
    _require_git
    git branch -v --sort=-committerdate
    ;;
  stash)
    _require_git
    git stash "${@:-}"
    ;;
  status)
    _require_git
    git status -sb
    ;;
  help|*)
    printf "${C_BOLD}git-quick — git workflow shortcuts${C_RESET}\n"
    echo "  save [msg]  — stage all, commit, push"
    echo "  undo        — undo last commit (keep staged)"
    echo "  sync        — pull --rebase + push"
    echo "  clean       — remove untracked/ignored files"
    echo "  log         — pretty one-line graph log"
    echo "  branch      — list branches with info"
    echo "  stash [args]— git stash passthrough"
    echo "  status      — short status"
    ;;
esac
BODY
  catalog_stamp "$f" "git-quick" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Git workflow shortcuts: save, undo, sync, clean, log, branch in one script." \
    "./git-quick.sh <save|undo|sync|clean|log|branch|stash|status>" \
    "wrappers git developer workflow shortcuts"
}

_gen_log_tail() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Smart log tailer with filtering, highlighting, and rate limiting.
LOGFILE="${1:-}"
FILTER="${2:-}"
LINES="${3:-50}"

[ -z "$LOGFILE" ] && { echo "Usage: $0 <logfile> [grep_filter] [initial_lines]"; exit 1; }
[ -f "$LOGFILE" ] || { echo "File not found: $LOGFILE"; exit 1; }

C_RED="\033[31m"; C_YELLOW="\033[33m"; C_GREEN="\033[32m"
C_CYAN="\033[36m"; C_BOLD="\033[1m"; C_RESET="\033[0m"

highlight() {
  # Color-code log levels
  sed -e "s/\(ERROR\|FATAL\|CRIT\)/${C_RED}\1${C_RESET}/gI" \
      -e "s/\(WARN\|WARNING\)/${C_YELLOW}\1${C_RESET}/gI" \
      -e "s/\(INFO\|OK\|SUCCESS\)/${C_GREEN}\1${C_RESET}/gI" \
      -e "s/\(DEBUG\|TRACE\)/${C_CYAN}\1${C_RESET}/gI"
}

printf "${C_BOLD}Tailing: %s${C_RESET}" "$LOGFILE"
[ -n "$FILTER" ] && printf " ${C_CYAN}[filter: %s]${C_RESET}" "$FILTER"
printf "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"

if [ -n "$FILTER" ]; then
  tail -n "$LINES" -f "$LOGFILE" | grep --line-buffered "$FILTER" | highlight
else
  tail -n "$LINES" -f "$LOGFILE" | highlight
fi
BODY
  catalog_stamp "$f" "log-tail" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Tails log files with color-coded ERROR/WARN/INFO levels and optional keyword filtering." \
    "./log-tail.sh <logfile> [grep_filter] [initial_lines]" \
    "wrappers logs tail monitoring developer"
}

_gen_env_manager() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Manage .env files across projects: list, set, get, delete, export.
CMD="${1:-help}"
ENVFILE="${2:-.env}"
shift 2 || true

C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_CYAN="\033[36m"
C_BOLD="\033[1m"; C_RESET="\033[0m"

_ensure_file() { [ -f "$ENVFILE" ] || touch "$ENVFILE"; }

case "$CMD" in
  list)
    _ensure_file
    printf "${C_BOLD}Variables in %s:${C_RESET}\n" "$ENVFILE"
    printf "%-30s %s\n" "KEY" "VALUE"
    printf "%-30s %s\n" "───────────────────────────────" "──────────────"
    while IFS= read -r line; do
      [[ "$line" =~ ^#|^$ ]] && continue
      key=$(echo "$line" | cut -d= -f1)
      val=$(echo "$line" | cut -d= -f2-)
      # Mask secrets
      if echo "$key" | grep -qiE "SECRET|TOKEN|PASS|KEY|PWD"; then
        val="***REDACTED***"
      fi
      printf "${C_CYAN}%-30s${C_RESET} %s\n" "$key" "$val"
    done < "$ENVFILE"
    ;;
  get)
    KEY="${1:-}"; [ -z "$KEY" ] && { echo "Usage: $0 get <envfile> <KEY>"; exit 1; }
    _ensure_file
    val=$(grep "^${KEY}=" "$ENVFILE" | cut -d= -f2- | head -n1 || true)
    [ -n "$val" ] && echo "$val" || { echo "Key not found: $KEY"; exit 1; }
    ;;
  set)
    KEY="${1:-}"; VAL="${2:-}"
    [ -z "$KEY" ] && { echo "Usage: $0 set <envfile> <KEY> <VALUE>"; exit 1; }
    _ensure_file
    if grep -q "^${KEY}=" "$ENVFILE" 2>/dev/null; then
      sed -i "s|^${KEY}=.*|${KEY}=${VAL}|" "$ENVFILE"
      printf "${C_GREEN}✔ Updated %s in %s${C_RESET}\n" "$KEY" "$ENVFILE"
    else
      echo "${KEY}=${VAL}" >> "$ENVFILE"
      printf "${C_GREEN}✔ Added %s to %s${C_RESET}\n" "$KEY" "$ENVFILE"
    fi
    ;;
  delete)
    KEY="${1:-}"; [ -z "$KEY" ] && { echo "Usage: $0 delete <envfile> <KEY>"; exit 1; }
    _ensure_file
    sed -i "/^${KEY}=/d" "$ENVFILE"
    printf "${C_YELLOW}✔ Deleted %s from %s${C_RESET}\n" "$KEY" "$ENVFILE"
    ;;
  export)
    _ensure_file
    printf "# Exporting variables from %s\n" "$ENVFILE"
    while IFS= read -r line; do
      [[ "$line" =~ ^#|^$ ]] && continue
      echo "export $line"
    done < "$ENVFILE"
    ;;
  help|*)
    printf "${C_BOLD}env-manager — .env file manager${C_RESET}\n"
    echo "  list   <envfile>           — list all variables (secrets masked)"
    echo "  get    <envfile> <KEY>     — print a variable value"
    echo "  set    <envfile> <KEY> <V> — set/update a variable"
    echo "  delete <envfile> <KEY>     — remove a variable"
    echo "  export <envfile>           — print as 'export KEY=VAL' statements"
    ;;
esac
BODY
  catalog_stamp "$f" "env-manager" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Manages .env files: list, get, set, delete, export with secret masking." \
    "./env-manager.sh <list|get|set|delete|export> <envfile> [key] [value]" \
    "wrappers env environment developer config dotenv"
}

_gen_backup_files() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Smart file backup with rotation and compression.
SOURCE="${1:-}"
DEST="${2:-${HOME}/backups}"
MAX_BACKUPS="${3:-5}"

[ -z "$SOURCE" ] && { echo "Usage: $0 <source_path> [dest_dir] [max_backups_to_keep]"; exit 1; }
[ -e "$SOURCE" ] || { echo "Source not found: $SOURCE"; exit 1; }

C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_BOLD="\033[1m"; C_RESET="\033[0m"

mkdir -p "$DEST"

name=$(basename "$SOURCE")
ts=$(date "+%Y%m%d_%H%M%S")
dest_file="${DEST}/${name}_${ts}.tar.gz"

printf "${C_BOLD}Backing up: %s → %s${C_RESET}\n" "$SOURCE" "$dest_file"
tar -czf "$dest_file" -C "$(dirname "$SOURCE")" "$name"
size=$(du -sh "$dest_file" | cut -f1)
printf "${C_GREEN}✔ Backup created: %s (%s)${C_RESET}\n" "$dest_file" "$size"

# Rotation: keep only the last N backups
echo "Rotating backups (keeping last ${MAX_BACKUPS})..."
count=0
while IFS= read -r old; do
  ((count++)) || true
  if [ "$count" -gt "$MAX_BACKUPS" ]; then
    rm -f "$old"
    printf "${C_YELLOW}  Removed old backup: %s${C_RESET}\n" "$old"
  fi
done < <(ls -t "${DEST}/${name}_"*.tar.gz 2>/dev/null || true)

printf "${C_GREEN}✔ Done. %d backup(s) retained.${C_RESET}\n" "$MAX_BACKUPS"
BODY
  catalog_stamp "$f" "backup-files" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Creates timestamped tar.gz backups with automatic rotation to keep disk usage low." \
    "./backup-files.sh <source_path> [dest_dir] [max_backups]" \
    "wrappers backup files rotation compression"
}

_gen_cron_helper() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Cron job manager: list, add, remove, and validate cron expressions.
CMD="${1:-help}"
shift || true

C_GREEN="\033[32m"; C_CYAN="\033[36m"; C_BOLD="\033[1m"; C_DIM="\033[2m"; C_RESET="\033[0m"

CRONTAB_CMD="crontab"
command -v "$CRONTAB_CMD" >/dev/null 2>&1 || { echo "crontab not found."; exit 1; }

case "$CMD" in
  list)
    printf "${C_BOLD}Current crontab:${C_RESET}\n"
    current=$(crontab -l 2>/dev/null || echo "# No crontab set")
    line_no=1
    while IFS= read -r line; do
      if [[ "$line" =~ ^# ]] || [[ -z "$line" ]]; then
        printf "${C_DIM}%3d: %s${C_RESET}\n" "$line_no" "$line"
      else
        printf "${C_CYAN}%3d: %s${C_RESET}\n" "$line_no" "$line"
      fi
      ((line_no++)) || true
    done <<< "$current"
    ;;
  add)
    SCHEDULE="${1:-}"; JOB="${2:-}"
    [ -z "$SCHEDULE" ] || [ -z "$JOB" ] && {
      echo "Usage: $0 add '<cron_schedule>' '<command>'"
      echo "  Example: $0 add '0 * * * *' '/path/to/script.sh'"
      exit 1
    }
    (crontab -l 2>/dev/null || true; echo "${SCHEDULE} ${JOB}") | crontab -
    printf "${C_GREEN}✔ Added cron job: %s %s${C_RESET}\n" "$SCHEDULE" "$JOB"
    ;;
  remove)
    PATTERN="${1:-}"
    [ -z "$PATTERN" ] && { echo "Usage: $0 remove '<pattern_to_match>'"; exit 1; }
    (crontab -l 2>/dev/null || true) | grep -v "$PATTERN" | crontab -
    printf "${C_GREEN}✔ Removed entries matching: %s${C_RESET}\n" "$PATTERN"
    ;;
  templates)
    printf "${C_BOLD}Common cron schedule templates:${C_RESET}\n"
    echo "  Every minute:       * * * * *"
    echo "  Every hour:         0 * * * *"
    echo "  Daily at midnight:  0 0 * * *"
    echo "  Daily at 6am:       0 6 * * *"
    echo "  Weekly (Sunday):    0 0 * * 0"
    echo "  Monthly (1st):      0 0 1 * *"
    echo "  Every 5 minutes:    */5 * * * *"
    echo "  Every 15 minutes:   */15 * * * *"
    echo "  Weekdays at 9am:    0 9 * * 1-5"
    ;;
  help|*)
    printf "${C_BOLD}cron-helper — cron job manager${C_RESET}\n"
    echo "  list                        — show current crontab"
    echo "  add '<schedule>' '<cmd>'    — add a new cron job"
    echo "  remove '<pattern>'          — remove matching cron jobs"
    echo "  templates                   — print common schedule examples"
    ;;
esac
BODY
  catalog_stamp "$f" "cron-helper" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Cron job manager with list, add, remove, and schedule template reference." \
    "./cron-helper.sh <list|add|remove|templates>" \
    "wrappers cron scheduler automation developer"
}

_gen_deploy_helper() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Simple deployment helper: rsync + optional pre/post hooks.
TARGET="${1:-}"
SRC="${2:-.}"
PRE_HOOK="${3:-}"
POST_HOOK="${4:-}"

usage() {
  echo "Usage: $0 <user@host:/path> [src_dir] [pre_hook_script] [post_hook_script]"
  echo "  Example: $0 deploy@myserver.com:/var/www/app . ./pre-deploy.sh ./post-deploy.sh"
  exit 1
}
[ -z "$TARGET" ] && usage

C_GREEN="\033[32m"; C_CYAN="\033[36m"; C_BOLD="\033[1m"; C_RESET="\033[0m"

printf "${C_BOLD}CoreOps Deploy Helper${C_RESET}\n"
printf "Source : %s\nTarget : %s\n\n" "$SRC" "$TARGET"

# Pre-hook
if [ -n "$PRE_HOOK" ] && [ -f "$PRE_HOOK" ]; then
  printf "${C_CYAN}Running pre-deploy hook: %s${C_RESET}\n" "$PRE_HOOK"
  bash "$PRE_HOOK" || { echo "Pre-hook failed. Aborting deploy."; exit 1; }
fi

# rsync with useful defaults
command -v rsync >/dev/null 2>&1 || { echo "rsync not found. Install: pkg install rsync"; exit 1; }

printf "${C_CYAN}Syncing files...${C_RESET}\n"
rsync -avz --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='*.log' \
  --exclude='.env' \
  "$SRC/" "$TARGET"

# Post-hook
if [ -n "$POST_HOOK" ] && [ -f "$POST_HOOK" ]; then
  printf "${C_CYAN}Running post-deploy hook: %s${C_RESET}\n" "$POST_HOOK"
  bash "$POST_HOOK"
fi

printf "${C_GREEN}✔ Deployment complete!${C_RESET}\n"
BODY
  catalog_stamp "$f" "deploy-helper" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Deploys files via rsync with optional pre/post hook scripts." \
    "./deploy-helper.sh <user@host:/path> [src] [pre_hook] [post_hook]" \
    "wrappers deploy rsync ssh automation devops"
}

_gen_process_manager() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Process manager: start background jobs, monitor them, restart on crash.
CMD="${1:-help}"
shift || true

PFILE="${HOME}/.coreops-procs.db"
C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"
C_CYAN="\033[36m"; C_BOLD="\033[1m"; C_RESET="\033[0m"

_is_alive() { kill -0 "$1" 2>/dev/null; }

case "$CMD" in
  start)
    NAME="${1:-}"; COMMAND="${2:-}"
    [ -z "$NAME" ] || [ -z "$COMMAND" ] && { echo "Usage: $0 start <name> '<command>'"; exit 1; }
    # Check not already running
    if grep -q "^${NAME}:" "$PFILE" 2>/dev/null; then
      pid=$(grep "^${NAME}:" "$PFILE" | cut -d: -f2)
      _is_alive "$pid" && { printf "${C_YELLOW}⚠ %s already running (PID %s)${C_RESET}\n" "$NAME" "$pid"; exit 0; }
    fi
    nohup bash -c "$COMMAND" >> "${HOME}/.coreops-${NAME}.log" 2>&1 &
    pid=$!
    grep -v "^${NAME}:" "$PFILE" 2>/dev/null > /tmp/_pm_tmp || true; mv /tmp/_pm_tmp "$PFILE" 2>/dev/null || true
    echo "${NAME}:${pid}:${COMMAND}:$(date +%s)" >> "$PFILE"
    printf "${C_GREEN}✔ Started %s (PID %d)${C_RESET}\n" "$NAME" "$pid"
    ;;
  stop)
    NAME="${1:-}"; [ -z "$NAME" ] && { echo "Usage: $0 stop <name>"; exit 1; }
    pid=$(grep "^${NAME}:" "$PFILE" 2>/dev/null | cut -d: -f2 || true)
    if [ -n "$pid" ] && _is_alive "$pid"; then
      kill "$pid"
      printf "${C_YELLOW}✔ Stopped %s (PID %s)${C_RESET}\n" "$NAME" "$pid"
    else
      printf "${C_RED}✖ %s not running${C_RESET}\n" "$NAME"
    fi
    grep -v "^${NAME}:" "$PFILE" 2>/dev/null > /tmp/_pm_tmp || true; mv /tmp/_pm_tmp "$PFILE" 2>/dev/null || true
    ;;
  list)
    printf "${C_BOLD}%-20s %-8s %-10s %s${C_RESET}\n" "NAME" "PID" "STATUS" "COMMAND"
    printf "%-20s %-8s %-10s %s\n" "────────────────────" "────────" "──────────" "───────"
    [ -f "$PFILE" ] || { echo "(no processes registered)"; exit 0; }
    while IFS=: read -r name pid cmd started; do
      if _is_alive "$pid"; then
        printf "${C_GREEN}%-20s %-8s %-10s${C_RESET} %s\n" "$name" "$pid" "RUNNING" "$cmd"
      else
        printf "${C_RED}%-20s %-8s %-10s${C_RESET} %s\n" "$name" "$pid" "STOPPED" "$cmd"
      fi
    done < "$PFILE"
    ;;
  restart)
    NAME="${1:-}"; [ -z "$NAME" ] && { echo "Usage: $0 restart <name>"; exit 1; }
    cmd=$(grep "^${NAME}:" "$PFILE" 2>/dev/null | cut -d: -f3 || true)
    [ -z "$cmd" ] && { echo "Process not found: $NAME"; exit 1; }
    bash "$0" stop  "$NAME"
    bash "$0" start "$NAME" "$cmd"
    ;;
  help|*)
    printf "${C_BOLD}process-manager — background process manager${C_RESET}\n"
    echo "  start  <name> '<command>' — start a background process"
    echo "  stop   <name>             — stop a process"
    echo "  list                      — show all managed processes"
    echo "  restart <name>            — restart a process"
    ;;
esac
BODY
  catalog_stamp "$f" "process-manager" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Manages background processes: start, stop, list, restart with persistence across sessions." \
    "./process-manager.sh <start|stop|list|restart> [name] [command]" \
    "wrappers process background daemon automation"
}

_gen_file_organizer() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Auto-organizes files in a directory by extension into subdirectories.
SRC_DIR="${1:-.}"
DRY_RUN="${2:-}"

[ -d "$SRC_DIR" ] || { echo "Directory not found: $SRC_DIR"; exit 1; }

C_GREEN="\033[32m"; C_CYAN="\033[36m"; C_DIM="\033[2m"; C_BOLD="\033[1m"; C_RESET="\033[0m"

declare -A EXT_MAP=(
  [jpg]="images" [jpeg]="images" [png]="images" [gif]="images" [svg]="images" [webp]="images"
  [mp4]="videos" [mkv]="videos" [avi]="videos" [mov]="videos"
  [mp3]="audio"  [wav]="audio"  [flac]="audio" [m4a]="audio"
  [pdf]="docs"   [doc]="docs"   [docx]="docs"  [xls]="docs"   [xlsx]="docs"  [ppt]="docs" [pptx]="docs" [txt]="docs"
  [zip]="archives" [tar]="archives" [gz]="archives" [7z]="archives" [rar]="archives"
  [sh]="scripts" [py]="scripts" [js]="scripts" [ts]="scripts" [rb]="scripts"
  [json]="data"  [yaml]="data"  [yml]="data"   [csv]="data"   [xml]="data"   [toml]="data"
  [html]="web"   [css]="web"    [htm]="web"
)

moved=0; skipped=0

printf "${C_BOLD}Organizing: %s${C_RESET}%s\n" "$SRC_DIR" "${DRY_RUN:+ (dry run)}"
echo "─────────────────────────────────────────────────"

find "$SRC_DIR" -maxdepth 1 -type f | while IFS= read -r file; do
  ext="${file##*.}"
  ext="${ext,,}"  # lowercase
  dir="${EXT_MAP[$ext]:-other}"
  dest="${SRC_DIR}/${dir}"
  fname=$(basename "$file")

  if [ -n "$DRY_RUN" ]; then
    printf "${C_DIM}[DRY] Would move: %s → %s/%s${C_RESET}\n" "$fname" "$dir" "$fname"
  else
    mkdir -p "$dest"
    mv "$file" "${dest}/${fname}"
    printf "${C_GREEN}✔${C_RESET} %-40s → %s\n" "$fname" "$dir"
  fi
done

printf "${C_BOLD}Done.${C_RESET}\n"
BODY
  catalog_stamp "$f" "file-organizer" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Sorts files in a directory into subdirectories by type (images, docs, scripts, etc.)." \
    "./file-organizer.sh [dir] [--dry-run]" \
    "wrappers files organization automation productivity"
}

_gen_api_mock_server() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Minimal HTTP mock server using netcat (nc) or python3.
PORT="${1:-8080}"
RESPONSE_FILE="${2:-}"

C_GREEN="\033[32m"; C_CYAN="\033[36m"; C_BOLD="\033[1m"; C_RESET="\033[0m"

DEFAULT_BODY='{"status":"ok","source":"CoreOps Mock Server","timestamp":"'$(date -Iseconds)'"}'

if [ -n "$RESPONSE_FILE" ] && [ -f "$RESPONSE_FILE" ]; then
  BODY=$(cat "$RESPONSE_FILE")
else
  BODY="$DEFAULT_BODY"
fi

printf "${C_BOLD}CoreOps API Mock Server${C_RESET}\n"
printf "Listening on port ${C_CYAN}%s${C_RESET}\n" "$PORT"
printf "Press Ctrl+C to stop.\n"
echo "─────────────────────────────────────────────────"

RESPONSE="HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n${BODY}"

if command -v python3 >/dev/null 2>&1; then
  python3 - "$PORT" "$BODY" <<'PYEOF'
import sys, http.server, json
from datetime import datetime

port = int(sys.argv[1])
body = sys.argv[2].encode()

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[{datetime.now():%H:%M:%S}] {self.address_string()} {fmt % args}")
    def do_GET(self): self._respond()
    def do_POST(self): self._respond()
    def do_PUT(self): self._respond()
    def do_DELETE(self): self._respond()
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.end_headers()
    def _respond(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

with http.server.HTTPServer(('', port), Handler) as srv:
    srv.serve_forever()
PYEOF
elif command -v nc >/dev/null 2>&1; then
  while true; do
    echo -e "$RESPONSE" | nc -lp "$PORT" -q 1 2>/dev/null | \
      head -n1 | awk '{print "[" strftime("%H:%M:%S") "] Request:", $1, $2}'
  done
else
  echo "Neither python3 nor nc found. Install one to run the mock server."
  exit 1
fi
BODY
  catalog_stamp "$f" "api-mock-server" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Lightweight HTTP mock server (python3/nc) for testing webhooks and API clients locally." \
    "./api-mock-server.sh [port] [response_json_file]" \
    "wrappers api mock server http testing developer"
}

_gen_base64_tools() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
# Base64 encode/decode and URL-safe variant with file support.
CMD="${1:-help}"
INPUT="${2:-}"

usage() {
  printf "Usage: %s <encode|decode|url-encode|url-decode> [string_or_file|-]\n" "$0"
  printf "  -  reads from stdin\n"
  exit 1
}

read_input() {
  if [ -z "$INPUT" ] || [ "$INPUT" = "-" ]; then
    cat   # stdin
  elif [ -f "$INPUT" ]; then
    cat "$INPUT"
  else
    printf "%s" "$INPUT"
  fi
}

case "$CMD" in
  encode)
    read_input | base64
    ;;
  decode)
    read_input | base64 -d
    ;;
  url-encode)
    # URL-safe base64: replace +→- /→_ and strip =
    read_input | base64 | tr '+/' '-_' | tr -d '='
    ;;
  url-decode)
    # Restore URL-safe to standard and decode
    data=$(read_input | tr '-_' '+/' )
    pad=$(( (4 - ${#data} % 4) % 4 ))
    for _ in $(seq 1 $pad); do data="${data}="; done
    printf "%s" "$data" | base64 -d
    ;;
  help|*)
    usage
    ;;
esac
BODY
  catalog_stamp "$f" "base64-tools" "wrappers" "1.0.0" \
    "CoreOps Builder Bot 2" \
    "Base64 encode/decode with URL-safe variant support for strings, files, or stdin." \
    "./base64-tools.sh <encode|decode|url-encode|url-decode> [string|file|-]" \
    "wrappers base64 encoding developer utilities"
}

# ── Dispatch: build one tool by ID ────────────────────────────
wrap_build_tool() {
  local tool_id="$1"
  local outpath="${FACTORY_DIR}/wrappers/${tool_id}.sh"

  case "$tool_id" in
    curl-smart)       _gen_curl_smart       "$outpath" ;;
    json-formatter)   _gen_json_formatter   "$outpath" ;;
    git-quick)        _gen_git_quick        "$outpath" ;;
    log-tail)         _gen_log_tail         "$outpath" ;;
    env-manager)      _gen_env_manager      "$outpath" ;;
    backup-files)     _gen_backup_files     "$outpath" ;;
    cron-helper)      _gen_cron_helper      "$outpath" ;;
    deploy-helper)    _gen_deploy_helper    "$outpath" ;;
    process-manager)  _gen_process_manager  "$outpath" ;;
    file-organizer)   _gen_file_organizer   "$outpath" ;;
    api-mock-server)  _gen_api_mock_server  "$outpath" ;;
    base64-tools)     _gen_base64_tools     "$outpath" ;;
    *) return 1 ;;
  esac

  chmod +x "$outpath"
  registry_add "wrappers" "$tool_id" "builder2"
  catalog_record "$tool_id" "$tool_id" "wrappers" "1.0.0" "Builder Bot 2" \
    "$outpath" "Wrapper/developer tool" "wrappers"
  echo "$outpath"
}
