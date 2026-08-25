/**
 * Warnsdorff DFS WebAssembly glue (WallResearch C kernel).
 * Falls back gracefully when wasm is unavailable.
 */

import createWarnsdorffModule from "../wasm/warnsdorff.js";

const MASK_WORDS = 8;
const MASK_BYTES = MASK_WORDS * 8;

let Module = null;
let ready = false;
let configuredW = 0;
let configuredH = 0;

export function dfsWasmReady() {
  return ready;
}

export async function initDfsWasm() {
  if (ready) return true;
  try {
    Module = await createWarnsdorffModule({
      locateFile(path) {
        if (path.endsWith(".wasm")) {
          return new URL(`../wasm/${path}`, import.meta.url).href;
        }
        return path;
      },
    });
    ready = true;
    return true;
  } catch (err) {
    console.warn("DFS WASM unavailable, using JS:", err);
    ready = false;
    Module = null;
    return false;
  }
}

export function dfsWasmConfigure(width, height) {
  if (!ready || !Module) return;
  if (configuredW === width && configuredH === height) return;
  Module._dfs_configure(width, height);
  configuredW = width;
  configuredH = height;
}

export function dfsWasmSetCancelled(cancelled) {
  if (!ready || !Module) return;
  Module._dfs_set_cancelled(cancelled ? 1 : 0);
}

/** Pack BigInt mask into 8 little-endian uint64 limbs in HEAP. */
function writeMask(ptr, rem) {
  let bits = BigInt(rem);
  const heap = Module.HEAPU32;
  const base = ptr >>> 2;
  for (let i = 0; i < MASK_WORDS; i++) {
    const lo = Number(bits & 0xffffffffn);
    const hi = Number((bits >> 32n) & 0xffffffffn);
    heap[base + i * 2] = lo >>> 0;
    heap[base + i * 2 + 1] = hi >>> 0;
    bits >>= 64n;
  }
}

/**
 * Run Warnsdorff DFS in WASM.
 * @returns {boolean|number[]} true/false, or path indices when wantPath
 */
export function dfsWasmRun(
  head,
  rem,
  nleft,
  black,
  requiredEnd,
  {
    nodeLimit = 0,
    wantPath = false,
    useMemo = false,
    nodes = null,
  } = {}
) {
  if (!ready || !Module) return null;

  const remPtr = Module._malloc(MASK_BYTES);
  const pathCap = wantPath ? Math.max(1, nleft) : 0;
  const pathPtr = wantPath ? Module._malloc(pathCap * 4) : 0;
  const pathLenPtr = wantPath ? Module._malloc(4) : 0;
  const nodesPtr = Module._malloc(4);

  try {
    writeMask(remPtr, rem);
    Module.HEAP32[nodesPtr >> 2] = nodes ? nodes[0] | 0 : 0;
    if (pathLenPtr) Module.HEAP32[pathLenPtr >> 2] = 0;

    const req = requiredEnd == null ? -1 : requiredEnd | 0;
    const ok = Module._warnsdorff_dfs_run(
      head | 0,
      remPtr,
      nleft | 0,
      black | 0,
      req,
      nodeLimit | 0,
      wantPath ? 1 : 0,
      useMemo ? 1 : 0,
      pathPtr,
      pathCap,
      pathLenPtr,
      nodesPtr
    );

    if (nodes) nodes[0] = Module.HEAP32[nodesPtr >> 2] | 0;

    if (!ok) return false;
    if (!wantPath) return true;

    const len = Module.HEAP32[pathLenPtr >> 2] | 0;
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = Module.HEAP32[(pathPtr >> 2) + i] | 0;
    }
    return out;
  } finally {
    Module._free(remPtr);
    if (pathPtr) Module._free(pathPtr);
    if (pathLenPtr) Module._free(pathLenPtr);
    Module._free(nodesPtr);
  }
}
