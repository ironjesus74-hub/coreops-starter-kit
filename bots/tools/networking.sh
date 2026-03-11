#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps Builder 1 — Networking & Developer Tool Generators
# Each function writes a complete, working bash script into $1.
# =============================================================

BOTS_HOME="${BOTS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$BOTS_HOME/lib/bot-common.sh" 2>/dev/null || true
source "$BOTS_HOME/lib/registry.sh"  2>/dev/null || true
source "$BOTS_HOME/lib/catalog.sh"   2>/dev/null || true

# ── Tool manifest (id, name, description, usage, tags) ───────
declare -a NET_TOOL_IDS=(
  "http-endpoint-tester"
  "dns-bulk-lookup"
  "webhook-sender"
  "api-health-checker"
  "latency-monitor"
  "ssl-expiry-checker"
  "port-range-scanner"
  "network-speed-test"
  "whois-lookup"
  "ip-geolocation"
  "traceroute-reporter"
  "curl-debug-inspector"
)

net_tool_next_unbuilt() {
  for id in "${NET_TOOL_IDS[@]}"; do
    registry_exists "networking" "$id" || { echo "$id"; return; }
  done
  echo ""
}

net_all_built() {
  for id in "${NET_TOOL_IDS[@]}"; do
    registry_exists "networking" "$id" || return 1
  done
  return 0
}

# ─────────────────────────────────────────────────────────────
# Individual tool generators
# Each writes clean bash code into the provided filepath.
# ─────────────────────────────────────────────────────────────

_gen_http_endpoint_tester() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
URL="${1:-}"
EXPECTED="${2:-200}"

if [ -z "$URL" ]; then echo "Usage: $0 <url> [expected_status_code]"; exit 1; fi

check() {
  local url="$1" expected="$2"
  local start end elapsed status body_size
  start=$(date +%s%3N 2>/dev/null || date +%s)
  local response
  response=$(curl -sS -o /tmp/_co_resp -w "%{http_code}|%{time_total}|%{size_download}" \
    --max-time 10 --connect-timeout 5 -L "$url" 2>/dev/null || echo "000|0|0")
  end=$(date +%s%3N 2>/dev/null || date +%s)
  status=$(echo "$response" | cut -d'|' -f1)
  local time_s body_size
  time_s=$(echo "$response" | cut -d'|' -f2)
  body_size=$(echo "$response" | cut -d'|' -f3)
  elapsed=$(( end - start ))

  printf "URL          : %s\n" "$url"
  printf "Status       : %s (expected %s)\n" "$status" "$expected"
  printf "Response time: %ss\n" "$time_s"
  printf "Body size    : %s bytes\n" "$body_size"

  if [ "$status" = "$expected" ]; then
    printf "Result       : \033[32mPASS\033[0m\n"
  else
    printf "Result       : \033[31mFAIL\033[0m\n"; exit 1
  fi
}

check "$URL" "$EXPECTED"
BODY
  catalog_stamp "$f" "HTTP Endpoint Tester" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Tests HTTP/HTTPS endpoints for availability, status codes, and response time." \
    "./http-endpoint-tester.sh <url> [expected_status]" \
    "networking http testing monitoring curl"
}

_gen_dns_bulk_lookup() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
INPUT="${1:-}"

usage() { echo "Usage: $0 <hosts_file_or_host>  # one host per line or single host"; exit 1; }
[ -z "$INPUT" ] && usage

resolve() {
  local host="$1"
  local ip=""
  if command -v getent >/dev/null 2>&1; then
    ip=$(getent hosts "$host" 2>/dev/null | awk '{print $1}' | head -n1)
  elif command -v nslookup >/dev/null 2>&1; then
    ip=$(nslookup "$host" 2>/dev/null | awk '/^Address:/{print $2}' | grep -v '#' | head -n1)
  elif command -v dig >/dev/null 2>&1; then
    ip=$(dig +short "$host" 2>/dev/null | head -n1)
  fi
  [ -n "$ip" ] && printf "\033[32m✔\033[0m  %-40s %s\n" "$host" "$ip" \
                || printf "\033[31m✖\033[0m  %-40s FAILED\n" "$host"
}

if [ -f "$INPUT" ]; then
  total=0; ok=0
  while IFS= read -r line; do
    [[ "$line" =~ ^#|^$ ]] && continue
    resolve "$line"; ((total++)); true
  done < "$INPUT"
  echo "─────────────────────────────"
  printf "Processed %d host(s)\n" "$total"
else
  resolve "$INPUT"
fi
BODY
  catalog_stamp "$f" "DNS Bulk Lookup" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Resolves one or many hostnames to IP addresses with pass/fail reporting." \
    "./dns-bulk-lookup.sh <hosts_file_or_hostname>" \
    "networking dns lookup resolver"
}

_gen_webhook_sender() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
URL="${1:-}"
PAYLOAD="${2:-'{\"event\":\"test\",\"source\":\"coreops\"}'}"
METHOD="${3:-POST}"
CONTENT_TYPE="${4:-application/json}"

[ -z "$URL" ] && { echo "Usage: $0 <url> [json_payload] [method] [content-type]"; exit 1; }

echo "Sending ${METHOD} webhook to: ${URL}"
echo "Payload: ${PAYLOAD}"
echo "────────────────────────────────────"

response=$(curl -sS -X "$METHOD" \
  -H "Content-Type: ${CONTENT_TYPE}" \
  -H "User-Agent: CoreOps-Webhook/1.0" \
  -d "$PAYLOAD" \
  -w "\nHTTP_STATUS:%{http_code}\nTIME_TOTAL:%{time_total}" \
  --max-time 15 "$URL" 2>&1)

body=$(echo "$response" | grep -v "^HTTP_STATUS:" | grep -v "^TIME_TOTAL:")
status=$(echo "$response" | grep "^HTTP_STATUS:" | cut -d: -f2)
ttime=$(echo "$response" | grep "^TIME_TOTAL:" | cut -d: -f2)

printf "Response body: %s\n" "$body"
printf "HTTP Status  : %s\n" "$status"
printf "Time taken   : %ss\n" "$ttime"

if [[ "$status" -ge 200 && "$status" -lt 300 ]]; then
  printf "\033[32m✔ Webhook delivered successfully.\033[0m\n"
else
  printf "\033[31m✖ Webhook delivery failed (status %s).\033[0m\n" "$status"; exit 1
fi
BODY
  catalog_stamp "$f" "Webhook Sender" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Sends test webhooks (POST/PUT) to any URL with custom JSON payload and reports result." \
    "./webhook-sender.sh <url> [json_payload] [method]" \
    "networking webhook http post testing"
}

_gen_api_health_checker() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
ENDPOINTS_FILE="${1:-}"
INTERVAL="${2:-60}"

usage() {
  echo "Usage: $0 <endpoints_file> [check_interval_seconds]"
  echo "  File format: one URL per line (optionally: url|expected_status)"
  exit 1
}
[ -z "$ENDPOINTS_FILE" ] && usage
[ -f "$ENDPOINTS_FILE" ] || { echo "File not found: $ENDPOINTS_FILE"; exit 1; }

C_GREEN="\033[32m"; C_RED="\033[31m"; C_RESET="\033[0m"; C_BOLD="\033[1m"

check_endpoint() {
  local entry="$1"
  local url expected
  url=$(echo "$entry"  | cut -d'|' -f1)
  expected=$(echo "$entry" | cut -d'|' -f2)
  [ "$expected" = "$url" ] && expected="200"

  local status ttime
  status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 -L "$url" 2>/dev/null || echo "000")
  ttime=$(curl -sS -o /dev/null -w "%{time_total}" --max-time 10 -L "$url" 2>/dev/null || echo "N/A")

  if [ "$status" = "$expected" ]; then
    printf "${C_GREEN}✔${C_RESET} %-50s status=%-5s time=%ss\n" "$url" "$status" "$ttime"
  else
    printf "${C_RED}✖${C_RESET} %-50s status=%-5s (want %s) time=%ss\n" "$url" "$status" "$expected" "$ttime"
  fi
}

run_once() {
  echo -e "${C_BOLD}API Health Check — $(date '+%Y-%m-%d %H:%M:%S')${C_RESET}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  while IFS= read -r line; do
    [[ "$line" =~ ^#|^$ ]] && continue
    check_endpoint "$line"
  done < "$ENDPOINTS_FILE"
  echo ""
}

if [ "$INTERVAL" -gt 0 ]; then
  echo "Running continuous health checks every ${INTERVAL}s. Ctrl+C to stop."
  while true; do run_once; sleep "$INTERVAL"; done
else
  run_once
fi
BODY
  catalog_stamp "$f" "API Health Checker" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Continuously polls a list of API endpoints and reports health status with response times." \
    "./api-health-checker.sh <endpoints_file> [interval_seconds]" \
    "networking api health monitoring rest"
}

_gen_latency_monitor() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
HOST="${1:-8.8.8.8}"
COUNT="${2:-10}"
INTERVAL="${3:-1}"

C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"; C_RESET="\033[0m"

printf "Monitoring latency to %s (%s pings, %ss interval)\n" "$HOST" "$COUNT" "$INTERVAL"
echo "────────────────────────────────────────────────"

total=0; ok=0; sum=0; min=9999; max=0

for i in $(seq 1 "$COUNT"); do
  result=$(ping -c 1 -W 2 "$HOST" 2>/dev/null || true)
  ms=$(printf "%s" "$result" | sed -n 's/.*time=\([0-9.]*\).*/\1/p' | head -n1)
  if [ -n "$ms" ]; then
    ((ok++)) || true
    # integer math: strip decimals
    ms_int=${ms%%.*}
    sum=$((sum + ms_int))
    [ "$ms_int" -lt "$min" ] && min=$ms_int
    [ "$ms_int" -gt "$max" ] && max=$ms_int
    color=$C_GREEN
    [ "$ms_int" -gt 100 ] && color=$C_YELLOW
    [ "$ms_int" -gt 300 ] && color=$C_RED
    printf "[%3d/%-3d] ${color}%6.1fms${C_RESET}\n" "$i" "$COUNT" "$ms"
  else
    printf "[%3d/%-3d] ${C_RED}TIMEOUT${C_RESET}\n" "$i" "$COUNT"
  fi
  ((total++)) || true
  [ "$i" -lt "$COUNT" ] && sleep "$INTERVAL"
done

echo "────────────────────────────────────────────────"
printf "Sent: %d  Received: %d  Loss: %d%%\n" "$total" "$ok" "$(( (total-ok)*100/total ))"
[ "$ok" -gt 0 ] && printf "RTT min/avg/max = %dms / %dms / %dms\n" "$min" "$((sum/ok))" "$max"
BODY
  catalog_stamp "$f" "Latency Monitor" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Pings a host N times and reports min/avg/max RTT with color-coded output." \
    "./latency-monitor.sh [host] [count] [interval_s]" \
    "networking ping latency monitoring icmp"
}

_gen_ssl_expiry_checker() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
INPUT="${1:-}"
WARN_DAYS="${2:-30}"

[ -z "$INPUT" ] && { echo "Usage: $0 <host_or_file> [warn_days]"; exit 1; }

C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"; C_RESET="\033[0m"

check_ssl() {
  local host="$1" port="${2:-443}"
  local expiry days
  expiry=$(echo | timeout 5 openssl s_client -servername "$host" -connect "${host}:${port}" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -z "$expiry" ]; then
    printf "${C_RED}✖${C_RESET}  %-40s Cannot retrieve cert\n" "${host}:${port}"
    return
  fi
  local exp_epoch now_epoch
  exp_epoch=$(date -d "$expiry" +%s 2>/dev/null || date -jf "%b %d %T %Y %Z" "$expiry" +%s 2>/dev/null || echo 0)
  now_epoch=$(date +%s)
  days=$(( (exp_epoch - now_epoch) / 86400 ))

  if [ "$days" -lt 0 ]; then
    printf "${C_RED}✖${C_RESET}  %-40s EXPIRED (%d days ago)\n" "${host}:${port}" "$((-days))"
  elif [ "$days" -lt "$WARN_DAYS" ]; then
    printf "${C_YELLOW}⚠${C_RESET}  %-40s Expires in %d days (%s)\n" "${host}:${port}" "$days" "$expiry"
  else
    printf "${C_GREEN}✔${C_RESET}  %-40s %d days remaining (%s)\n" "${host}:${port}" "$days" "$expiry"
  fi
}

if [ -f "$INPUT" ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^#|^$ ]] && continue
    host=$(echo "$line" | cut -d: -f1)
    port=$(echo "$line" | cut -d: -f2)
    [ "$port" = "$host" ] && port=443
    check_ssl "$host" "$port"
  done < "$INPUT"
else
  check_ssl "$INPUT"
fi
BODY
  catalog_stamp "$f" "SSL Expiry Checker" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Checks SSL/TLS certificate expiry dates for one or many hosts, warns before expiry." \
    "./ssl-expiry-checker.sh <host_or_file> [warn_days]" \
    "networking ssl tls certificate security expiry"
}

_gen_port_range_scanner() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
HOST="${1:-}"
START_PORT="${2:-1}"
END_PORT="${3:-1024}"
TIMEOUT="${4:-1}"

[ -z "$HOST" ] && { echo "Usage: $0 <host> [start_port] [end_port] [timeout_s]"; exit 1; }

C_GREEN="\033[32m"; C_RED="\033[31m"; C_DIM="\033[2m"; C_RESET="\033[0m"

printf "Scanning %s ports %d-%d (timeout=%ss per port)\n" "$HOST" "$START_PORT" "$END_PORT" "$TIMEOUT"
echo "────────────────────────────────────────────────────────"

open_count=0
for port in $(seq "$START_PORT" "$END_PORT"); do
  if command -v timeout >/dev/null 2>&1; then
    timeout "$TIMEOUT" bash -c "echo >/dev/tcp/${HOST}/${port}" 2>/dev/null \
      && { printf "${C_GREEN}OPEN${C_RESET}  %5d\n" "$port"; ((open_count++)); } || true
  else
    bash -c "echo >/dev/tcp/${HOST}/${port}" 2>/dev/null \
      && { printf "${C_GREEN}OPEN${C_RESET}  %5d\n" "$port"; ((open_count++)); } || true
  fi
done

echo "────────────────────────────────────────────────────────"
printf "Scan complete. %d open port(s) found.\n" "$open_count"
BODY
  catalog_stamp "$f" "Port Range Scanner" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Scans a TCP port range on a host and reports open ports." \
    "./port-range-scanner.sh <host> [start_port] [end_port] [timeout]" \
    "networking ports security scanning tcp"
}

_gen_network_speed_test() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
TEST_URL="${1:-https://speed.cloudflare.com/__down?bytes=10000000}"
RUNS="${2:-3}"

C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_BOLD="\033[1m"; C_RESET="\033[0m"

printf "%sNetwork Speed Test%s (using %s)\n" "$C_BOLD" "$C_RESET" "$TEST_URL"
echo "────────────────────────────────────────────────────"

total_speed=0
for i in $(seq 1 "$RUNS"); do
  result=$(curl -sS -o /dev/null -w "%{speed_download}|%{time_total}|%{size_download}" \
    --max-time 30 "$TEST_URL" 2>/dev/null || echo "0|0|0")
  speed=$(echo "$result" | cut -d'|' -f1)
  ttime=$(echo "$result" | cut -d'|' -f2)
  size=$(echo "$result" | cut -d'|' -f3)
  # Convert bytes/s to Mbps
  mbps=$(awk "BEGIN{printf \"%.2f\", $speed * 8 / 1000000}" 2>/dev/null || echo "N/A")
  printf "Run %d/%d: %6s Mbps  (%s bytes in %ss)\n" "$i" "$RUNS" "$mbps" "$size" "$ttime"
  total_speed=$(awk "BEGIN{printf \"%.2f\", $total_speed + $mbps}" 2>/dev/null || echo 0)
done

echo "────────────────────────────────────────────────────"
avg=$(awk "BEGIN{printf \"%.2f\", $total_speed / $RUNS}" 2>/dev/null || echo "N/A")
printf "${C_GREEN}Average download speed: %s Mbps${C_RESET}\n" "$avg"
BODY
  catalog_stamp "$f" "Network Speed Test" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Measures download bandwidth using a public test endpoint and reports Mbps." \
    "./network-speed-test.sh [test_url] [runs]" \
    "networking bandwidth speed testing curl"
}

_gen_whois_lookup() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
TARGET="${1:-}"
[ -z "$TARGET" ] && { echo "Usage: $0 <domain_or_ip>"; exit 1; }

C_BOLD="\033[1m"; C_CYAN="\033[36m"; C_RESET="\033[0m"

printf "${C_BOLD}WHOIS Lookup: %s${C_RESET}\n" "$TARGET"
echo "────────────────────────────────────────────"

if command -v whois >/dev/null 2>&1; then
  whois "$TARGET" 2>/dev/null | grep -iE "Registrar:|Creation|Expiry|Updated|Status:|Name Server:|Country" || whois "$TARGET"
else
  # Fallback: query via HTTP
  echo "whois binary not found; querying RDAP..."
  if command -v curl >/dev/null 2>&1; then
    domain=$(echo "$TARGET" | sed 's/^www\.//')
    curl -sS "https://rdap.org/domain/${domain}" 2>/dev/null \
      | grep -oP '"(ldhName|status|registrar)"\s*:\s*\K[^,}]*' || echo "RDAP query failed."
  else
    echo "Neither whois nor curl available. Install one to use this tool."
    exit 1
  fi
fi
BODY
  catalog_stamp "$f" "WHOIS Lookup" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Performs WHOIS lookups for domains and IPs, filtering key registration fields." \
    "./whois-lookup.sh <domain_or_ip>" \
    "networking whois domain registration dns"
}

_gen_ip_geolocation() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
IP="${1:-}"

if [ -z "$IP" ]; then
  echo "No IP provided — looking up your public IP..."
  IP=$(curl -sS --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
  [ -z "$IP" ] && { echo "Could not determine public IP."; exit 1; }
  printf "Your public IP: %s\n" "$IP"
fi

C_BOLD="\033[1m"; C_CYAN="\033[36m"; C_RESET="\033[0m"
printf "\n${C_BOLD}GeoIP for: %s${C_RESET}\n" "$IP"
echo "────────────────────────────────────────────────────────"

result=$(curl -sS --max-time 10 "http://ip-api.com/json/${IP}?fields=status,country,regionName,city,isp,org,as,query" 2>/dev/null)

if echo "$result" | grep -q '"status":"success"'; then
  echo "$result" | tr ',' '\n' | tr -d '{}' | sed 's/"//g' | sed 's/:/: /' | grep -v "^status"
else
  echo "Geolocation lookup failed."
  echo "Raw response: $result"
  exit 1
fi
BODY
  catalog_stamp "$f" "IP Geolocation" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Geolocates an IP address showing country, region, city, ISP, and ASN via ip-api.com." \
    "./ip-geolocation.sh [ip_address]" \
    "networking ip geolocation geoip isp"
}

_gen_traceroute_reporter() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
HOST="${1:-}"
MAX_HOPS="${2:-30}"
[ -z "$HOST" ] && { echo "Usage: $0 <host> [max_hops]"; exit 1; }

C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"; C_BOLD="\033[1m"; C_RESET="\033[0m"

printf "${C_BOLD}Traceroute to: %s (max %d hops)${C_RESET}\n" "$HOST" "$MAX_HOPS"
echo "────────────────────────────────────────────────────────────────"

if command -v traceroute >/dev/null 2>&1; then
  traceroute -m "$MAX_HOPS" "$HOST" 2>&1 | while IFS= read -r line; do
    ms=$(echo "$line" | grep -oP '\d+\.\d+ ms' | head -n1 | cut -d' ' -f1 || true)
    if [ -n "$ms" ]; then
      ms_int=${ms%%.*}
      [ "$ms_int" -gt 200 ] && color=$C_RED || { [ "$ms_int" -gt 100 ] && color=$C_YELLOW || color=$C_GREEN; }
      echo -e "${color}${line}${C_RESET}"
    else
      echo "$line"
    fi
  done
elif command -v tracepath >/dev/null 2>&1; then
  tracepath -m "$MAX_HOPS" "$HOST" 2>&1
else
  echo "Neither traceroute nor tracepath found."
  echo "Install with: pkg install traceroute  OR  apt install traceroute"
  exit 1
fi
BODY
  catalog_stamp "$f" "Traceroute Reporter" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Runs traceroute to a host and color-codes each hop by latency." \
    "./traceroute-reporter.sh <host> [max_hops]" \
    "networking traceroute routing latency hops"
}

_gen_curl_debug_inspector() {
  local f="$1"
  cat > "$f" <<'BODY'
set -euo pipefail
URL="${1:-}"
[ -z "$URL" ] && { echo "Usage: $0 <url> [extra_curl_args...]"; exit 1; }
shift || true
EXTRA_ARGS=("$@")

C_BOLD="\033[1m"; C_CYAN="\033[36m"; C_DIM="\033[2m"; C_RESET="\033[0m"

printf "${C_BOLD}cURL Debug Inspector: %s${C_RESET}\n" "$URL"
echo "════════════════════════════════════════════════════════"

tmpbody=$(mktemp)
tmpheader=$(mktemp)

curl -sS -D "$tmpheader" -o "$tmpbody" \
  -w "http_code=%{http_code}\ntime_total=%{time_total}\ntime_connect=%{time_connect}\ntime_starttransfer=%{time_starttransfer}\nsize_download=%{size_download}\nspeed_download=%{speed_download}\nremote_ip=%{remote_ip}\nremote_port=%{remote_port}\n" \
  --max-time 15 "${EXTRA_ARGS[@]}" "$URL" 2>&1

echo ""
printf "${C_CYAN}─── Response Headers ───${C_RESET}\n"
cat "$tmpheader"

echo ""
printf "${C_CYAN}─── Body Preview (first 30 lines) ───${C_RESET}\n"
head -n 30 "$tmpbody"

rm -f "$tmpbody" "$tmpheader"
BODY
  catalog_stamp "$f" "cURL Debug Inspector" "networking" "1.0.0" \
    "CoreOps Builder Bot 1" \
    "Makes an HTTP request and displays full debug info: timing breakdown, headers, body preview." \
    "./curl-debug-inspector.sh <url> [extra_curl_args]" \
    "networking curl http debug headers timing inspect"
}

# ── Dispatch: build one tool by ID ────────────────────────────
net_build_tool() {
  local tool_id="$1"
  local outpath="${FACTORY_DIR}/networking/${tool_id}.sh"

  case "$tool_id" in
    http-endpoint-tester)   _gen_http_endpoint_tester  "$outpath" ;;
    dns-bulk-lookup)        _gen_dns_bulk_lookup        "$outpath" ;;
    webhook-sender)         _gen_webhook_sender         "$outpath" ;;
    api-health-checker)     _gen_api_health_checker     "$outpath" ;;
    latency-monitor)        _gen_latency_monitor        "$outpath" ;;
    ssl-expiry-checker)     _gen_ssl_expiry_checker     "$outpath" ;;
    port-range-scanner)     _gen_port_range_scanner     "$outpath" ;;
    network-speed-test)     _gen_network_speed_test     "$outpath" ;;
    whois-lookup)           _gen_whois_lookup           "$outpath" ;;
    ip-geolocation)         _gen_ip_geolocation         "$outpath" ;;
    traceroute-reporter)    _gen_traceroute_reporter    "$outpath" ;;
    curl-debug-inspector)   _gen_curl_debug_inspector   "$outpath" ;;
    *) return 1 ;;
  esac

  chmod +x "$outpath"
  registry_add "networking" "$tool_id" "builder1"
  catalog_record "$tool_id" "$tool_id" "networking" "1.0.0" "Builder Bot 1" \
    "$outpath" "Networking tool" "networking"
  echo "$outpath"
}
