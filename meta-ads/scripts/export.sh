#!/usr/bin/env bash
# Create a clean, Replit-ready export ZIP of the project.
#
# Excludes:
#   - node_modules/                (user will npm install)
#   - data/*.db, *.sqlite*         (local data; user gets fresh DB)
#   - .env, .env.*                 (secrets)
#   - .git/                        (VCS metadata)
#   - *.log, .DS_Store             (noise)
#   - CLAUDE.md, AGENTS.md         (internal assistant guidance)
#   - .claude/, .anthropic/        (assistant-only config)
#
# Usage:
#   bash scripts/export.sh [output-name]
# Default output: dist/meta-ads-<YYYYMMDD-HHMMSS>.zip

set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"
PROJECT_NAME="meta-ads"

# Resolve output path.
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_NAME="${1:-${PROJECT_NAME}-${STAMP}.zip}"
DIST_DIR="${PROJECT_ROOT}/dist"
mkdir -p "$DIST_DIR"
OUT_PATH="${DIST_DIR}/${OUT_NAME}"

# Require zip binary.
if ! command -v zip >/dev/null 2>&1; then
  echo "Error: 'zip' is not installed. Install it (apt install zip / brew install zip) and retry." >&2
  exit 1
fi

# Remove stale archive at the same path.
rm -f "$OUT_PATH"

echo "Creating export: $OUT_PATH"

# Build zip from project root, excluding everything private.
# Using -x patterns relative to the cwd (project root).
zip -r "$OUT_PATH" . \
  -x "node_modules/*" \
  -x "dist/*" \
  -x ".git/*" \
  -x ".gitignore" \
  -x ".env" \
  -x ".env.*" \
  -x "data/*.db" \
  -x "data/*.db-*" \
  -x "data/*.sqlite" \
  -x "data/*.sqlite-*" \
  -x "*.log" \
  -x ".DS_Store" \
  -x "CLAUDE.md" \
  -x "AGENTS.md" \
  -x ".claude/*" \
  -x ".anthropic/*" \
  -x "scripts/export.sh" \
  > /dev/null

SIZE="$(du -h "$OUT_PATH" | cut -f1)"
echo ""
echo "Done. $OUT_PATH ($SIZE)"
echo ""
echo "To deploy on Replit:"
echo "  1. Upload this zip to a new Repl."
echo "  2. Run:   npm install"
echo "  3. Start: npm start   (binds 0.0.0.0:5000)"
