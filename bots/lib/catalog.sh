#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps Bot Catalog
# Writes a nicely-formatted metadata header onto every generated
# tool and maintains catalog.json for the control-panel viewer.
# =============================================================

BOTS_HOME="${BOTS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$BOTS_HOME/lib/bot-common.sh" 2>/dev/null || true

# ── Write the product header block into a script ─────────────
# Usage: catalog_stamp <output_file> <tool_name> <category> \
#                       <version> <built_by> <description> \
#                       <usage_example> "<tag1> <tag2> ..."
catalog_stamp() {
  local outfile="$1"
  local tool_name="$2"
  local category="$3"
  local version="${4:-1.0.0}"
  local built_by="${5:-CoreOps Bot}"
  local description="$6"
  local usage="$7"
  local tags="${8:-automation}"
  local built_on
  built_on="$(ts 2>/dev/null || date)"

  # Prepend the header to whatever content is in outfile.
  local content
  content=$(cat "$outfile" 2>/dev/null || true)

  cat > "$outfile" <<HEADER
#!/data/data/com.termux/files/usr/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  CoreOps Factory — Auto-Generated Tool                       ║
# ╠══════════════════════════════════════════════════════════════╣
# ║  Tool        : ${tool_name}
# ║  Category    : ${category}
# ║  Version     : ${version}
# ║  Built by    : ${built_by}
# ║  Built on    : ${built_on}
# ╠══════════════════════════════════════════════════════════════╣
# ║  Description : ${description}
# ╠══════════════════════════════════════════════════════════════╣
# ║  Usage       : ${usage}
# ╠══════════════════════════════════════════════════════════════╣
# ║  Tags        : ${tags}
# ╚══════════════════════════════════════════════════════════════╝
HEADER

  # Re-append the original body (skip first shebang line if it existed)
  printf "%s\n" "$content" | grep -v "^#!/" >> "$outfile" || true

  chmod +x "$outfile"
}

# ── Append/update catalog.json entry ────────────────────────
# Keeps a simple newline-delimited JSON log (one object per line).
catalog_record() {
  local tool_id="$1"
  local tool_name="$2"
  local category="$3"
  local version="${4:-1.0.0}"
  local built_by="${5:-CoreOps Bot}"
  local filepath="$6"
  local description="$7"
  local tags="${8:-automation}"
  local built_on
  built_on="$(ts 2>/dev/null || date)"

  bot_init_dirs

  # Remove old entry if updating
  if [ -f "$CATALOG_FILE" ]; then
    local tmp
    tmp=$(mktemp)
    grep -v "\"id\":\"${tool_id}\"" "$CATALOG_FILE" > "$tmp" 2>/dev/null || true
    mv "$tmp" "$CATALOG_FILE"
  fi

  # Append new entry
  printf '{"id":"%s","name":"%s","category":"%s","version":"%s","built_by":"%s","path":"%s","description":"%s","tags":"%s","built_on":"%s"}\n' \
    "$tool_id" "$tool_name" "$category" "$version" "$built_by" \
    "$filepath" "$description" "$tags" "$built_on" >> "$CATALOG_FILE"
}

# ── Print catalog summary (for control panel) ────────────────
catalog_summary() {
  local total=0
  [ -f "$CATALOG_FILE" ] && total=$(wc -l < "$CATALOG_FILE" | tr -d ' ')
  echo "$total"
}

# ── List catalog entries for a category ───────────────────────
catalog_list_category() {
  local category="$1"
  [ -f "$CATALOG_FILE" ] || return
  grep "\"category\":\"${category}\"" "$CATALOG_FILE" 2>/dev/null | \
    sed 's/.*"name":"\([^"]*\)".*/\1/'
}
