# Contributing to CoreOps Starter Kit

Thank you for your interest in contributing.

## How to Contribute

### Reporting Bugs

Open an issue using the **Bug Report** template and include:
- Steps to reproduce
- Expected vs. actual behavior
- Environment (OS, Termux version, Bash version)

### Suggesting Features

Open an issue using the **Feature Request** template. Be specific about the use case.

### Submitting Pull Requests

1. Fork the repository and create a branch: `feature/<short-description>` or `fix/<short-description>`
2. Make focused, minimal changes — one concern per PR
3. Ensure all shell scripts pass ShellCheck (`shellcheck -S error`)
4. Add or update documentation where relevant
5. Open the PR against `main` with a clear description

## Code Style

- Shell scripts: use `set -euo pipefail`, prefer `[[ ]]` over `[ ]`, double-quote variables
- Keep scripts portable across Bash 4+ and Termux
- No hardcoded absolute paths — use `${COREOPS_HOME}` or `${HOME}` variables

## Running ShellCheck Locally

```bash
shellcheck -S error bin/coreops modules/*.sh lib/*.sh bots/*.sh bots/lib/*.sh bots/tools/*.sh
```

## License

By contributing, you agree your contributions will be licensed under the MIT License.
