#!/data/data/com.termux/files/usr/bin/bash
have() { command -v "$1" >/dev/null 2>&1; }
need() { have "$1" || { echo "[ERROR] Missing dependency: $1"; return 1; }; }
