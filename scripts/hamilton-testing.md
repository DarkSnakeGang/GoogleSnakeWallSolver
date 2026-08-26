# Hamilton Mod testing

Harnesses for iterating on [`HamiltonMod.js`](../HamiltonMod.js) without guessing.

## Prerequisites

```bash
# from repo root
npx --yes serve -l 3456 .
npm install --no-save playwright
npx playwright install chromium   # once
```

Keep the static server running for smoke tests. In-game tests hit googlesnakemods.com and **route** Pages URLs to your local files (no deploy required).

## Scripts

| Command | What it tests |
|---------|----------------|
| `node scripts/run-hamilton-smoke.cjs` | Local page: icon (trophy only), classic Worker solve, `paintTour` |
| `node scripts/run-hamilton-smoke3.cjs` | Extra Worker cases (empty + one wall) after smoke page |
| `node scripts/run-hamilton-ingame.cjs` | **Real** [googlesnakemods.com/v/current](https://googlesnakemods.com/v/current/): load mod, Worker solve, no freeze, fruit untouched |
| `node scripts/run-hamilton-icon-test.cjs` | **Real** top-bar trophy (`UEI8qf`): blue searching → green/default ok → red none; fruit + death icon untouched |
| `node scripts/run-hamilton-render-hook.cjs` | Real game: `paintFrame` / `paintOntoBuffer` fire during compositor render |
| `node scripts/build-classic-worker.cjs` | Rebuild `js/hamilton-classic-worker.js` after solver changes |

Open [`hamilton-smoke.html`](../hamilton-smoke.html) manually at `http://127.0.0.1:3456/hamilton-smoke.html` if you want the browser UI.

## Notes

- Custom mod name on the site must be `HamiltonMod` (matches `window.HamiltonMod`).
- The solver Worker is **inlined** inside `HamiltonMod.js` (blob Worker — no Pages fetch). After changing solver code: `npm install --no-save esbuild` then `node scripts/embed-classic-worker.cjs`.
- In-game scripts can still route Pages URLs to disk when useful.
- Screenshot from the last in-game run: `hamilton-ingame-test.png` (generated).
