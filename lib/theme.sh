#!/usr/bin/env bash
# CoreOps Hybrid Theme: enterprise-clean + neon edge
# All variables are exported for use in sourcing scripts.
# shellcheck disable=SC2034  # Variables are intentionally used via `source`

C_RESET="\033[0m"
C_DIM="\033[2m"
C_BOLD="\033[1m"

C_NEON="\033[38;5;46m"     # neon green
C_CYAN="\033[38;5;51m"     # cyan
C_AMBER="\033[38;5;214m"   # amber
C_RED="\033[38;5;196m"     # red
C_GRAY="\033[38;5;245m"    # gray
C_WHITE="\033[38;5;255m"   # white
C_BLUE="\033[38;5;39m"     # blue

I_OK="✔"
I_WARN="⚠"
I_ERR="✖"
I_INFO="ℹ"
I_BOLT="⚡"
I_ARROW="→"
I_DOT="·"

banner() {
  echo -e "${C_CYAN}${C_BOLD}${I_BOLT} CoreOps${C_RESET} ${C_DIM}Command Center${C_RESET}"
  echo -e "${C_GRAY}────────────────────────────────${C_RESET}"
}
