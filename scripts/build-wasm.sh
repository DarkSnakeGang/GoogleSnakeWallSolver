#!/usr/bin/env bash
# Build warnsdorff.wasm + glue with Emscripten (emsdk / docker).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/wasm"
SRC="$ROOT/native"
mkdir -p "$OUT"

EMCC="${EMCC:-emcc}"
if ! command -v "$EMCC" >/dev/null 2>&1; then
  echo "emcc not found; trying docker emscripten/emsdk..." >&2
  docker run --rm -v "$ROOT:/src" -w /src emscripten/emsdk:3.1.74 \
    emcc -O3 \
      native/warnsdorff_dfs_c.c \
      -I native \
      -s MODULARIZE=1 \
      -s EXPORT_NAME=createWarnsdorffModule \
      -s EXPORT_ES6=1 \
      -s ENVIRONMENT=web,worker,node \
      -s ALLOW_MEMORY_GROWTH=1 \
      -s EXPORTED_FUNCTIONS='["_dfs_configure","_dfs_set_cancelled","_warnsdorff_dfs_run","_malloc","_free"]' \
      -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","getValue","setValue","HEAPU32","HEAP32","HEAPU8"]' \
      -o wasm/warnsdorff.js
  echo "Wrote wasm/warnsdorff.js and wasm/warnsdorff.wasm"
  exit 0
fi

"$EMCC" -O3 \
  "$SRC/warnsdorff_dfs_c.c" \
  -I "$SRC" \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createWarnsdorffModule \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker,node \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_dfs_configure","_dfs_set_cancelled","_warnsdorff_dfs_run","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","getValue","setValue","HEAPU32","HEAP32","HEAPU8"]' \
  -o "$OUT/warnsdorff.js"

echo "Wrote $OUT/warnsdorff.js and $OUT/warnsdorff.wasm"
