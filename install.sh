#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${PREFIX:-/data/data/com.termux/files/usr}/bin/coreops"

cat > "$TARGET" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
export COREOPS_HOME="$BASE_DIR"
exec "\$COREOPS_HOME/bin/coreops" "\$@"
EOF

chmod +x "$TARGET"

echo "[OK] Installed wrapper -> $TARGET"
echo "Try: coreops help"
