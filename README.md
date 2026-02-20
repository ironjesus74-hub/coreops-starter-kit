# CoreOps Starter Kit ⚡
Mobile-first DevOps & automation CLI built for Termux + minimal Linux.

**Fast. Portable. No bloat.**  
Run network + TLS checks, quick diagnostics, and generate a system snapshot in seconds.

---

## ✨ Highlights
- ✅ Runs on Android (Termux) + Linux
- ⚡ Quick commands: `doctor`, `netcheck`, `portscan`, `sslcheck`, `snapshot`
- 🧩 Modular structure (easy to add new tools)
- 🧼 Minimal dependencies

---

## 🚀 Quick Start (Termux)

```bash
pkg update -y
pkg install -y git
git clone https://github.com/ironjesus74-hub/coreops-starter-kit.git
cd coreops-starter-kit
chmod +x bin/* modules/*.sh lib/*.sh install.sh
./install.sh
coreops help

