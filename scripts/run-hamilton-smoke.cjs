/**
 * Local smoke: hamilton-smoke.html via Playwright.
 * Requires: npx serve -l 3456 .  (repo root)
 */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => console.log("BROWSER:", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto("http://127.0.0.1:3456/hamilton-smoke.html", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForFunction(
    () => window.__hamiltonSmoke && window.__hamiltonSmoke.done,
    { timeout: 90000 }
  );
  const result = await page.evaluate(() => window.__hamiltonSmoke);
  const text = await page.locator("#out").innerText();
  console.log("--- OUT ---\n" + text);
  console.log("--- RESULT ---", JSON.stringify(result));
  await browser.close();
  if (!result.ok) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
