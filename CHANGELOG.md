# Changelog

All notable changes to CoreOps Starter Kit are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- CONTRIBUTING.md, CHANGELOG.md, CODE_OF_CONDUCT.md
- Issue and pull request templates
- `.env.example` for documenting required secrets
- Dependabot configuration for npm ecosystem
- ATLAS Status Feed workflow for CI badge
- ATLAS Triage workflow for automated issue management

### Changed
- CodeQL workflow: removed Python language (no Python source in repo)
- CodeQL workflow: scoped triggers to `main` branch only
- `bin/coreops` shebang: replaced hardcoded Termux path with `#!/usr/bin/env bash`
- `.gitignore`: added env, OS, editor, and runtime output patterns

### Fixed
- `atlas-triage-shellcheck.yml`: missing closing braces in script block
- `repo-guard.yml`: pinned `actions/checkout` to `@v4`

### Removed
- Accidentally committed `${HOME}/Documents/CoreOps-Factory/registry.db`

---

## [1.0.0] — Initial Release

### Added
- CoreOps CLI (`coreops`) with commands: `doctor`, `netcheck`, `sslcheck`, `portscan`, `audit`, `scan`, `live`, `snapshot`, `deps`
- 4-bot automation factory system (supervisor, builder1, builder2, watchdog)
- Interactive GUI control panel (`coreops panel`)
- Cloudflare Workers + Static Assets deployment via Wrangler
- Atlas AI chat integration
- ShellCheck CI workflow
- CodeQL security scanning
