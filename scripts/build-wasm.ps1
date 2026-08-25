# Build warnsdorff.wasm via Docker Emscripten (no local emsdk required).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
New-Item -ItemType Directory -Force -Path "$Root\wasm" | Out-Null

docker run --rm -v "${Root}:/src" -w /src emscripten/emsdk:3.1.74 `
  emcc -O3 `
    native/warnsdorff_dfs_c.c `
    -I native `
    -s MODULARIZE=1 `
    -s EXPORT_NAME=createWarnsdorffModule `
    -s EXPORT_ES6=1 `
    -s ENVIRONMENT=web,worker,node `
    -s ALLOW_MEMORY_GROWTH=1 `
    "-sEXPORTED_FUNCTIONS=[`"_dfs_configure`",`"_dfs_set_cancelled`",`"_warnsdorff_dfs_run`",`"_malloc`",`"_free`"]" `
    "-sEXPORTED_RUNTIME_METHODS=[`"cwrap`",`"ccall`",`"getValue`",`"setValue`",`"HEAPU32`",`"HEAP32`",`"HEAPU8`"]" `
    -o wasm/warnsdorff.js

Write-Host "Wrote wasm/warnsdorff.js and wasm/warnsdorff.wasm"
