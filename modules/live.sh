#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

COREOPS_HOME="${COREOPS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Try to load your colors (ok if missing)
source "$COREOPS_HOME/lib/log.sh" 2>/dev/null || true

# Color fallbacks (only used if lib/log.sh didn't set them)
C_RESET="${C_RESET:-$'\033[0m'}"
C_DIM="${C_DIM:-$'\033[2m'}"
C_CYAN="${C_CYAN:-$'\033[36m'}"
C_GREEN="${C_GREEN:-$'\033[32m'}"
C_YELLOW="${C_YELLOW:-$'\033[33m'}"
C_RED="${C_RED:-$'\033[31m'}"
C_GRAY="${C_GRAY:-$'\033[90m'}"
C_BOLD="${C_BOLD:-$'\033[1m'}"

HOST="${1:-}"
INTERVAL="${2:-2}"

if [ -z "$HOST" ]; then
  echo "Usage: coreops live <host> [interval_seconds]"
  exit 1
fi

ts() { date "+%Y-%m-%d %H:%M:%S"; }

icon_ok()   { printf "%b" "${C_GREEN}✔${C_RESET}"; }
icon_warn() { printf "%b" "${C_YELLOW}⚠${C_RESET}"; }
icon_bad()  { printf "%b" "${C_RED}✖${C_RESET}"; }

check_ping() {
  # returns: "OK <ms>" or "FAIL NA"
  local out ms
  out="$(ping -c 1 -W 2 "$HOST" 2>/dev/null || true)"
  # Use bash regex instead of a sed|head subshell pipeline
  if [[ "$out" =~ time=([0-9]+(\.[0-9]+)?) ]]; then
    ms="${BASH_REMATCH[1]}"
  else
    ms=""
  fi
  if [ -n "$ms" ]; then
    echo "OK $ms"
  else
    echo "FAIL NA"
  fi
}

check_port_443() {
  if [ -x "$COREOPS_HOME/modules/portscan.sh" ]; then
    if "$COREOPS_HOME/modules/portscan.sh" "$HOST" 443 >/dev/null 2>&1; then
      echo "OPEN"; return
    else
      echo "CLOSED"; return
    fi
  fi

  if [ "$_HAS_TIMEOUT" -eq 1 ]; then
    timeout 2 bash -c "cat </dev/null >/dev/tcp/$HOST/443" >/dev/null 2>&1 && echo "OPEN" || echo "CLOSED"
  else
    bash -c "cat </dev/null >/dev/tcp/$HOST/443" >/dev/null 2>&1 && echo "OPEN" || echo "CLOSED"
  fi
}

check_tls() {
  if [ -x "$COREOPS_HOME/modules/sslcheck.sh" ]; then
    "$COREOPS_HOME/modules/sslcheck.sh" "$HOST" 443 >/dev/null 2>&1 && echo "VALID" || echo "INVALID"
    return
  fi
  echo "SKIP"
}

check_dns() {
  # Prefer resolver lookups, avoid ping-flap
  if [ "$_HAS_GETENT" -eq 1 ]; then
    getent hosts "$HOST" >/dev/null 2>&1 && echo "RESOLVED" || echo "FAILED"
    return
  fi
  if [ "$_HAS_NSLOOKUP" -eq 1 ]; then
    nslookup "$HOST" >/dev/null 2>&1 && echo "RESOLVED" || echo "FAILED"
    return
  fi
  echo "SKIP"
}

fmt_line() {
  # label status goodword
  local label="$1" status="$2" good="$3"
  local ic col

  if [ "$status" = "$good" ] || [ "$status" = "OK" ] || [ "$status" = "OPEN" ] || [ "$status" = "VALID" ] || [ "$status" = "RESOLVED" ]; then
    ic="$(icon_ok)"; col="$C_GREEN"
  elif [ "$status" = "SKIP" ]; then
    ic="$(icon_warn)"; col="$C_YELLOW"
  else
    ic="$(icon_bad)"; col="$C_RED"
  fi

  printf "%b %-10s %b%s%b\n" "$ic" "$label:" "$col" "$status" "$C_RESET"
}

bar_10() {
  local ms="${1:-NA}"
  if [ "$ms" = "NA" ]; then
    printf "Latency: --   %b[----------]%b\n" "$C_GRAY" "$C_RESET"
    return
  fi

  # Truncate to integer for pure-bash comparison (avoids awk subshells)
  local ms_int="${ms%%.*}"
  # Guard against empty or non-numeric values (e.g., unusual ping output)
  if [ -z "$ms_int" ] || ! [[ "$ms_int" =~ ^[0-9]+$ ]]; then
    printf "Latency: --   %b[----------]%b\n" "$C_GRAY" "$C_RESET"
    return
  fi
  local blocks
  if   [ "$ms_int" -le 20 ];  then blocks=10
  elif [ "$ms_int" -le 40 ];  then blocks=8
  elif [ "$ms_int" -le 80 ];  then blocks=6
  elif [ "$ms_int" -le 120 ]; then blocks=4
  elif [ "$ms_int" -le 200 ]; then blocks=2
  else blocks=1
  fi

  # Build bar strings with C-style loops (avoids seq subshells)
  local filled="" empty="" color="$C_GREEN"
  local i
  for (( i=0; i<blocks; i++ )); do filled+="█"; done
  for (( i=0; i<(10-blocks); i++ )); do empty+="░"; done

  if [ "$blocks" -le 2 ]; then color="$C_RED"
  elif [ "$blocks" -le 4 ]; then color="$C_YELLOW"
  fi

  printf "Latency: %sms  %b[%s%s]%b\n" "$ms" "$color" "$filled" "$empty" "$C_RESET"
}

ALERT_MAX=8
alerts=()
push_alert() {
  alerts+=("$1")
  if [ "${#alerts[@]}" -gt "$ALERT_MAX" ]; then
    alerts=("${alerts[@]:1}")
  fi
}

HIST_MAX=10
history=()
push_hist() {
  history+=("$1")
  if [ "${#history[@]}" -gt "$HIST_MAX" ]; then
    history=("${history[@]:1}")
  fi
}

render() {
  local ping_s="$1" ms="$2" port_s="$3" tls_s="$4" dns_s="$5" score="$6" total="$7"

  clear
  printf "%b==============================================%b\n" "$C_CYAN" "$C_RESET"
  printf "%b%s%b\n" "$C_BOLD$C_CYAN" "              CoreOps Live Monitor" "$C_RESET"
  printf "%b==============================================%b\n" "$C_CYAN" "$C_RESET"
  printf "%bBuilt & shipped from Android (Termux) • Ctrl+C to quit%b\n\n" "$C_DIM" "$C_RESET"

  printf "%bℹ%b Host: %b%s%b\n" "$C_CYAN" "$C_RESET" "$C_BOLD" "$HOST" "$C_RESET"
  printf "%bℹ%b Refresh: every %ss\n" "$C_CYAN" "$C_RESET" "$INTERVAL"
  printf "%bℹ%b Time: %s\n" "$C_CYAN" "$C_RESET" "$(ts)"
  printf "%b----------------------------------------------%b\n" "$C_GRAY" "$C_RESET"

  fmt_line "Ping" "$ping_s" "OK"
  fmt_line "Port 443" "$port_s" "OPEN"
  fmt_line "TLS" "$tls_s" "VALID"
  fmt_line "DNS" "$dns_s" "RESOLVED"
  echo
  bar_10 "$ms"
  printf "%b----------------------------------------------%b\n" "$C_GRAY" "$C_RESET"

  local pct=$(( score * 100 / total ))
  local status="WEAK" scol="$C_RED"
  if [ "$pct" -ge 80 ]; then status="STRONG"; scol="$C_GREEN"
  elif [ "$pct" -ge 50 ]; then status="MODERATE"; scol="$C_YELLOW"
  fi

  printf "%b Score: %b%s/%s%b • Status: %b%s%b\n" "$(icon_ok)" "$C_BOLD" "$score" "$total" "$C_RESET" "$scol" "$status" "$C_RESET"

  if [ "${#history[@]}" -gt 0 ]; then
    printf "%bRecent:%b " "$C_DIM" "$C_RESET"
    local i
    for i in "${history[@]}"; do printf "%b%s%b  " "$C_GRAY" "$i" "$C_RESET"; done
    echo
  fi

  echo
  printf "%bAlerts%b %b(only shows changes)%b\n" "$C_BOLD" "$C_RESET" "$C_DIM" "$C_RESET"
  if [ "${#alerts[@]}" -eq 0 ]; then
    printf "%b- none yet%b\n" "$C_DIM" "$C_RESET"
  else
    local a
    for a in "${alerts[@]}"; do printf "%b%s%b\n" "$C_YELLOW" "$a" "$C_RESET"; done
  fi

  echo
  printf "%bNext update in %ss...%b\n" "$C_DIM" "$INTERVAL" "$C_RESET"
}

prev_ping="" prev_port="" prev_tls="" prev_dns=""

# Cache tool availability once before the loop to avoid repeated command -v calls
_HAS_GETENT=0;   command -v getent   >/dev/null 2>&1 && _HAS_GETENT=1   || true
_HAS_NSLOOKUP=0; command -v nslookup >/dev/null 2>&1 && _HAS_NSLOOKUP=1 || true
_HAS_TIMEOUT=0;  command -v timeout  >/dev/null 2>&1 && _HAS_TIMEOUT=1  || true

# Temp directory for collecting parallel check results
_live_tmp="$(mktemp -d)"
trap 'rm -rf "$_live_tmp"' EXIT INT TERM

while true; do
  # Run all network checks in parallel to cut per-cycle latency
  check_ping     > "$_live_tmp/ping" &
  check_port_443 > "$_live_tmp/port" &
  check_tls      > "$_live_tmp/tls"  &
  check_dns      > "$_live_tmp/dns"  &
  wait

  read -r ping_s ms < "$_live_tmp/ping"
  port_s="$(<"$_live_tmp/port")"
  tls_s="$(<"$_live_tmp/tls")"
  dns_s="$(<"$_live_tmp/dns")"

  score=0; total=4
  [ "$ping_s" = "OK" ] && score=$((score+1))
  [ "$port_s" = "OPEN" ] && score=$((score+1))
  [ "$tls_s" = "VALID" ] && score=$((score+1))
  [ "$dns_s" = "RESOLVED" ] && score=$((score+1))

  push_hist "${score}/${total}"

  [ -n "$prev_ping" ] && [ "$ping_s" != "$prev_ping" ] && push_alert "[$(ts)] Ping changed: ${prev_ping} -> ${ping_s}"
  [ -n "$prev_port" ] && [ "$port_s" != "$prev_port" ] && push_alert "[$(ts)] Port 443 changed: ${prev_port} -> ${port_s}"
  [ -n "$prev_tls" ] && [ "$tls_s" != "$prev_tls" ] && push_alert "[$(ts)] TLS changed: ${prev_tls} -> ${tls_s}"
  [ -n "$prev_dns" ] && [ "$dns_s" != "$prev_dns" ] && push_alert "[$(ts)] DNS changed: ${prev_dns} -> ${dns_s}"

  prev_ping="$ping_s"
  prev_port="$port_s"
  prev_tls="$tls_s"
  prev_dns="$dns_s"

  render "$ping_s" "$ms" "$port_s" "$tls_s" "$dns_s" "$score" "$total"
  sleep "$INTERVAL"
done
