# Contributing to CoreOps Starter Kit

CoreOps is a solo-maintained, mobile-first DevOps toolkit. Contributions are welcome as long as they keep things simple, portable, and bloat-free.

## Ground Rules

- Keep scripts portable: target Bash 5+ on Termux (Android) and standard Linux
- No new runtime dependencies without a strong reason
- All shell scripts must pass `shellcheck -S error`
- No secrets, credentials, or personal data in commits

## Getting Started

```bash
git clone https://github.com/ironjesus74-hub/coreops-starter-kit.git
cd coreops-starter-kit
chmod +x bin/* modules/*.sh lib/*.sh
chmod +x bots/*.sh bots/lib/*.sh bots/tools/*.sh
./install.sh
coreops help
```

## Adding a Module

1. Create `modules/<name>.sh` with a `#!/usr/bin/env bash` shebang
2. Add a case entry in `bin/coreops` under the `case "$cmd"` block
3. Document the command in the `help` section of `bin/coreops`
4. Run ShellCheck: `shellcheck -S error modules/<name>.sh`

## Pull Requests

- Open a PR against `main`
- Fill out the PR template
- Keep changes focused — one feature or fix per PR

## Reporting Issues

Use the issue templates in `.github/ISSUE_TEMPLATE/` for bug reports and feature requests.
