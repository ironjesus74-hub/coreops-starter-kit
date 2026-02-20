#!/data/data/com.termux/files/usr/bin/bash
# shellcheck source=lib/theme.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/theme.sh"

log_info()    { echo -e "${C_CYAN}${I_INFO} ${C_RESET}$1"; }
log_warn()    { echo -e "${C_AMBER}${I_WARN} ${C_RESET}$1"; }
log_error()   { echo -e "${C_RED}${I_ERR} ${C_RESET}$1"; }
log_success() { echo -e "${C_NEON}${I_OK} ${C_RESET}$1"; }
log_ok() { log_success "$1"; }
