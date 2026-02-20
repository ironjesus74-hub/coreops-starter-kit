#!/data/data/com.termux/files/usr/bin/bash

# CoreOps Hybrid Theme: enterprise-clean + neon edge
C_RESET="\033[0m"
C_DIM="\033[2m"
C_BOLD="\033[1m"

C_NEON="\033[38;5;46m"     # neon green
C_CYAN="\033[38;5;51m"     # cyan
C_AMBER="\033[38;5;214m"   # amber
C_RED="\033[38;5;196m"     # red
C_GRAY="\033[38;5;245m"    # gray

I_OK="✔"
I_WARN="⚠"
I_ERR="✖"
I_INFO="ℹ"
I_BOLT="⚡"

banner() {
  echo -e "${C_CYAN}${C_BOLD}${I_BOLT} CoreOps${C_RESET} ${C_DIM}Command Center${C_RESET}"
  echo -e "${C_GRAY}────────────────────────────────${C_RESET}"
}
