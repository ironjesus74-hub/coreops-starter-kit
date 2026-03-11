#!/data/data/com.termux/files/usr/bin/bash
# webaudit.sh — CoreOps web-page structure auditor
#
# Usage: coreops webaudit <url>
#
# Fetches <url> and audits it for the presence of:
#   - Shared CSS  (<link rel="stylesheet" …>)
#   - Shared JS   (<script src="…">)
#   - Navigation  (<nav …>, role="navigation")
#   - Head tags   (<title>, <meta name="description">, <meta name="viewport">,
#                  canonical <link rel="canonical" …>)
#   - Product pages / product cards  (.product-card, [data-product], #product)
#   - Checkout / PayPal buttons      (PayPal SDK script, .checkout, #checkout,
#                                     paypal.Buttons, paypal.com/sdk)
#
# Exit codes: 0 = all checks passed, 1 = one or more checks failed/warned.

set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/log.sh
source "$BASE_DIR/lib/log.sh"

# ── helpers ─────────────────────────────────────────────────────────────────

URL="${1:-}"
if [ -z "$URL" ]; then
  log_error "Usage: coreops webaudit <url>"
  exit 1
fi

# Normalise: add https:// when no scheme supplied
if [[ "$URL" != http://* && "$URL" != https://* ]]; then
  URL="https://$URL"
fi

START_TIME=$(date +%s)
SCORE=0
TOTAL=0

pass() { log_success "$1"; ((SCORE+=1)); ((TOTAL+=1)); }
warn() { log_warn    "$1";              ((TOTAL+=1)); }
info() { log_info    "$1"; }

# ── fetch page HTML ──────────────────────────────────────────────────────────

info "Fetching: $URL"
echo -e "${C_GRAY}----------------------------------------------------${C_RESET}"

TMPFILE="$(mktemp)"
HTTP_CODE=""

# -L follows redirects; %{http_code} reflects the final response code.
if ! HTTP_CODE="$(curl -sSL \
    --max-time 15 \
    --write-out "%{http_code}" \
    --output "$TMPFILE" \
    "$URL" 2>/dev/null)"; then
  log_error "Could not reach $URL (curl failed)"
  rm -f "$TMPFILE"
  exit 1
fi

if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 400 ]; then
  log_error "HTTP $HTTP_CODE returned for $URL"
  rm -f "$TMPFILE"
  exit 1
fi

info "HTTP $HTTP_CODE — OK"
echo

# Lower-case copy for case-insensitive matching
TMPFILE_LC="$(mktemp)"
tr '[:upper:]' '[:lower:]' < "$TMPFILE" > "$TMPFILE_LC"

check() {
  # check <label> <pattern> [<file>]
  local label="$1"
  local pattern="$2"
  local file="${3:-$TMPFILE_LC}"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    pass "$label"
  else
    warn "$label — not found"
  fi
}

# ── 1. Shared CSS ────────────────────────────────────────────────────────────

info "── Shared CSS"
check 'Stylesheet <link> present'       '<link[^>]+rel=["\x27]stylesheet'
check 'shared.css referenced'           'shared\.css'
echo

# ── 2. Shared JS ─────────────────────────────────────────────────────────────

info "── Shared JavaScript"
check '<script src="…"> present'        '<script[^>]+src='
check 'shared.js referenced'            'shared\.js'
echo

# ── 3. Navigation ────────────────────────────────────────────────────────────

info "── Navigation"
check '<nav> element present'           '<nav[[:space:]>]'
check 'role="navigation" present'       'role=["\x27]navigation'
echo

# ── 4. Head tags ─────────────────────────────────────────────────────────────

info "── Head tags"
check '<title> present'                 '<title>'
check '<meta name="description"> present' 'meta[^>]+name=["\x27]description'
check '<meta name="viewport"> present'  'meta[^>]+name=["\x27]viewport'
check '<link rel="canonical"> present'  'link[^>]+rel=["\x27]canonical'
echo

# ── 5. Product pages / product cards ─────────────────────────────────────────

info "── Product pages / product cards"
check 'Product section present'   '(class=["\x27][^"'\'']*product|id=["\x27][^"'\'']*product|data-product=)'
check 'Product card component'    '(coreops-product-card|product-card__)'
echo

# ── 6. Checkout / PayPal buttons ─────────────────────────────────────────────

info "── Checkout / PayPal integration"
check 'Checkout section present'   '(class=["\x27][^"'\'']*checkout|id=["\x27][^"'\'']*checkout)'
check 'PayPal SDK script loaded'   'paypal\.com/sdk/js'
check 'PayPal Buttons called'      'paypal\.buttons\('
echo

# ── cleanup ──────────────────────────────────────────────────────────────────

rm -f "$TMPFILE" "$TMPFILE_LC"

# ── summary ──────────────────────────────────────────────────────────────────

ELAPSED=$(( $(date +%s) - START_TIME ))
echo -e "${C_GRAY}----------------------------------------------------${C_RESET}"

if [ "$TOTAL" -eq 0 ]; then
  log_warn "Web Audit Score: 0/0 — no checks ran [${ELAPSED}s]"
  exit 1
fi

PCT=$(( SCORE * 100 / TOTAL ))
if [ "$PCT" -ge 80 ]; then
  log_success "Web Audit Score: $SCORE/$TOTAL (${PCT}%) — STRONG  [${ELAPSED}s]"
elif [ "$PCT" -ge 50 ]; then
  log_warn    "Web Audit Score: $SCORE/$TOTAL (${PCT}%) — MODERATE [${ELAPSED}s]"
else
  log_warn    "Web Audit Score: $SCORE/$TOTAL (${PCT}%) — WEAK  [${ELAPSED}s]"
fi

[ "$SCORE" -lt "$TOTAL" ] && exit 1 || exit 0
