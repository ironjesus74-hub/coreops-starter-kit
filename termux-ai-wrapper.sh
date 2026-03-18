#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
#  CoreOps AI Wrapper for Termux / Linux
#  AI-powered terminal assistant with agent dispatch mode.
#
#  Copy-paste install — review the script first, then run:
#    curl -fsSL https://raw.githubusercontent.com/ironjesus74-hub/coreops-starter-kit/main/termux-ai-wrapper.sh -o termux-ai-wrapper.sh
#    bash termux-ai-wrapper.sh
#  Or clone the repo and run:
#    bash ~/coreops-starter-kit/termux-ai-wrapper.sh
#
#  Configure:
#    export AI_API_KEY="sk-..."          # any OpenAI-compat key
#    export AI_API_URL="https://..."     # default: api.openai.com/v1
#    export AI_MODEL="gpt-4o-mini"       # default model
#    export ATLAS_URL="https://yoursite" # use CoreOps Atlas backend
# =============================================================
# shellcheck disable=SC2155,SC2162

# ── Bash compat guard ───────────────────────────────────────
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "ERROR: bash 4+ required (your version: ${BASH_VERSION:-?})"
  echo "Termux: pkg install bash"
  exit 1
fi

set -uo pipefail

# ── Colors & icons ──────────────────────────────────────────
R="\033[0m"; BOLD="\033[1m"; DIM="\033[2m"; UL="\033[4m"
CYAN="\033[38;5;51m"; NEON="\033[38;5;46m"; AMBER="\033[38;5;214m"
RED="\033[38;5;196m"; GRAY="\033[38;5;245m"; BLUE="\033[38;5;39m"
PURPLE="\033[38;5;135m"; WHITE="\033[38;5;255m"
OK="✔"; WARN="⚠"; ERR="✖"; INFO="ℹ"; BOLT="⚡"; BOT="🤖"
THINK="…"; PROMPT_ICON="❯"

say()    { echo -e "${CYAN}${INFO}${R} $*"; }
ok()     { echo -e "${NEON}${OK}${R} $*"; }
warn()   { echo -e "${AMBER}${WARN}${R} $*"; }
err()    { echo -e "${RED}${ERR}${R} $*" >&2; }
ai_say() { echo -e "${PURPLE}${BOT}${R} $*"; }

# ── Dependency check ─────────────────────────────────────────
_require() {
  command -v "$1" >/dev/null 2>&1 || {
    err "Required tool not found: $1"
    if [ -n "${PREFIX:-}" ]; then
      err "Install with: pkg install $1"
    else
      err "Install with: sudo apt install $1"
    fi
    exit 1
  }
}
_require curl
_require jq

# ── Configuration ────────────────────────────────────────────
# Priority: ATLAS_URL (CoreOps backend) > AI_API_URL + AI_API_KEY (direct OpenAI-compat)
ATLAS_URL="${ATLAS_URL:-}"
AI_API_KEY="${AI_API_KEY:-${OPENAI_API_KEY:-}}"
AI_API_URL="${AI_API_URL:-https://api.openai.com/v1}"
AI_MODEL="${AI_MODEL:-gpt-4o-mini}"
AI_TIMEOUT="${AI_TIMEOUT:-30}"

# Detect CoreOps install (for Atlas backend)
COREOPS_HOME="${COREOPS_HOME:-}"
if [ -z "$COREOPS_HOME" ]; then
  _script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [ -f "${_script_dir}/bin/coreops" ] && COREOPS_HOME="$_script_dir"
fi

# Try to read ATLAS_URL from wrangler.toml if present
if [ -z "$ATLAS_URL" ] && [ -n "$COREOPS_HOME" ] && [ -f "${COREOPS_HOME}/wrangler.toml" ]; then
  _routes_url=$(grep -A2 'routes' "${COREOPS_HOME}/wrangler.toml" 2>/dev/null | grep 'pattern' | head -1 | sed 's/.*pattern\s*=\s*"\(.*\)".*/\1/' | sed 's/\/.*//' || true)
  [ -n "$_routes_url" ] && ATLAS_URL="https://${_routes_url}"
fi

# Determine AI mode
AI_USE_ATLAS=0
if [ -n "$ATLAS_URL" ]; then
  AI_USE_ATLAS=1
elif [ -z "$AI_API_KEY" ]; then
  warn "No AI key configured."
  say  "Set one of:"
  say  "  export AI_API_KEY='sk-...'     # OpenAI or compatible"
  say  "  export ATLAS_URL='https://yoursite.com'  # CoreOps Atlas"
  echo ""
  say  "You can still use local commands. Type /help for all options."
  echo ""
fi

# ── History & state ──────────────────────────────────────────
declare -a MSG_HISTORY=()  # accumulates {"role":..,"content":..} JSON
MAX_HISTORY=20             # keep last N exchanges to avoid context bloat
SESSION_LOG="${TMPDIR:-/tmp}/coreops-ai-session-$$.log"
AGENT_MODE=0               # 1 = AI may suggest & run shell commands
VERBOSE_MODE=0
AUTO_RUN=0                 # auto-exec AI-suggested commands without asking

SYSTEM_PROMPT='You are CoreOps AI, an expert terminal assistant embedded inside
Termux / Linux. You help developers debug, fix, and automate their environment.

Key behaviors:
- Be concise and direct. Prefer working code/commands over long explanations.
- When asked to fix something, output the fix as a shell command block fenced ```bash ... ```.
- When asked to create a file, output the full file contents fenced with the file path on the first line.
- Understand Termux quirks: no /etc, PREFIX=/data/data/com.termux/files/usr, pkg not apt.
- Detect whether user is on Termux or standard Linux and adapt accordingly.
- For package errors: check mirrors first, then package name differences.
- For website deployment: prefer Cloudflare Pages/Workers for zero-config deploys.
- Agent mode: when AGENT MODE is ON you may propose shell commands to run. Wrap each in ```bash ... ``` and they will be offered to the user for execution.
- Never run destructive commands (rm -rf /, format, etc.) without explicit confirmation.
- You have access to the CoreOps toolkit: coreops audit, netcheck, sslcheck, scan, snapshot, live, bots.'

# ── JSON helpers ─────────────────────────────────────────────
_json_escape() {
  # Escape a string for safe JSON embedding.
  # Requires python3 (always present on Termux/Debian).
  # Fallback sed is provided but may not handle control characters or unicode
  # correctly — ensure python3 is installed for production use.
  printf '%s' "$1" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null \
    || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/g' | tr -d '\n' | sed 's/\\n$//'
}

_build_messages_json() {
  # Build the full messages array including system + history + new user msg
  local user_msg="$1"
  local escaped_sys; escaped_sys=$(_json_escape "$SYSTEM_PROMPT")
  local escaped_user; escaped_user=$(_json_escape "$user_msg")

  local msgs="[{\"role\":\"system\",\"content\":${escaped_sys}}"

  # Append history (capped)
  local hist_count=${#MSG_HISTORY[@]}
  local start=0
  if [ "$hist_count" -gt "$MAX_HISTORY" ]; then
    start=$(( hist_count - MAX_HISTORY ))
  fi
  for (( i=start; i<hist_count; i++ )); do
    msgs+=",${MSG_HISTORY[$i]}"
  done

  msgs+=",{\"role\":\"user\",\"content\":${escaped_user}}]"
  echo "$msgs"
}

# ── AI call: Atlas backend ───────────────────────────────────
_call_atlas() {
  local user_msg="$1"
  local messages; messages=$(_build_messages_json "$user_msg")

  local payload; payload=$(jq -cn \
    --argjson messages "$messages" \
    --arg model "$AI_MODEL" \
    '{messages: $messages, model: $model}')

  local response; response=$(curl -s \
    --max-time "$AI_TIMEOUT" \
    -X POST "${ATLAS_URL}/api/atlas" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null)

  # Atlas returns {reply: "..."} or {message: "..."}
  local content
  content=$(echo "$response" | jq -r '.reply // .message // .content // .choices[0].message.content // empty' 2>/dev/null)
  echo "$content"
}

# ── AI call: OpenAI-compat direct ────────────────────────────
_call_openai() {
  local user_msg="$1"
  local messages; messages=$(_build_messages_json "$user_msg")

  local payload; payload=$(jq -cn \
    --argjson messages "$messages" \
    --arg model "$AI_MODEL" \
    '{model: $model, messages: $messages, max_tokens: 1500, temperature: 0.3}')

  local response; response=$(curl -s \
    --max-time "$AI_TIMEOUT" \
    -X POST "${AI_API_URL}/chat/completions" \
    -H "Authorization: Bearer ${AI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null)

  local content
  content=$(echo "$response" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
  echo "$content"
}

# ── Main AI dispatch ─────────────────────────────────────────
ask_ai() {
  local user_msg="$1"
  local reply=""

  # Show thinking indicator
  echo -ne "${DIM}${THINK} thinking…${R}" >&2

  if [ "$AI_USE_ATLAS" -eq 1 ]; then
    reply=$(_call_atlas "$user_msg")
  elif [ -n "$AI_API_KEY" ]; then
    reply=$(_call_openai "$user_msg")
  else
    echo -e "\r${AMBER}${WARN}${R} No AI backend configured. Use /config to set one."
    return 1
  fi

  # Clear thinking indicator
  echo -ne "\r\033[K" >&2

  if [ -z "$reply" ]; then
    err "No response from AI. Check your API key/URL."
    return 1
  fi

  # Store in history
  local escaped_user; escaped_user=$(_json_escape "$user_msg")
  local escaped_reply; escaped_reply=$(_json_escape "$reply")
  MSG_HISTORY+=("{\"role\":\"user\",\"content\":${escaped_user}}")
  MSG_HISTORY+=("{\"role\":\"assistant\",\"content\":${escaped_reply}}")

  echo "$reply"
}

# ── Render AI response with syntax highlighting ───────────────
render_response() {
  local text="$1"
  local in_block=0
  local block_lang=""

  while IFS= read -r line; do
    if [[ "$line" =~ ^'```'(.*)$ ]]; then
      if [ "$in_block" -eq 0 ]; then
        in_block=1
        block_lang="${BASH_REMATCH[1]}"
        echo -e "${AMBER}┌─ ${block_lang:-code} ─${R}"
      else
        in_block=0
        echo -e "${AMBER}└────────────${R}"
      fi
    elif [ "$in_block" -eq 1 ]; then
      echo -e "${NEON}│${R} ${line}"
    else
      # Inline code `backtick`
      local rendered="$line"
      rendered=$(echo "$rendered" | sed "s/\`\([^\`]*\)\`/${CYAN}\1${R}/g")
      echo -e "${PURPLE}${BOT}${R} ${rendered}"
    fi
  done <<< "$text"
}

# ── Extract & optionally run code blocks ─────────────────────
extract_and_run_blocks() {
  local text="$1"
  local in_block=0
  local block=""
  local block_num=0

  while IFS= read -r line; do
    if [[ "$line" =~ ^'```'(bash|sh|shell)? ]] && [ "$in_block" -eq 0 ]; then
      in_block=1
      block=""
    elif [[ "$line" == '```' ]] && [ "$in_block" -eq 1 ]; then
      in_block=0
      block_num=$(( block_num + 1 ))
      if [ -n "$block" ]; then
        echo ""
        echo -e "${AMBER}${BOLT} Agent suggests running block #${block_num}:${R}"
        echo -e "${GRAY}$(printf '─%.0s' {1..50})${R}"
        echo -e "${NEON}${block}${R}"
        echo -e "${GRAY}$(printf '─%.0s' {1..50})${R}"

        if [ "$AUTO_RUN" -eq 1 ]; then
          # WARNING: AUTO_RUN executes AI-generated code without confirmation.
          # Only enable if you fully trust the AI responses and understand the risks.
          echo -e "${AMBER}${WARN} AUTO-RUN: executing...${R}"
          _run_block "$block"
        else
          echo -ne "${CYAN}Run this? [y/N/e(dit)] ${R}"
          read -r choice </dev/tty
          case "${choice,,}" in
            y|yes)
              _run_block "$block"
              ;;
            e|edit)
              local tmpf; tmpf=$(mktemp /tmp/coreops-agent-XXXX.sh)
              echo "$block" > "$tmpf"
              ${EDITOR:-nano} "$tmpf" </dev/tty >/dev/tty
              _run_block "$(cat "$tmpf")"
              rm -f "$tmpf"
              ;;
            *)
              say "Skipped."
              ;;
          esac
        fi
      fi
    elif [ "$in_block" -eq 1 ]; then
      block+="${line}"$'\n'
    fi
  done <<< "$text"
}

_run_block() {
  local code="$1"
  echo -e "${GRAY}── output ────────────────────────────────────${R}"
  # Write to a tmp file and source in a subshell for safety
  local tmpf; tmpf=$(mktemp /tmp/coreops-run-XXXX.sh)
  printf '%s\n' "$code" > "$tmpf"
  chmod +x "$tmpf"
  bash "$tmpf" </dev/tty 2>&1 | head -200 || true
  local exit_code=$?
  rm -f "$tmpf"
  echo -e "${GRAY}─────────────────────────────────────────────${R}"
  [ "$exit_code" -eq 0 ] && ok "Command completed (exit 0)" \
    || warn "Exit code: ${exit_code}"
}

# ── Built-in commands ─────────────────────────────────────────
cmd_help() {
  echo -e "${BOLD}${CYAN}CoreOps AI Wrapper${R} — Command Reference"
  echo -e "${GRAY}$(printf '─%.0s' {1..55})${R}"
  printf "  ${CYAN}%-24s${R}%s\n" "/help"          "Show this help"
  printf "  ${CYAN}%-24s${R}%s\n" "/clear"         "Clear conversation history"
  printf "  ${CYAN}%-24s${R}%s\n" "/agent [on|off]" "Toggle AI agent mode (can run commands)"
  printf "  ${CYAN}%-24s${R}%s\n" "/autorun [on|off]" "Auto-execute agent commands without asking"
  printf "  ${CYAN}%-24s${R}%s\n" "/config"        "Show current AI configuration"
  printf "  ${CYAN}%-24s${R}%s\n" "/key <key>"     "Set AI API key for this session"
  printf "  ${CYAN}%-24s${R}%s\n" "/model <name>"  "Switch AI model (e.g. gpt-4o, claude-3-haiku)"
  printf "  ${CYAN}%-24s${R}%s\n" "/fix"           "Run automated env diagnostics + AI fix"
  printf "  ${CYAN}%-24s${R}%s\n" "/mirror"        "Re-run mirror optimizer"
  printf "  ${CYAN}%-24s${R}%s\n" "/pkg <name>"    "Ask AI for best way to install a package"
  printf "  ${CYAN}%-24s${R}%s\n" "/deploy"        "Ask AI to help deploy your site"
  printf "  ${CYAN}%-24s${R}%s\n" "/task <desc>"   "Dispatch AI agent to complete a task"
  printf "  ${CYAN}%-24s${R}%s\n" "/run <cmd>"     "Run a shell command and show output"
  printf "  ${CYAN}%-24s${R}%s\n" "/history"       "Show conversation history"
  printf "  ${CYAN}%-24s${R}%s\n" "/log"           "Show session log path"
  printf "  ${CYAN}%-24s${R}%s\n" "/exit | /quit"  "Exit the wrapper"
  echo ""
  echo -e "  ${DIM}Just type naturally to chat with AI.${R}"
  echo -e "  ${DIM}Agent mode lets AI write and optionally run scripts.${R}"
  echo ""
}

cmd_config() {
  echo -e "${BOLD}${CYAN}Current Configuration${R}"
  echo -e "${GRAY}$(printf '─%.0s' {1..45})${R}"
  if [ "$AI_USE_ATLAS" -eq 1 ]; then
    echo -e "  Backend   : ${NEON}CoreOps Atlas${R} → ${ATLAS_URL}/api/atlas"
  elif [ -n "$AI_API_KEY" ]; then
    local key_preview="${AI_API_KEY:0:8}…"
    echo -e "  Backend   : ${NEON}OpenAI-compat${R} → ${AI_API_URL}"
    echo -e "  API Key   : ${AMBER}${key_preview}${R}"
  else
    echo -e "  Backend   : ${RED}NOT CONFIGURED${R}"
  fi
  echo -e "  Model     : ${CYAN}${AI_MODEL}${R}"
  echo -e "  Agent Mode: $([ "$AGENT_MODE" -eq 1 ] && echo "${NEON}ON${R}" || echo "${GRAY}off${R}")"
  echo -e "  Auto-Run  : $([ "$AUTO_RUN" -eq 1 ] && echo "${AMBER}ON (careful!)${R}" || echo "${GRAY}off${R}")"
  echo -e "  History   : ${#MSG_HISTORY[@]} messages"
  echo -e "  Log       : ${DIM}${SESSION_LOG}${R}"
  echo ""
}

cmd_fix() {
  hdr_mini "Running environment diagnostics…"

  local issues=""
  local ctx=""

  # Gather system context
  ctx+="OS: $(uname -a)\n"
  ctx+="Shell: $BASH_VERSION\n"
  ctx+="Termux: $([ -n "${PREFIX:-}" ] && echo "YES (PREFIX=$PREFIX)" || echo "no")\n"

  # Check DNS
  if ! host -t A google.com >/dev/null 2>&1 && ! curl -sf https://1.1.1.1 >/dev/null 2>&1; then
    issues+="- DNS resolution failing\n"
    say "DNS: FAIL"
  else
    ok "DNS: OK"
  fi

  # Check package manager
  if [ -n "${PREFIX:-}" ]; then
    if ! pkg list-installed >/dev/null 2>&1; then
      issues+="- pkg database seems corrupt\n"
    fi
    # Check SSL
    if ! curl -sf https://github.com >/dev/null 2>&1; then
      issues+="- HTTPS/SSL handshake failing (possible CA cert issue)\n"
    else
      ok "HTTPS: OK"
    fi
  fi

  # Check disk space
  local disk_usage; disk_usage=$(df -h "${HOME}" 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
  if [ "${disk_usage:-0}" -gt 90 ] 2>/dev/null; then
    issues+="- Disk usage high: ${disk_usage}%\n"
    warn "Disk: ${disk_usage}% used"
  else
    ok "Disk: ${disk_usage:-?}% used"
  fi

  if [ -z "$issues" ]; then
    ok "No obvious issues detected!"
    issues="(all basic checks passed)"
  fi

  echo ""
  local prompt="My Termux/Linux environment has these issues:\n${issues}\nSystem info:\n${ctx}\nWhat's the quickest fix for each issue? Give me exact commands."

  local reply; reply=$(ask_ai "$prompt")
  echo ""
  render_response "$reply"
  [ "$AGENT_MODE" -eq 1 ] && extract_and_run_blocks "$reply"
  log_to_session "AUTO-FIX" "$prompt" "$reply"
}

cmd_mirror() {
  local setup_script=""
  if [ -n "$COREOPS_HOME" ] && [ -f "${COREOPS_HOME}/scripts/termux-setup.sh" ]; then
    setup_script="${COREOPS_HOME}/scripts/termux-setup.sh"
  elif [ -f "${HOME}/coreops-starter-kit/scripts/termux-setup.sh" ]; then
    setup_script="${HOME}/coreops-starter-kit/scripts/termux-setup.sh"
  fi

  if [ -n "$setup_script" ]; then
    bash "$setup_script" --minimal
  elif [ -n "${PREFIX:-}" ]; then
    say "Running Termux mirror optimization…"
    pkg update -y 2>&1 | tail -5
    ok "Done"
  else
    say "Running apt mirror update…"
    local SUDO=""
    if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
      SUDO="sudo"
    fi
    $SUDO apt-get update -qq && ok "Done"
  fi
}

cmd_task() {
  local task_desc="$*"
  if [ -z "$task_desc" ]; then
    echo -ne "${CYAN}Describe the task: ${R}"
    read -r task_desc </dev/tty
  fi
  [ -z "$task_desc" ] && return

  local old_agent="$AGENT_MODE"
  AGENT_MODE=1  # always enable for tasks

  echo ""
  echo -e "${BOLD}${PURPLE}${BOT} Dispatching agent for: ${task_desc}${R}"
  echo -e "${GRAY}$(printf '─%.0s' {1..55})${R}"

  local prompt="AGENT TASK: ${task_desc}

You are in agent mode. Break this task into steps. For each step that requires running a command, provide a ```bash ... ``` block. Be thorough and give working, tested commands for Termux/Linux. If you need to create files, show their full contents."

  local reply; reply=$(ask_ai "$prompt")
  echo ""
  render_response "$reply"
  extract_and_run_blocks "$reply"
  log_to_session "AGENT-TASK" "$prompt" "$reply"

  AGENT_MODE="$old_agent"
}

cmd_deploy() {
  echo -e "${BOLD}${CYAN}Deploy Helper${R}"
  echo ""
  echo -ne "${CYAN}What are you deploying? (e.g. 'static site to Cloudflare Pages'): ${R}"
  read -r deploy_desc </dev/tty
  [ -z "$deploy_desc" ] && return

  local ctx=""
  [ -n "$COREOPS_HOME" ] && ctx+="Project uses CoreOps starter kit (Cloudflare Pages + Workers). "
  [ -f "${COREOPS_HOME:-}/wrangler.toml" ] && ctx+="wrangler.toml present. "

  local prompt="I want to deploy: ${deploy_desc}. ${ctx}Give me exact step-by-step commands. Use Wrangler CLI where appropriate. Assume I'm on Termux/Linux."
  local reply; reply=$(ask_ai "$prompt")
  echo ""
  render_response "$reply"
  [ "$AGENT_MODE" -eq 1 ] && extract_and_run_blocks "$reply"
  log_to_session "DEPLOY" "$prompt" "$reply"
}

cmd_pkg() {
  local pkg_name="$1"
  if [ -z "$pkg_name" ]; then
    echo -ne "${CYAN}Package name: ${R}"
    read -r pkg_name </dev/tty
  fi
  [ -z "$pkg_name" ] && return

  local env_info; env_info=$([ -n "${PREFIX:-}" ] && echo "Termux Android" || echo "Debian/Ubuntu Linux")
  local prompt="On ${env_info}, what is the best way to install '${pkg_name}'? Include: exact pkg/apt command, any common naming differences, post-install setup steps, and how to verify it works."
  local reply; reply=$(ask_ai "$prompt")
  echo ""
  render_response "$reply"
  [ "$AGENT_MODE" -eq 1 ] && extract_and_run_blocks "$reply"
}

cmd_run() {
  local shell_cmd="$*"
  if [ -z "$shell_cmd" ]; then
    echo -ne "${CYAN}Command: ${R}"
    read -r shell_cmd </dev/tty
  fi
  [ -z "$shell_cmd" ] && return

  # Execute via a temp file rather than eval to avoid word-splitting surprises.
  # NOTE: /run executes arbitrary shell commands — use only with commands you trust.
  echo -e "${GRAY}── output ─────────────────────────────────────${R}"
  local tmpf; tmpf=$(mktemp /tmp/coreops-run-XXXX.sh)
  printf '#!/usr/bin/env bash\n%s\n' "$shell_cmd" > "$tmpf"
  chmod +x "$tmpf"
  bash "$tmpf" </dev/tty 2>&1 || true
  rm -f "$tmpf"
  echo -e "${GRAY}───────────────────────────────────────────────${R}"
}

cmd_history() {
  local count=${#MSG_HISTORY[@]}
  if [ "$count" -eq 0 ]; then
    say "No conversation history yet."
    return
  fi
  echo -e "${BOLD}${CYAN}Conversation History (${count} messages)${R}"
  echo -e "${GRAY}$(printf '─%.0s' {1..50})${R}"
  for (( i=0; i<count; i++ )); do
    local entry="${MSG_HISTORY[$i]}"
    local role; role=$(echo "$entry" | jq -r '.role' 2>/dev/null)
    local content; content=$(echo "$entry" | jq -r '.content' 2>/dev/null | head -c 200)
    if [ "$role" = "user" ]; then
      echo -e "  ${CYAN}You${R}: ${content}…"
    elif [ "$role" = "assistant" ]; then
      echo -e "  ${PURPLE}AI${R}: ${content}…"
    fi
  done
  echo ""
}

# ── Logging ──────────────────────────────────────────────────
log_to_session() {
  local label="$1" question="$2" answer="$3"
  {
    echo "=== $(date) [${label}] ==="
    echo "Q: $question"
    echo "A: $answer"
    echo ""
  } >> "$SESSION_LOG" 2>/dev/null || true
}

# ── Helper ───────────────────────────────────────────────────
hdr_mini() {
  echo -e "\n${BOLD}${CYAN}${BOLT} $*${R}"
  echo -e "${GRAY}$(printf '─%.0s' {1..45})${R}"
}

# ── Banner ──────────────────────────────────────────────────
print_banner() {
  clear 2>/dev/null || true
  echo -e "${BOLD}${CYAN}"
  cat <<'BANNER'
  ╔═══════════════════════════════════════════╗
  ║   CoreOps AI Wrapper  ⚡  v2.0            ║
  ║   AI-powered terminal  •  Agent dispatch  ║
  ╚═══════════════════════════════════════════╝
BANNER
  echo -e "${R}"

  if [ "$AI_USE_ATLAS" -eq 1 ]; then
    ok "Backend: CoreOps Atlas → ${ATLAS_URL}"
  elif [ -n "$AI_API_KEY" ]; then
    ok "Backend: OpenAI-compat (${AI_MODEL})"
  else
    warn "No AI backend configured — run /config or set AI_API_KEY"
  fi

  echo -e " ${DIM}Type ${CYAN}/help${R}${DIM} for all commands or just start chatting.${R}"
  echo -e " ${DIM}Agent mode: ${AMBER}/agent on${R}${DIM} → AI can write & run scripts for you.${R}"
  echo ""
}

# ── Input prompt ─────────────────────────────────────────────
_prompt() {
  local agent_indicator=""
  [ "$AGENT_MODE" -eq 1 ] && agent_indicator="${AMBER}[AGENT]${R} "
  echo -ne "${NEON}${PROMPT_ICON}${R} ${agent_indicator}${WHITE}"
}

# ── REPL ─────────────────────────────────────────────────────
repl() {
  print_banner

  while true; do
    _prompt
    read -r input </dev/tty || { echo ""; break; }
    echo -ne "${R}"

    # Trim whitespace
    input="${input#"${input%%[![:space:]]*}"}"
    input="${input%"${input##*[![:space:]]}"}"
    [ -z "$input" ] && continue

    case "$input" in
      /exit|/quit|/q)
        echo ""
        ok "Session ended. Log saved: ${SESSION_LOG}"
        break
        ;;
      /help)
        cmd_help
        ;;
      /clear)
        MSG_HISTORY=()
        ok "Conversation history cleared."
        ;;
      /agent|"/agent on")
        AGENT_MODE=1
        ok "Agent mode ON — AI can suggest and run shell commands."
        ;;
      "/agent off")
        AGENT_MODE=0
        ok "Agent mode OFF."
        ;;
      /autorun|"/autorun on")
        AUTO_RUN=1
        warn "Auto-run ON — AI commands will execute without confirmation!"
        ;;
      "/autorun off")
        AUTO_RUN=0
        ok "Auto-run OFF."
        ;;
      /config)
        cmd_config
        ;;
      /key\ *)
        AI_API_KEY="${input#/key }"
        AI_USE_ATLAS=0
        ok "API key set for this session."
        ;;
      /model\ *)
        AI_MODEL="${input#/model }"
        ok "Model set to: ${AI_MODEL}"
        ;;
      /fix)
        cmd_fix
        ;;
      /mirror)
        cmd_mirror
        ;;
      /pkg\ *)
        cmd_pkg "${input#/pkg }"
        ;;
      /pkg)
        cmd_pkg ""
        ;;
      /deploy)
        cmd_deploy
        ;;
      /task\ *)
        cmd_task "${input#/task }"
        ;;
      /task)
        cmd_task ""
        ;;
      /run\ *)
        cmd_run "${input#/run }"
        ;;
      /run)
        cmd_run ""
        ;;
      /history)
        cmd_history
        ;;
      /log)
        say "Session log: ${SESSION_LOG}"
        ;;
      /verbose|"/verbose on")
        VERBOSE_MODE=1; ok "Verbose mode ON"
        ;;
      "/verbose off")
        VERBOSE_MODE=0; ok "Verbose mode OFF"
        ;;
      /*)
        err "Unknown command: ${input}. Type /help for a list."
        ;;
      *)
        # Regular chat
        echo ""
        local reply; reply=$(ask_ai "$input") || continue
        echo ""
        render_response "$reply"
        [ "$AGENT_MODE" -eq 1 ] && extract_and_run_blocks "$reply"
        log_to_session "CHAT" "$input" "$reply"
        echo ""
        ;;
    esac
  done
}

# ── Non-interactive mode (pipe / single-shot) ─────────────────
_single_shot() {
  local prompt="$*"
  local reply; reply=$(ask_ai "$prompt")
  if [ -n "$reply" ]; then
    render_response "$reply"
    [ "$AGENT_MODE" -eq 1 ] && extract_and_run_blocks "$reply"
  fi
}

# ── Entry point ──────────────────────────────────────────────
if [ -p /dev/stdin ] || [ ! -t 0 ]; then
  # Piped input: ai single-shot
  piped_input=$(cat)
  _single_shot "$piped_input"
elif [ $# -gt 0 ]; then
  # Args: `ai "do this"` or `ai /task "do this"` or flag variants
  if [[ "$1" == /task* ]]; then
    AGENT_MODE=1
    cmd_task "${*#/task }"
  elif [[ "$1" == --task ]]; then
    AGENT_MODE=1
    shift
    cmd_task "$*"
  elif [[ "$1" == /fix || "$1" == --fix ]]; then
    cmd_fix
  elif [[ "$1" == /agent && "${2:-}" == on ]]; then
    AGENT_MODE=1
    shift 2
    [ $# -gt 0 ] && cmd_task "$*" || repl
  elif [[ "$1" == --agent ]]; then
    AGENT_MODE=1
    shift
    [ $# -gt 0 ] && cmd_task "$*" || repl
  else
    _single_shot "$*"
  fi
else
  # Interactive REPL
  repl
fi
