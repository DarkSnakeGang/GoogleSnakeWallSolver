const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("ERR:", msg.text());
  });
  await page.goto("http://127.0.0.1:3456/hamilton-smoke.html", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__hamiltonSmoke && window.__hamiltonSmoke.done, { timeout: 90000 });

  // Extra: worker with a few walls on small board
  const extra = await page.evaluate(async () => {
    const bits = "0".repeat(90).split("");
    // place non-adjacent walls
    bits[22] = "1"; bits[44] = "1"; bits[66] = "1";
    const pattern = bits.join("");
    window.__doneMsg = null;
    window.__tourSeen = false;
    const id = ++window.HamiltonMod.solveId;
    window.HamiltonMod.clearTour();
    const worker = await window.HamiltonMod.ensureWorker();
    if (!worker) return { ok: false, reason: "no worker" };
    worker.postMessage({ type: "solve", id, bits: pattern, width: 10, height: 9 });
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (window.__doneMsg && window.__doneMsg.id === id) break;
      // onWorkerMessage filters by solveId — reuse same handler
      await new Promise((r) => setTimeout(r, 50));
    }
    const msg = window.__doneMsg;
    return {
      ok: !!(msg && msg.tour && msg.tour.length),
      kind: msg && msg.kind,
      len: msg && msg.tour && msg.tour.length,
      has: !!(window.HamiltonMod.currentTour),
    };
  });
  console.log("walled pattern:", JSON.stringify(extra));

  // alterSnakeCode against pudding dump if available
  const patch = await page.evaluate(async () => {
    try {
      const res = await fetch("http://127.0.0.1:3456/../GoogleSnakePudding/testCode.js");
      return { skipped: true, reason: "cross path" };
    } catch (e) {
      return { skipped: true, reason: String(e) };
    }
  });
  console.log("patch check:", patch);

  await browser.close();
  if (!extra.ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
