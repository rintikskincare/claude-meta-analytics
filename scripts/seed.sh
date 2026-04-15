#!/usr/bin/env bash
# Seed demo data into the local SQLite DB without booting the server.
set -euo pipefail
cd "$(dirname "$0")/.."
node -e "const r = require('./services/seed').seed(); console.log('seeded', r);"
