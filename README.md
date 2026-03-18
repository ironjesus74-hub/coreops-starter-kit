# CoreOps Starter Kit ⚡

[![ShellCheck](https://github.com/ironjesus74-hub/coreops-starter-kit/actions/workflows/shellcheck.yml/badge.svg)](https://github.com/ironjesus74-hub/coreops-starter-kit/actions/workflows/shellcheck.yml)
[![Repo Guard](https://github.com/ironjesus74-hub/coreops-starter-kit/actions/workflows/repo-guard.yml/badge.svg)](https://github.com/ironjesus74-hub/coreops-starter-kit/actions/workflows/repo-guard.yml)
[![CodeQL](https://github.com/ironjesus74-hub/coreops-starter-kit/actions/workflows/codeql.yml/badge.svg)](https://github.com/ironjesus74-hub/coreops-starter-kit/actions/workflows/codeql.yml)
![Shell](https://img.shields.io/badge/language-bash-blue)
![Platform](https://img.shields.io/badge/platform-Termux%20%7C%20Linux-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

Mobile-first DevOps & automation CLI built for Termux + minimal Linux.

**Fast. Portable. No bloat.**  
Run network + TLS checks, quick diagnostics, and generate a system snapshot in seconds.

## 🔴 Live Monitor Dashboard

![CoreOps Live Monitor](assets/coreops-live-dashboard.png)

---

## ✨ Highlights
- ✅ Runs on Android (Termux) + Linux
- ⚡ Quick commands: `doctor`, `netcheck`, `portscan`, `sslcheck`, `snapshot`
- 🤖 4-bot automation system with GUI control panel
- 🏭 Auto-builds & catalogs 24 tools into `~/Documents/CoreOps-Factory/`
- 🧩 Modular structure (easy to add new tools)
- 🧼 Minimal dependencies

---

![CoreOps Audit Demo](audit-demo.png)

## 🚀 Quick Start (Termux)

```bash
pkg update -y
pkg install -y git
git clone https://github.com/ironjesus74-hub/coreops-starter-kit.git
cd coreops-starter-kit
chmod +x bin/* modules/*.sh lib/*.sh bots/*.sh bots/lib/*.sh bots/tools/*.sh install.sh
./install.sh
coreops help
```

- On Android 14+ with stricter `/sdcard` writes, use the one-block Termux installer: [docs/termux-android14.md](docs/termux-android14.md).

---

## 🤖 Bot System

CoreOps includes a 4-bot automation factory that builds tools and scripts into
`~/Documents/CoreOps-Factory/` — automatically, 24/7, from the moment you launch it.

### The 4 Bots

| Bot | Role | Category |
|-----|------|----------|
| **Supervisor** | Admin — launches & polices the other 3 bots. Pauses/quarantines rogue bots. | Admin |
| **Builder Bot 1** | Builds networking & developer tools (HTTP testers, DNS tools, port scanners…) | networking/ |
| **Builder Bot 2** | Builds wrappers & scripts (curl-smart, git-quick, json-formatter…) | wrappers/ |
| **Watchdog** | Stealth health-keeper — silently monitors all bots, restarts on crash | background |

### Factory Output

All built tools land in `~/Documents/CoreOps-Factory/`:

```
~/Documents/CoreOps-Factory/
  networking/     — 12 tools: http-endpoint-tester, dns-bulk-lookup, ssl-expiry-checker…
  wrappers/       — 12 tools: curl-smart, git-quick, env-manager, process-manager…
  logs/           — Per-bot activity logs
  registry.db     — Duplicate-prevention registry (never builds the same tool twice)
  catalog.json    — Full tool metadata (name, category, version, built-by, built-on)
```

Each tool is stamped with a metadata header:

```bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  CoreOps Factory — Auto-Generated Tool                       ║
# ╠══════════════════════════════════════════════════════════════╣
# ║  Tool        : curl-smart
# ║  Category    : wrappers
# ║  Version     : 1.0.0
# ║  Built by    : CoreOps Builder Bot 2
# ║  Built on    : 2025-01-15 09:30:00
# ╚══════════════════════════════════════════════════════════════╝
```

### Start the Bots

```bash
# Open the interactive GUI control panel
coreops panel

# Or use the CLI
coreops bots start    # start all bots (via supervisor)
coreops bots stop     # stop all bots
coreops bots status   # show running/stopped status
coreops bots factory  # list all built tools
```

### Auto-Start on Phone Restart (Termux:Boot)

```bash
# Install Termux:Boot from F-Droid, then:
mkdir -p ~/.termux/boot
cp ~/coreops-starter-kit/boot/start-bots.sh ~/.termux/boot/coreops.sh
chmod +x ~/.termux/boot/coreops.sh
```

See [boot/README.md](boot/README.md) for full setup instructions.

---

## 📦 Built Tools Reference

### networking/ (Builder Bot 1)

| Tool | Description |
|------|-------------|
| `http-endpoint-tester.sh` | Test HTTP/HTTPS endpoints for status and response time |
| `dns-bulk-lookup.sh` | Resolve many hostnames at once with pass/fail reporting |
| `webhook-sender.sh` | Send test webhooks with custom JSON payload |
| `api-health-checker.sh` | Continuously poll API endpoints and report health |
| `latency-monitor.sh` | Ping-based RTT monitoring with colored bar chart |
| `ssl-expiry-checker.sh` | Check SSL cert expiry for one or many hosts |
| `port-range-scanner.sh` | Scan TCP port ranges and report open ports |
| `network-speed-test.sh` | Measure download bandwidth in Mbps |
| `whois-lookup.sh` | WHOIS lookup with key field filtering |
| `ip-geolocation.sh` | Geolocate IPs: country, region, ISP, ASN |
| `traceroute-reporter.sh` | Color-coded traceroute with latency highlighting |
| `curl-debug-inspector.sh` | Full HTTP debug: timing, headers, body preview |

### wrappers/ (Builder Bot 2)

| Tool | Description |
|------|-------------|
| `curl-smart.sh` | curl with retry, exponential back-off, error reporting |
| `json-formatter.sh` | Format/validate/query JSON (jq or python3) |
| `git-quick.sh` | Git shortcuts: save, undo, sync, clean, log |
| `log-tail.sh` | Tail logs with color-coded ERROR/WARN/INFO levels |
| `env-manager.sh` | Manage .env files: list, get, set, delete, export |
| `backup-files.sh` | Timestamped backups with automatic rotation |
| `cron-helper.sh` | Cron manager: list, add, remove, templates |
| `deploy-helper.sh` | rsync deploy with pre/post hooks |
| `process-manager.sh` | Background process manager: start, stop, list, restart |
| `file-organizer.sh` | Auto-sort files by type into subdirectories |
| `api-mock-server.sh` | Lightweight HTTP mock server (python3/nc) |
| `base64-tools.sh` | Base64 encode/decode with URL-safe variant |

---

## 🛠 All CLI Commands

```
CoreOps Starter Kit

Usage:
  coreops help
  coreops deps
  coreops doctor
  coreops netcheck
  coreops sslcheck <host> [port]
  coreops portscan <host> <port>
  coreops audit <host>
  coreops scan <host>
  coreops live <host> [interval_seconds]
  coreops snapshot

  coreops bots <start|stop|status|factory>
  coreops panel
```
