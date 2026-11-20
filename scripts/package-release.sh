#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run build

OUT_DIR="$ROOT_DIR/release"
ZIP_NAME="dao-den-long-web-v1.0.0.zip"
ZIP_PATH="$OUT_DIR/$ZIP_NAME"

mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

mkdir -p "$STAGE_DIR/scripts"
cp -R "$ROOT_DIR/dist" "$STAGE_DIR/dist"
cp "$ROOT_DIR/scripts/play.mjs" "$STAGE_DIR/scripts/play.mjs"
cp "$ROOT_DIR/scripts/leaderboard.mjs" "$STAGE_DIR/scripts/leaderboard.mjs"

cat > "$STAGE_DIR/RUN.txt" <<'EOF'
1. unzip dao-den-long-web-v1.0.0.zip -d dao-den-long && cd dao-den-long
2. node scripts/play.mjs   (requires Node >= 20; opens the game in your default browser)
EOF

(
  cd "$STAGE_DIR"
  zip -r "$ZIP_PATH" dist scripts/play.mjs scripts/leaderboard.mjs RUN.txt >/dev/null
)

echo "Created $ZIP_PATH"
