const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const MOD_URL = "https://darksnakegang.github.io/GoogleSnakeWallSolver/HamiltonMod.js";
const BASE = "https://darksnakegang.github.io/GoogleSnakeWallSolver/";
const GAME = "https://googlesnakemods.com/v/current/";

function localFileForUrl(url) {
  const u = new URL(url);
  if (!u.pathname.includes("/GoogleSnakeWallSolver/")) return null;
  const rel = u.pathname.split("/GoogleSnakeWallSolver/")[1] || "";
  const file = path.join(ROOT, rel.replace(/\//g, path.sep));
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (/Hamilton|paintFrame|paintOnto|Worker|error/i.test(t)) console.log("C:", t.slice(0, 200));
  });

  await page.route("**/*GoogleSnakeWallSolver*/**", async (route) => {
    const file = localFileForUrl(route.request().url());
    if (!file) return route.continue();
    const ext = path.extname(file).toLowerCase();
    return route.fulfill({
      status: 200,
      contentType: ext === ".js" ? "application/javascript" : "application/octet-stream",
      body: fs.readFileSync(file),
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });

  await context.addInitScript(({ modUrl, base }) => {
    localStorage.setItem("snakeChosenMod", "customUrl");
    localStorage.setItem("snakeForceDevMode", "true");
    localStorage.setItem(
      "snakeAdvancedSettings",
      JSON.stringify({ customUrl: modUrl, customModName: "HamiltonMod" })
    );
    window.HAMILTON_SOLVER_BASE = base;
  }, { modUrl: MOD_URL, base: BASE });

  await page.goto(GAME, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.HamiltonMod && window.HamiltonMod.paintFrame, { timeout: 180000 });

  const result = await page.evaluate(async () => {
    const HM = window.HamiltonMod;
    let paintFrameCalls = 0;
    let paintBufferCalls = 0;
    const pf = HM.paintFrame.bind(HM);
    const pb = HM.paintOntoBuffer.bind(HM);
    HM.paintFrame = function () {
      paintFrameCalls++;
      return pf.apply(this, arguments);
    };
    HM.paintOntoBuffer = function () {
      paintBufferCalls++;
      return pb.apply(this, arguments);
    };

    window.CurrentModeNum = 1;
    window.timeKeeper = window.timeKeeper || {
      getCurrentSetting: (k) => (k === "size" ? 1 : 0),
    };
    window.wallCoords = [[1, 1], [4, 3], [8, 5]];
    HM.notifyWallSpawn();

    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (HM.currentTour && HM.currentTour.length > 5) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    if (!HM.currentTour) return { ok: false, reason: "no tour", paintFrameCalls, paintBufferCalls };

    // Wait for a few animation frames so compositor render can fire
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    // Also try clicking play to start rendering if needed
    const buttons = Array.from(document.querySelectorAll("div,button"));
    const play = buttons.find((b) => /play|jouer|spielen/i.test(b.textContent || ""));
    if (play) play.click();
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }

    return {
      ok: paintFrameCalls + paintBufferCalls > 0,
      tourLen: HM.currentTour.length,
      paintFrameCalls,
      paintBufferCalls,
      boardProps: HM._boardProps,
      indicator: !!document.getElementById("hamilton-mod-indicator"),
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!result.ok) process.exit(1);
  console.log("RENDER HOOK TEST PASSED");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
