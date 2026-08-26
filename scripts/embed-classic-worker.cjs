/**
 * Rebuild js/hamilton-classic-worker.js and embed it into HamiltonMod.js.
 * Requires: npm install --no-save esbuild  (once)
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const build = spawnSync(process.execPath, [path.join(__dirname, "build-classic-worker.cjs")], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status || 1);

const worker = fs.readFileSync(path.join(root, "js/hamilton-classic-worker.js"), "utf8");
const modPath = path.join(root, "HamiltonMod.js");
let mod = fs.readFileSync(modPath, "utf8");
const start = "/* __HAMILTON_INLINE_WORKER_START__ */";
const end = "/* __HAMILTON_INLINE_WORKER_END__ */";
const block =
  start + "\n  HM._INLINE_CLASSIC_WORKER = " + JSON.stringify(worker) + ";\n  " + end;
if (!(mod.includes(start) && mod.includes(end))) {
  console.error("HamiltonMod.js missing inline worker markers");
  process.exit(1);
}
mod = mod.replace(new RegExp(start + "[\\s\\S]*?" + end), () => block);
fs.writeFileSync(modPath, mod);
console.log("embedded", worker.length, "bytes into HamiltonMod.js");
