# CoreOps Boot — Auto-Start Setup

This directory contains the auto-start script that launches your bots
automatically every time your phone restarts.

---

## Requirements

- **Termux:Boot** app installed from F-Droid (not Play Store)
- CoreOps cloned to your home directory: `~/coreops-starter-kit`
- Termux storage access granted: `termux-setup-storage`

---

## Setup (one-time)

```bash
# 1. Install Termux:Boot from F-Droid
#    https://f-droid.org/packages/com.termux.boot/

# 2. Open Termux:Boot once to enable the service

# 3. Create the boot directory
mkdir -p ~/.termux/boot

# 4. Copy (or symlink) the start script
cp ~/coreops-starter-kit/boot/start-bots.sh ~/.termux/boot/coreops.sh
chmod +x ~/.termux/boot/coreops.sh

# 5. If your CoreOps install is somewhere else, edit the path:
nano ~/.termux/boot/coreops.sh
# Change COREOPS_INSTALL to match your actual path
```

---

## What happens on boot

1. Phone restarts → Termux:Boot triggers `~/.termux/boot/coreops.sh`
2. Script waits 10 seconds for the system to settle
3. **Supervisor bot** starts → launches Builder 1, Builder 2
4. **Watchdog bot** starts independently (monitors everything)
5. All activity logged to `~/Documents/CoreOps-Factory/logs/`

---

## Verify it's working

```bash
# Check boot log
cat ~/Documents/CoreOps-Factory/logs/boot.log

# Open the control panel
coreops panel

# Or run directly
bash ~/coreops-starter-kit/bots/control-panel.sh
```

---

## Disable auto-start

```bash
rm ~/.termux/boot/coreops.sh
```

---

## Factory Output Location

All built tools land in:

```
~/Documents/CoreOps-Factory/
  networking/     — HTTP testers, DNS tools, port scanners, etc.
  wrappers/       — curl-smart, git-quick, json-formatter, etc.
  developer/      — (reserved for future Builder Bot 3+)
  logs/           — Per-bot activity logs
  registry.db     — Duplicate-prevention registry
  catalog.json    — Full tool metadata catalog
```
