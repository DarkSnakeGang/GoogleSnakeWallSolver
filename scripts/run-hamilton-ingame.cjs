/**
 * In-game Hamilton Mod test on googlesnakemods.com (real snake + our local files via route).
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const MOD_URL =
  "https://darksnakegang.github.io/GoogleSnakeWallSolver/HamiltonMod.js";
const BASE = "https://darksnakegang.github.io/GoogleSnakeWallSolver/";
const GAME = "https://googlesnakemods.com/v/current/";

function localFileForUrl(url) {
  const u = new URL(url);
  if (!u.pathname.includes("/GoogleSnakeWallSolver/")) return null;
  const rel = u.pathname.split("/GoogleSnakeWallSolver/")[1] || "";
  const file = path.join(ROOT, rel.replace(/\//g, path.sep));
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  return null;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-web-security"], // allow worker/blob quirks in test
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  page.on("console", (msg) => {
    const t = msg.text();
    logs.push(t);
    if (/Hamilton|error|Error|FAIL|Worker|CSP/i.test(t)) {
      console.log("CONSOLE:", t.slice(0, 300));
    }
  });
  page.on("pageerror", (err) => {
    console.log("PAGEERROR:", err.message);
    logs.push("PAGEERROR " + err.message);
  });

  // Serve local WallSolver assets whenever the game requests them from Pages.
  await page.route("**/*GoogleSnakeWallSolver*/**", async (route) => {
    const req = route.request();
    const file = localFileForUrl(req.url());
    if (!file) {
      console.log("ROUTE miss", req.url());
      return route.continue();
    }
    const ext = path.extname(file).toLowerCase();
    const type =
      ext === ".js"
        ? "application/javascript"
        : ext === ".wasm"
          ? "application/wasm"
          : "application/octet-stream";
    console.log("ROUTE local", path.relative(ROOT, file));
    return route.fulfill({
      status: 200,
      contentType: type,
      body: fs.readFileSync(file),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    });
  });

  // Pre-select customUrl mod → HamiltonMod.js (routed to local)
  await context.addInitScript(
    ({ modUrl, base }) => {
      localStorage.setItem("snakeChosenMod", "customUrl");
      localStorage.setItem("snakeForceDevMode", "true");
      const adv = {
        customUrl: modUrl,
        customModName: "HamiltonMod",
      };
      localStorage.setItem("snakeAdvancedSettings", JSON.stringify(adv));
      window.HAMILTON_SOLVER_BASE = base;
    },
    { modUrl: MOD_URL, base: BASE }
  );

  console.log("Navigating to", GAME);
  await page.goto(GAME, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Wait for Hamilton to load (mod name must match window.HamiltonMod)
  await page.waitForFunction(
    () => !!(window.HamiltonMod && window.HamiltonMod.notifyWallSpawn),
    { timeout: 180000 }
  );
  console.log("HamiltonMod present");

  // Wait for game canvas
  await page.waitForSelector(".jNB0Ic, canvas", { timeout: 60000 });
  console.log("canvas present");

  // Use native score-bar icons (no fake #stat-icon). Wall mode + play so trophy shows.
  await page.evaluate(() => {
    window.CurrentModeNum = 1;
    if (!window.timeKeeper) {
      window.timeKeeper = {
        getCurrentSetting: function (k) {
          return k === "size" ? 1 : 0;
        },
      };
    }
    const trophy = document.getElementById("trophy");
    if (trophy && trophy.children && trophy.children[1]) {
      trophy.children[1].click();
    }
    const play =
      document.querySelector('[jsname="NSjDf"]') ||
      document.querySelector('[jsname="i3F3K"]');
    if (play) play.click();
  });
  await page.waitForFunction(
    () => !!document.querySelector('.sEOCsb img[jsname="UEI8qf"]'),
    { timeout: 30000 }
  );

  const fruitBefore = await page.evaluate(() => {
    const fruit = document.querySelector('.sEOCsb img[jsname="lh7ff"]');
    return fruit ? fruit.src : null;
  });

  // Trigger solve as wall mode would after a successful wall spawn
  const solveResult = await page.evaluate(async () => {
    const HM = window.HamiltonMod;
    window.wallCoords = [
      [2, 2],
      [5, 4],
      [7, 6],
    ];
    const t0 = performance.now();
    let frozen = false;
    // Detect main-thread freeze: schedule a timer; if it doesn't fire soon after notify, something blocked.
    let tick = 0;
    const iv = setInterval(() => {
      tick++;
    }, 16);

    HM.notifyWallSpawn();

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (HM.currentTour && HM.currentTour.length > 10) break;
      if (HM.iconState === "none" && !HM.currentTour) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    clearInterval(iv);
    const elapsed = performance.now() - t0;
    // If interval barely advanced while waiting a long time, we were frozen
    const expectedTicks = elapsed / 16;
    frozen = tick < expectedTicks * 0.2 && elapsed > 2000;

    return {
      iconState: HM.iconState,
      tourLen: HM.currentTour ? HM.currentTour.length : 0,
      isCycle: HM.isCycle,
      elapsedMs: Math.round(elapsed),
      ticks: tick,
      frozen,
      hasWorker: !!HM.worker,
      workerUnavailable: HM.iconState === "worker",
      boardProps: !!HM._boardProps,
    };
  });

  console.log("solveResult", JSON.stringify(solveResult, null, 2));

  const iconCheck = await page.evaluate((fruitBefore) => {
    const fruit = document.querySelector('.sEOCsb img[jsname="lh7ff"]');
    const stat = window.HamiltonMod.getScoreBarIcon();
    return {
      fruitUnchanged: !fruit || fruit.src === fruitBefore,
      targetJsname: stat && stat.getAttribute("jsname"),
      targetId: stat && stat.id,
      statHasMask: !!(
        stat &&
        (stat.style.maskImage || stat.style.webkitMaskImage)
      ),
      iconState: window.HamiltonMod.iconState,
      indicator: !!document.getElementById("hamilton-mod-indicator"),
    };
  }, fruitBefore);

  console.log("iconCheck", JSON.stringify(iconCheck, null, 2));

  // Call paintTour onto a scratch canvas (compositor hook may need real frames)
  const paintOk = await page.evaluate(() => {
    try {
      const c = document.createElement("canvas");
      c.width = 200;
      c.height = 200;
      const ctx = c.getContext("2d");
      if (!window.HamiltonMod.currentTour) return { ok: false, reason: "no tour" };
      window.HamiltonMod.paintTour(ctx, 16, 0, 0);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  });
  console.log("paintOk", paintOk);

  const ok =
    solveResult.tourLen > 10 &&
    !solveResult.frozen &&
    iconCheck.fruitUnchanged &&
    paintOk.ok;

  // Keep a screenshot for evidence
  const shot = path.join(ROOT, "hamilton-ingame-test.png");
  await page.screenshot({ path: shot, fullPage: true });
  console.log("screenshot", shot);

  await browser.close();

  if (!ok) {
    console.error("INGAME TEST FAILED");
    process.exit(1);
  }
  console.log("INGAME TEST PASSED");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
