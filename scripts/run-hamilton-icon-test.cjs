/**
 * Verify score-bar trophy (native UEI8qf / Counter #stat-icon) recolors correctly.
 * Does NOT inject a fake #stat-icon — uses the real Google Snake top bar.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    const t = msg.text();
    if (/Hamilton|error|Error|FAIL/i.test(t)) console.log("CONSOLE:", t.slice(0, 300));
  });

  await page.route("**/*GoogleSnakeWallSolver*/**", async (route) => {
    const file = localFileForUrl(route.request().url());
    if (!file) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: fs.readFileSync(file),
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  });

  await context.addInitScript(
    ({ modUrl, base }) => {
      localStorage.setItem("snakeChosenMod", "customUrl");
      localStorage.setItem("snakeForceDevMode", "true");
      localStorage.setItem(
        "snakeAdvancedSettings",
        JSON.stringify({ customUrl: modUrl, customModName: "HamiltonMod" })
      );
      window.HAMILTON_SOLVER_BASE = base;
    },
    { modUrl: MOD_URL, base: BASE }
  );

  console.log("Navigating to", GAME);
  await page.goto(GAME, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => !!(window.HamiltonMod && window.HamiltonMod.setWallIconState),
    { timeout: 180000 }
  );
  await page.waitForSelector("canvas", { timeout: 60000 });

  await page.evaluate(() => {
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

  const brickStats = async (label) =>
    page.evaluate(async (label) => {
      const HM = window.HamiltonMod;
      const el = HM.getScoreBarIcon();
      const rgb = (c) => {
        if (!c) return null;
        const m = String(c)
          .replace(/\s/g, "")
          .match(/^rgba?\((\d+),(\d+),(\d+)/i);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      };
      let bricks = 0;
      let mortar = 0;
      let blueish = 0;
      let reddish = 0;
      if (el && el.src.startsWith("data:image/")) {
        const img = new Image();
        img.src = el.src;
        await new Promise((r) => (img.onload = r));
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          const a = d[i + 3];
          if (a < 8) continue;
          if (b > r + 20 && b > g && a >= 85) {
            bricks++;
            blueish++;
          } else if (r > g + 20 && r > b + 20 && a >= 85) {
            bricks++;
            reddish++;
          } else if (g > r + 8 && g > b + 8) {
            mortar++;
          }
        }
      }
      return {
        label,
        found: !!el,
        jsname: el && el.getAttribute("jsname"),
        iconState: HM.iconState,
        isDataUrl: !!(el && el.src.startsWith("data:image/")),
        srcTail: el && (el.src || "").slice(-40),
        fruitSrcTail:
          document.querySelector('.sEOCsb img[jsname="lh7ff"]') &&
          document
            .querySelector('.sEOCsb img[jsname="lh7ff"]')
            .src.slice(-40),
        fruitHasMask: false,
        deathHasMask: false,
        bricks,
        mortar,
        blueish,
        reddish,
      };
    }, label);

  await page.evaluate(() => window.HamiltonMod.setWallIconState("searching"));
  await page.waitForFunction(
    () => {
      const el = window.HamiltonMod.getScoreBarIcon();
      return el && el.src.startsWith("data:image/");
    },
    { timeout: 10000 }
  );
  const searching = await brickStats("searching");
  console.log("searching", JSON.stringify(searching, null, 2));
  assert(searching.isDataUrl, "searching: expected recolored data URL");
  assert(searching.bricks > 100, "searching: expected brick pixels");
  assert(searching.mortar > 50, "searching: mortar should remain");
  assert(searching.blueish > searching.bricks * 0.8, "searching: bricks should be blue");

  await page.evaluate(() => window.HamiltonMod.setWallIconState("ok"));
  const ok = await page.evaluate(() => {
    const el = window.HamiltonMod.getScoreBarIcon();
    return {
      iconState: window.HamiltonMod.iconState,
      isDataUrl: el.src.startsWith("data:image/"),
      srcTail: el.src.slice(-40),
      hasMask: !!(el.style.maskImage || el.style.webkitMaskImage),
    };
  });
  console.log("ok", JSON.stringify(ok, null, 2));
  assert(ok.iconState === "ok", "iconState not ok");
  assert(!ok.isDataUrl, "ok: should restore PNG src");
  assert(!ok.hasMask, "ok: mask should clear");
  assert(/trophy_01\.png/i.test(ok.srcTail || ""), "ok: should restore green wall trophy");

  await page.evaluate(() => window.HamiltonMod.setWallIconState("none"));
  await page.waitForFunction(
    () => {
      const el = window.HamiltonMod.getScoreBarIcon();
      return el && el.src.startsWith("data:image/");
    },
    { timeout: 10000 }
  );
  const none = await brickStats("none");
  console.log("none", JSON.stringify(none, null, 2));
  assert(none.isDataUrl, "none: expected recolored data URL");
  assert(none.reddish > none.bricks * 0.8, "none: bricks should be red");
  assert(none.mortar > 50, "none: mortar should remain");

  // Live solve path: searching → ok (or none)
  await page.evaluate(() => {
    window.CurrentModeNum = 1;
    window.wallCoords = [
      [2, 2],
      [5, 4],
      [7, 6],
    ];
  });
  const duringSolve = await page.evaluate(async () => {
    const HM = window.HamiltonMod;
    HM.notifyWallSpawn();
    const mid = [];
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      mid.push(HM.iconState);
      if (HM.iconState === "ok" || HM.iconState === "none") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    const el = HM.getScoreBarIcon();
    return {
      states: mid,
      final: HM.iconState,
      tourLen: HM.currentTour ? HM.currentTour.length : 0,
      isDataUrl: !!(el && el.src.startsWith("data:image/")),
    };
  });
  console.log("solvePath", JSON.stringify(duringSolve, null, 2));
  assert(
    duringSolve.states.includes("searching"),
    "solve never set searching: " + duringSolve.states.join(",")
  );
  assert(
    duringSolve.final === "ok" || duringSolve.final === "none",
    "solve did not settle: " + duringSolve.final
  );
  if (duringSolve.final === "ok") {
    assert(duringSolve.tourLen > 0, "ok without tour");
    assert(!duringSolve.isDataUrl, "ok after solve should restore PNG");
  } else {
    assert(duringSolve.isDataUrl, "none after solve should use recolored PNG");
  }

  const shot = path.join(ROOT, "hamilton-icon-test.png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log("screenshot", shot);
  console.log("ICON TEST PASSED");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
