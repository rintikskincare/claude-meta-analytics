#!/usr/bin/env bash
# Local dev helper: auto-reloads on file change (Node >= 20 --watch).
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_ENV=development
export PORT=${PORT:-3001}
exec node --watch server.js
