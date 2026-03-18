#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps — Termux / Debian Environment Setup & Optimizer
# Copy-paste friendly. Run once to get a clean, fast env.
# Works on: Termux (Android), Debian, Ubuntu, and derivatives.
# Usage: bash termux-setup.sh [--debian] [--minimal] [--dev]
# =============================================================
set -uo pipefail

# ── Colors ──────────────────────────────────────────────────
R="\033[0m"; BOLD="\033[1m"; DIM="\033[2m"
CYAN="\033[38;5;51m"; NEON="\033[38;5;46m"
AMBER="\033[38;5;214m"; RED="\033[38;5;196m"
GRAY="\033[38;5;245m"; BLUE="\033[38;5;39m"
OK="✔"; WARN="⚠"; ERR="✖"; INFO="ℹ"; BOLT="⚡"

say()  { echo -e "${CYAN}${INFO}${R} $*"; }
ok()   { echo -e "${NEON}${OK}${R} $*"; }
warn() { echo -e "${AMBER}${WARN}${R} $*"; }
err()  { echo -e "${RED}${ERR}${R} $*" >&2; }
die()  { err "$*"; exit 1; }
hdr()  { echo -e "\n${BOLD}${CYAN}${BOLT} $*${R}\n${GRAY}$(printf '─%.0s' {1..50})${R}"; }

# ── Parse args ──────────────────────────────────────────────
MODE_DEBIAN=0; MODE_MINIMAL=0; MODE_DEV=0
for arg in "$@"; do
  case "$arg" in
    --debian)  MODE_DEBIAN=1 ;;
    --minimal) MODE_MINIMAL=1 ;;
    --dev)     MODE_DEV=1 ;;
    -h|--help)
      echo "Usage: bash termux-setup.sh [--debian] [--minimal] [--dev]"
      echo "  (no flag)   Auto-detect Termux or Debian"
      echo "  --debian    Force Debian/Ubuntu mode"
      echo "  --minimal   Core tools only, skip dev stack"
      echo "  --dev       Install full dev stack (Node, Python, Go...)"
      exit 0 ;;
  esac
done

# ── Detect environment ───────────────────────────────────────
IS_TERMUX=0; IS_DEBIAN=0
[ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *termux* ]] && IS_TERMUX=1
[ -f /etc/debian_version ] && IS_DEBIAN=1
[ "$MODE_DEBIAN" -eq 1 ] && IS_DEBIAN=1 && IS_TERMUX=0

if [ "$IS_TERMUX" -eq 0 ] && [ "$IS_DEBIAN" -eq 0 ]; then
  warn "Environment not detected as Termux or Debian. Continuing anyway..."
  IS_DEBIAN=1
fi

# ── Banner ──────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
cat <<'BANNER'
   _____               ____            
  / ____|             / __ \           
 | |     ___  _ __ __| |  | |_ __  ___ 
 | |    / _ \| '__/ _ \ |  | | '_ \/ __|
 | |___| (_) | | |  __/ |__| | |_) \__ \
  \_____\___/|_|  \___|\____/| .__/|___/
                              | |       
  Termux / Debian Optimizer   |_|  v2.0
BANNER
echo -e "${R}"
say "Starting environment setup…"
echo ""

# ── Termux: storage permission ───────────────────────────────
setup_termux_storage() {
  hdr "Termux Storage Access"
  if [ ! -d ~/storage ]; then
    say "Requesting Termux storage permission..."
    termux-setup-storage
    sleep 2
    ok "Storage setup done (~/storage/shared → internal storage)"
  else
    ok "Storage already set up"
  fi
}

# ── Termux: best mirror selection ──────────────────────────
setup_termux_mirrors() {
  hdr "Termux Mirror Optimization"

  # Use termux-change-repo if available (preferred)
  if command -v termux-change-repo >/dev/null 2>&1; then
    say "Using termux-change-repo to find fastest mirror..."
    # Default to Grimler: it is the official Termux-maintained CDN mirror with
    # global PoPs. The manual benchmark fallback below will still pick the
    # fastest if termux-change-repo is unavailable.
    termux-change-repo <<'EOF' 2>/dev/null || true
Single Mirror
Grimler
EOF
    ok "Mirror set to Grimler (official Termux CDN)"
    return
  fi

  # Manual fallback: write sources.list directly
  local sources_dir="${PREFIX}/etc/apt/sources.list.d"
  local sources_main="${PREFIX}/etc/apt/sources.list"

  say "Selecting fastest Termux mirror…"

  # Test response times for top mirrors
  declare -A MIRRORS
  MIRRORS["grimler"]="https://grimler.se/termux-packages-24"
  MIRRORS["linode"]="https://linode-sin.termux.dev/termux-packages-24"
  MIRRORS["a2hosting"]="https://termux.a2hosting.com/termux-packages-24"

  best_url=""; best_time=9999
  for name in "${!MIRRORS[@]}"; do
    url="${MIRRORS[$name]}"
    t=$(curl -o /dev/null -s -w "%{time_total}" --max-time 5 "${url}/dists/stable/Release" 2>/dev/null || echo "9999")
    t_int=$(echo "$t" | awk '{printf "%d", $1 * 1000}')
    say "  ${name}: ${t}s"
    if [ "$t_int" -lt "$best_time" ]; then
      best_time=$t_int
      best_url="${url}"
      best_name="$name"
    fi
  done

  if [ -n "$best_url" ]; then
    cat > "$sources_main" <<EOF
deb ${best_url} stable main
EOF
    ok "Mirror set to ${best_name} (${best_time}ms) → ${best_url}"
  else
    warn "Could not reach any mirrors — keeping existing sources.list"
  fi
}

# ── Debian: best mirror selection ───────────────────────────
setup_debian_mirrors() {
  hdr "Debian/Ubuntu Mirror Optimization"

  # Try netselect-apt for Debian
  if command -v netselect-apt >/dev/null 2>&1; then
    say "Running netselect-apt to find fastest Debian mirror…"
    netselect-apt -n -o /tmp/sources.list.new 2>/dev/null \
      && sudo cp /tmp/sources.list.new /etc/apt/sources.list \
      && ok "sources.list updated via netselect-apt" \
      || warn "netselect-apt failed — keeping existing mirrors"
    return
  fi

  # Try apt-mirror-updater
  if command -v apt-mirror-updater >/dev/null 2>&1; then
    say "Running apt-mirror-updater…"
    apt-mirror-updater --auto-change-mirror && ok "Mirror auto-updated" || true
    return
  fi

  # Manual: pick fastest from a vetted list
  say "Testing Debian CDN mirrors…"
  declare -A DEB_MIRRORS=(
    ["debian-cdn"]="https://deb.debian.org/debian"
    ["ftp.us.debian"]="https://ftp.us.debian.org/debian"
    ["mirrors.mit"]="https://mirrors.mit.edu/debian"
    ["mirror.cs.uchicago"]="https://mirror.cs.uchicago.edu/debian"
  )

  best_url="deb.debian.org/debian"; best_time=9999; best_name="debian-cdn"
  for name in "${!DEB_MIRRORS[@]}"; do
    url="${DEB_MIRRORS[$name]}/dists/stable/Release"
    t=$(curl -o /dev/null -s -w "%{time_total}" --max-time 5 "$url" 2>/dev/null || echo "9999")
    t_int=$(echo "$t" | awk '{printf "%d", $1 * 1000}')
    say "  ${name}: ${t}s"
    if [ "$t_int" -lt "$best_time" ]; then
      best_time=$t_int
      best_url="${DEB_MIRRORS[$name]}"
      best_name="$name"
    fi
  done
  ok "Fastest mirror: ${best_name} (${best_time}ms)"

  # Optionally update sources.list if we can
  if [ -w /etc/apt/sources.list ] || sudo -n true 2>/dev/null; then
    SUDO=""
    [ -w /etc/apt/sources.list ] || SUDO="sudo"
    codename=$(lsb_release -sc 2>/dev/null || cat /etc/os-release | grep VERSION_CODENAME | cut -d= -f2 || echo "stable")
    $SUDO tee /etc/apt/sources.list > /dev/null <<EOF
deb ${best_url} ${codename} main contrib non-free
deb ${best_url} ${codename}-updates main contrib non-free
deb ${best_url}-security ${codename}-security main contrib non-free
EOF
    ok "Updated /etc/apt/sources.list → ${best_name}"
  else
    say "Tip: Run as root or with sudo to update /etc/apt/sources.list"
  fi
}

# ── Package update & upgrade ─────────────────────────────────
run_pkg_upgrade() {
  hdr "Package Update & Upgrade"

  if [ "$IS_TERMUX" -eq 1 ]; then
    say "Updating Termux packages…"
    pkg update -y 2>&1 | tail -5
    say "Upgrading Termux packages…"
    pkg upgrade -y 2>&1 | tail -5
    ok "Termux packages up to date"
  else
    SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
    say "Running apt update…"
    $SUDO apt-get update -qq
    say "Running apt upgrade…"
    $SUDO apt-get upgrade -y -qq 2>&1 | tail -10
    say "Running dist-upgrade…"
    $SUDO apt-get dist-upgrade -y -qq 2>&1 | tail -5
    say "Autoremoving orphaned packages…"
    $SUDO apt-get autoremove -y -qq 2>&1 | tail -3
    say "Cleaning package cache…"
    $SUDO apt-get clean -qq
    ok "Debian/Ubuntu packages fully updated"
  fi
}

# ── Core tools ───────────────────────────────────────────────
install_core_tools() {
  hdr "Core Tools Installation"

  TERMUX_CORE=(
    bash curl wget git openssl openssh
    nano vim less grep sed gawk jq
    termux-api zip unzip tar proot
    ca-certificates dnsutils net-tools
    ncurses-utils tput
  )

  DEBIAN_CORE=(
    bash curl wget git openssl openssh-client
    nano vim less grep sed gawk jq
    zip unzip tar ca-certificates
    dnsutils net-tools iproute2 iputils-ping
    procps htop lsof file
  )

  if [ "$IS_TERMUX" -eq 1 ]; then
    say "Installing core Termux packages…"
    pkg install -y "${TERMUX_CORE[@]}" 2>&1 | grep -E "^(Inst|Err)" | head -20 || true
  else
    SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
    say "Installing core Debian packages…"
    $SUDO apt-get install -y -qq "${DEBIAN_CORE[@]}" 2>&1 | tail -5 || true
  fi
  ok "Core tools ready"
}

# ── Dev stack ────────────────────────────────────────────────
install_dev_stack() {
  hdr "Developer Stack"

  TERMUX_DEV=(nodejs npm python3 python rust golang clang make cmake ffmpeg
              imagemagick tsu procps htop)
  DEBIAN_DEV=(nodejs npm python3 python3-pip python3-venv
              rustc cargo golang build-essential cmake
              ffmpeg imagemagick)

  if [ "$IS_TERMUX" -eq 1 ]; then
    say "Installing Termux dev packages…"
    pkg install -y "${TERMUX_DEV[@]}" 2>&1 | grep -E "^(Inst|Err)" | head -20 || true
  else
    SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
    say "Installing Debian dev packages…"
    $SUDO apt-get install -y -qq "${DEBIAN_DEV[@]}" 2>&1 | tail -5 || true

    # Install nvm for managed Node versions
    if ! command -v nvm >/dev/null 2>&1 && [ ! -d "${HOME}/.nvm" ]; then
      say "Installing nvm (Node Version Manager)…"
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>/dev/null || true
    fi
  fi
  ok "Dev stack ready"

  # npm global useful tools
  if command -v npm >/dev/null 2>&1; then
    say "Installing global npm tools…"
    npm install -g npm@latest wrangler serve 2>/dev/null | tail -3 || true
    ok "npm globals: npm (latest), wrangler, serve"
  fi
}

# ── SSL / CA fix ─────────────────────────────────────────────
fix_ssl() {
  hdr "SSL / Certificate Fix"
  if [ "$IS_TERMUX" -eq 1 ]; then
    say "Updating CA certificates in Termux…"
    pkg install -y ca-certificates 2>/dev/null | tail -3 || true
    # Point curl to the right bundle
    CAPATH="${PREFIX}/etc/ssl/certs/ca-certificates.crt"
    if [ -f "$CAPATH" ]; then
      export CURL_CA_BUNDLE="$CAPATH"
      grep -q "CURL_CA_BUNDLE" "${HOME}/.bashrc" 2>/dev/null \
        || echo "export CURL_CA_BUNDLE=\"${CAPATH}\"" >> "${HOME}/.bashrc"
      ok "CURL_CA_BUNDLE set → ${CAPATH}"
    fi
  else
    SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
    $SUDO update-ca-certificates 2>/dev/null && ok "CA certificates updated" || true
  fi
}

# ── DNS fix ──────────────────────────────────────────────────
fix_dns() {
  hdr "DNS Reliability Fix"
  # Check if DNS resolves (google.com and 1.1.1.1 are highly reliable test targets)
  if ! host -t A google.com >/dev/null 2>&1 && ! nslookup google.com >/dev/null 2>&1; then
    warn "DNS seems broken — adding reliable fallbacks"
    if [ "$IS_TERMUX" -eq 1 ]; then
      # Overwrite to avoid duplicate nameserver entries on repeated runs
      printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "${PREFIX}/etc/resolv.conf"
    elif [ -w /etc/resolv.conf ] || sudo -n true 2>/dev/null; then
      SUDO=""; [ -w /etc/resolv.conf ] || SUDO="sudo"
      # Append only if not already present
      grep -qF "1.1.1.1" /etc/resolv.conf 2>/dev/null \
        || echo "nameserver 1.1.1.1" | $SUDO tee -a /etc/resolv.conf >/dev/null
      grep -qF "8.8.8.8" /etc/resolv.conf 2>/dev/null \
        || echo "nameserver 8.8.8.8" | $SUDO tee -a /etc/resolv.conf >/dev/null
    fi
    ok "DNS fallbacks added (1.1.1.1, 8.8.8.8)"
  else
    ok "DNS resolving correctly"
  fi
}

# ── Termux: ~/.bashrc / environment fixes ────────────────────
fix_termux_env() {
  hdr "Termux Environment Polish"

  RCFILE="${HOME}/.bashrc"
  # Ensure .bashrc exists
  touch "$RCFILE"

  add_if_missing() {
    grep -qF "$1" "$RCFILE" || echo "$1" >> "$RCFILE"
  }

  add_if_missing 'export PATH="${HOME}/.local/bin:${PREFIX}/bin:${PATH}"'
  add_if_missing 'export LANG=en_US.UTF-8'
  add_if_missing 'export LC_ALL=en_US.UTF-8'
  add_if_missing 'export EDITOR=nano'
  add_if_missing '# CoreOps alias shortcuts'
  add_if_missing 'alias ll="ls -la"'
  add_if_missing 'alias up="pkg update -y && pkg upgrade -y"'
  add_if_missing 'alias apt="pkg"'
  add_if_missing 'alias fixmirror="bash ~/coreops-starter-kit/scripts/termux-setup.sh"'
  add_if_missing 'alias ai="bash ~/coreops-starter-kit/termux-ai-wrapper.sh"'

  ok "~/.bashrc updated with aliases and env fixes"

  # Termux:API check
  if ! command -v termux-clipboard-get >/dev/null 2>&1; then
    warn "termux-api not found. Install 'Termux:API' app + run: pkg install termux-api"
  fi

  # Set reasonable umask
  add_if_missing 'umask 022'

  ok "Termux environment polished"
}

# ── Debian ~/.bashrc tweaks ───────────────────────────────────
fix_debian_env() {
  hdr "Debian Environment Polish"
  RCFILE="${HOME}/.bashrc"
  touch "$RCFILE"

  add_if_missing() {
    grep -qF "$1" "$RCFILE" || echo "$1" >> "$RCFILE"
  }

  # PATH line uses single quotes so $(nvm current) evaluates at shell startup, not now
  add_if_missing 'export PATH="${HOME}/.local/bin:${PATH}"'
  add_if_missing '# Load nvm if installed'
  add_if_missing '[ -s "${HOME}/.nvm/nvm.sh" ] && source "${HOME}/.nvm/nvm.sh"'
  add_if_missing 'export EDITOR=nano'
  add_if_missing '# CoreOps alias shortcuts'
  add_if_missing 'alias ll="ls -la"'
  add_if_missing 'alias up="sudo apt update && sudo apt upgrade -y && sudo apt autoremove -y"'
  add_if_missing 'alias ai="bash ~/coreops-starter-kit/termux-ai-wrapper.sh"'

  ok "~/.bashrc updated"
}

# ── Summary ──────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${BOLD}${NEON}${OK} Setup Complete!${R}"
  echo -e "${GRAY}$(printf '─%.0s' {1..50})${R}"
  echo -e " ${INFO} Run ${CYAN}source ~/.bashrc${R} to load new aliases"
  echo -e " ${INFO} Run ${CYAN}ai${R} to launch the AI wrapper"
  if [ "$IS_TERMUX" -eq 1 ]; then
    echo -e " ${INFO} Run ${CYAN}up${R} to update all packages quickly"
    echo -e " ${INFO} Run ${CYAN}pkg install <name>${R} for more packages"
  else
    echo -e " ${INFO} Run ${CYAN}up${R} to update all packages quickly"
    echo -e " ${INFO} Run ${CYAN}sudo apt install <name>${R} for more packages"
  fi
  echo ""
}

# ── Main ─────────────────────────────────────────────────────
if [ "$IS_TERMUX" -eq 1 ]; then
  setup_termux_storage
  setup_termux_mirrors
  run_pkg_upgrade
  install_core_tools
  fix_ssl
  fix_dns
  [ "$MODE_MINIMAL" -eq 0 ] && fix_termux_env
  [ "$MODE_DEV" -eq 1 ] && install_dev_stack
elif [ "$IS_DEBIAN" -eq 1 ]; then
  setup_debian_mirrors
  run_pkg_upgrade
  install_core_tools
  fix_ssl
  fix_dns
  [ "$MODE_MINIMAL" -eq 0 ] && fix_debian_env
  [ "$MODE_DEV" -eq 1 ] && install_dev_stack
fi

print_summary
