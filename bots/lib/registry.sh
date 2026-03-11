#!/data/data/com.termux/files/usr/bin/bash
# =============================================================
# CoreOps Bot Registry
# Tracks every tool that has been built to prevent duplicates.
# Format (registry.db): one entry per line → "category:tool_id"
# =============================================================

BOTS_HOME="${BOTS_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$BOTS_HOME/lib/bot-common.sh" 2>/dev/null || true

# ── Init registry ─────────────────────────────────────────────
registry_init() {
  bot_init_dirs
  [ -f "$REGISTRY_FILE" ] || touch "$REGISTRY_FILE"
}

# ── Check if a tool is already registered ────────────────────
# Returns 0 (true) if the tool exists in the registry.
# Lines are: "category:tool_id\tbuilder\ttimestamp" so match as prefix.
registry_exists() {
  local category="$1" tool_id="$2"
  registry_init
  grep -qF "${category}:${tool_id}" "$REGISTRY_FILE" 2>/dev/null
}

# ── Register a newly built tool ───────────────────────────────
registry_add() {
  local category="$1" tool_id="$2" built_by="${3:-unknown}" timestamp
  timestamp="$(ts 2>/dev/null || date)"
  registry_init
  if ! registry_exists "$category" "$tool_id"; then
    printf "%s:%s\t%s\t%s\n" "$category" "$tool_id" "$built_by" "$timestamp" >> "$REGISTRY_FILE"
  fi
}

# ── List all registered tools ────────────────────────────────
registry_list() {
  registry_init
  cat "$REGISTRY_FILE"
}

# ── Count registered tools ────────────────────────────────────
registry_count() {
  registry_init
  wc -l < "$REGISTRY_FILE" | tr -d ' '
}

# ── Count by category ─────────────────────────────────────────
registry_count_category() {
  local category="$1"
  registry_init
  grep -c "^${category}:" "$REGISTRY_FILE" 2>/dev/null || echo 0
}

# ── Remove a tool (admin only) ────────────────────────────────
registry_remove() {
  local category="$1" tool_id="$2"
  registry_init
  local tmp
  tmp=$(mktemp)
  grep -vF "${category}:${tool_id}" "$REGISTRY_FILE" > "$tmp" 2>/dev/null || true
  mv "$tmp" "$REGISTRY_FILE"
}

# ── Get all tools in a category ───────────────────────────────
registry_list_category() {
  local category="$1"
  registry_init
  grep "^${category}:" "$REGISTRY_FILE" 2>/dev/null | cut -d: -f2 | cut -f1
}
