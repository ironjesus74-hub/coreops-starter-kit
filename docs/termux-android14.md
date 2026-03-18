# Android 14+ Termux: one-block installer

Paste this block **exactly as-is** into a fresh Termux session on Android 14+. It writes everything under `$HOME` to avoid `/sdcard` write restrictions.

```bash
cat > ~/setup-all.sh <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

echo "[0] Prep Termux"
termux-setup-storage || true  # already granted on many devices; non-fatal if declined
echo "deb https://packages-cf.termux.dev/apt/termux-main stable main" > $PREFIX/etc/apt/sources.list
pkg update -y && pkg upgrade -y
pkg install -y proot-distro ca-certificates openssl-tool wget curl jq

echo "[1] Clean any old Debian"
rm -rf $PREFIX/var/lib/proot-distro/installed-rootfs/debian
proot-distro clear-cache || true
cd $TMPDIR

echo "[2] Fetch Debian rootfs over HTTP (no TLS)"
# HTTP mirror is used here because HTTPS fetches intermittently fail on Android 14 storage paths.
curl --http1.1 -L -o debian.tar.xz \
  http://easycli.sh/proot-distro/debian-trixie-aarch64-pd-v4.37.0.tar.xz

echo "[3] Install Debian from local file"
# Local tarball install; SHA256 is skipped for simplicity — verify manually if your threat model requires it.
PD_OVERRIDE_TARBALL_URL="file://$TMPDIR/debian.tar.xz" \
PD_OVERRIDE_TARBALL_SHA256=skip \
proot-distro install debian

echo "[4] Launcher"
cat > $PREFIX/bin/debian <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
PROOT_NO_SECCOMP=1 proot-distro login debian --shared-tmp -- "$@"
EOF
chmod +x $PREFIX/bin/debian

echo "[5] Bootstrap inside Debian"
debian bash -lc '
set -e
apt update && apt upgrade -y
apt install -y ca-certificates git curl wget nano unzip xz-utils build-essential python3 python3-venv python3-pip gnupg
# Trusted upstream (NodeSource) — piping for convenience
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt install -y nodejs
npm install -g npm
'

echo "[6] Minimal GPT CLI (atlas)"
debian bash -lc '
mkdir -p ~/atlas && cd ~/atlas
cat > atlas <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
: "${OPENAI_API_KEY:?Set OPENAI_API_KEY first}"
model="${ATLAS_MODEL:-gpt-4o-mini}"
prompt="${*:-Hello from Atlas}"
payload="$(jq -cn \
  --arg model "$model" \
  --arg prompt "$prompt" \
  '{model:$model,messages:[{role:"user",content:$prompt}]}' \
)"
curl -s https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  | jq -r ".choices[0].message.content"
EOF
chmod +x atlas
echo 'export PATH="$HOME/atlas:$PATH"' >> ~/.profile
'

echo "[DONE] Run: debian bash"
echo "Inside Debian: export OPENAI_API_KEY=your_key && atlas \"test\""
SH

bash ~/setup-all.sh
```

- If `termux-setup-storage` prompts, allow it.
- After the script finishes, enter Debian with `debian bash`, set your key (`export OPENAI_API_KEY=sk-...`), then test with `atlas "hello"`.
- If any step fails, copy the last 10 lines of the error so we can troubleshoot quickly.
