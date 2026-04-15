#!/usr/bin/env bash
# Local start helper: production mode.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_ENV=${NODE_ENV:-production}
export PORT=${PORT:-5000}
export HOST=${HOST:-0.0.0.0}
exec node server.js
