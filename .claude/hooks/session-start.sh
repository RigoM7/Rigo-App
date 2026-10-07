#!/usr/bin/env bash
# Installs packages quietly at the start of a session when they are missing or the lockfile changed.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
stamp=node_modules/.package-lock.json
if [ ! -f "$stamp" ] || [ package-lock.json -nt "$stamp" ]; then
  npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1 || echo "npm ci failed; run it by hand to see why."
fi
exit 0
