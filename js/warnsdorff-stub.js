/** No-op WASM module for classic worker bundle. */
export default async function createWarnsdorffModule() {
  throw new Error("WASM disabled in classic worker");
}
