#!/usr/bin/env bash
# Double-click this file in Finder to start the Meta Ads Analytics server.
# The Terminal window that opens is the server — close it to stop.
set -e
cd "$(dirname "$0")"

# Install dependencies the first time.
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install
fi

# Open the browser after a short delay so the server has time to boot.
(sleep 1.5 && open "http://localhost:5000") &

echo "Starting Meta Ads Analytics on http://localhost:5000"
echo "Close this window to stop the server."
echo ""
exec npm start
