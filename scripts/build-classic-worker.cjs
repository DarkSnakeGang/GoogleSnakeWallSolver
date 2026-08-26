const esbuild = require("esbuild");
const path = require("path");

const root = path.join(__dirname, "..");

esbuild
  .build({
    entryPoints: [path.join(root, "js/hamilton-classic-entry.js")],
    bundle: true,
    format: "iife",
    platform: "browser",
    outfile: path.join(root, "js/hamilton-classic-worker.js"),
    logLimit: 0,
    plugins: [
      {
        name: "stub-wasm",
        setup(build) {
          build.onResolve({ filter: /warnsdorff\.js$/ }, () => ({
            path: path.join(root, "js/warnsdorff-stub.js"),
          }));
          build.onResolve({ filter: /dfs-wasm\.js$/ }, () => ({
            path: path.join(root, "js/dfs-wasm-stub.js"),
          }));
        },
      },
    ],
  })
  .then(() => console.log("built js/hamilton-classic-worker.js"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
