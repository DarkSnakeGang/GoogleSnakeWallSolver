const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => console.log("B:", msg.text()));
  await page.goto("http://127.0.0.1:3456/hamilton-smoke.html", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__hamiltonSmoke && window.__hamiltonSmoke.done);

  const results = await page.evaluate(async () => {
    const out = [];
    function waitDone(expectedId, ms) {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          const m = window.__lastWorkerMsg;
          if (m && m.id === expectedId && (m.type === "done" || m.type === "error")) {
            clearInterval(iv);
            resolve(m);
          } else if (Date.now() - t0 > ms) {
            clearInterval(iv);
            resolve(null);
          }
        }, 30);
      });
    }

    const orig = window.HamiltonMod.onWorkerMessage.bind(window.HamiltonMod);
    window.HamiltonMod.onWorkerMessage = function (msg) {
      window.__lastWorkerMsg = msg;
      orig(msg);
    };

    const worker = await window.HamiltonMod.ensureWorker();
    out.push({ step: "worker", ok: !!worker });

    // 1) empty
    let id = ++window.HamiltonMod.solveId;
    window.__lastWorkerMsg = null;
    worker.postMessage({ type: "solve", id, bits: "0".repeat(90), width: 10, height: 9 });
    let msg = await waitDone(id, 60000);
    out.push({
      step: "empty",
      ok: !!(msg && msg.tour && msg.tour.length === 90),
      kind: msg && msg.kind,
      len: msg && msg.tour && msg.tour.length,
    });

    // 2) one wall
    const bits = "0".repeat(90).split("");
    bits[11] = "1";
    id = ++window.HamiltonMod.solveId;
    window.__lastWorkerMsg = null;
    worker.postMessage({ type: "solve", id, bits: bits.join(""), width: 10, height: 9 });
    msg = await waitDone(id, 60000);
    out.push({
      step: "oneWall",
      ok: !!(msg && msg.type === "done"),
      kind: msg && msg.kind,
      len: msg && msg.tour && msg.tour.length,
      hasTour: !!(msg && msg.tour),
    });

    // 3) icon fruit isolation again after solve
    const fruit = document.getElementById("fruit-icon").src;
    window.HamiltonMod.setWallIconState("searching");
    out.push({
      step: "fruitIsolation",
      ok: document.getElementById("fruit-icon").src === fruit,
      hasMask: !!(document.getElementById("stat-icon").style.maskImage || document.getElementById("stat-icon").style.webkitMaskImage),
    });

    return out;
  });

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
  if (!results.every((r) => r.ok)) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
