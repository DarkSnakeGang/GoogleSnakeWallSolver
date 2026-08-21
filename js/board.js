import {
  SIZES,
  parsePatternInput,
  emptyBits,
} from "./parse.js";
import { newPattern, wallMapToBits } from "./wall.js";

const boardEl = document.getElementById("board");
const snakeSvg = document.getElementById("snakeSvg");
const bitsEl = document.getElementById("bits");
const sizeSel = document.getElementById("boardSize");
const outEl = document.getElementById("boardOut");
const chipsEl = document.getElementById("boardChips");
const logEl = document.getElementById("solveLog");
const solveBtn = document.getElementById("solve");
const stopBtn = document.getElementById("stop");
const randomBtn = document.getElementById("boardRandom");
const copyBtn = document.getElementById("copyBits");
const clearBtn = document.getElementById("clearBoard");

let size = SIZES.small;
let cells = [];
let shownTour = null;
let shownTourCycle = false;
let worker = null;
let solveId = 0;
let solving = false;
let lastResult = null;
/** Skip URL→board sync while we are writing the URL ourselves. */
let syncingUrl = false;

/**
 * URL forms (query and/or hash):
 *   ?board=0101…&solve=1
 *   ?p=0101…&solve
 *   #board=0101…
 *   #board=0101…&solve=1
 * Pattern may also be pudding-style; we parse generously then canonicalize.
 */
function readUrlState() {
  const params = new URLSearchParams(location.search);
  const hashRaw = (location.hash || "").replace(/^#/, "");
  let hashParams = null;
  let bareHashBits = null;
  if (hashRaw) {
    if (hashRaw.includes("=")) {
      hashParams = new URLSearchParams(hashRaw);
    } else if (/^[012]+$/.test(hashRaw)) {
      bareHashBits = hashRaw;
    }
  }
  const pick = (...keys) => {
    for (const key of keys) {
      const q = params.get(key);
      if (q != null && q !== "") return q;
      if (hashParams) {
        const h = hashParams.get(key);
        if (h != null && h !== "") return h;
      }
    }
    return bareHashBits;
  };
  const pattern = pick("board", "p", "pattern");
  const solveRaw =
    params.get("solve") ??
    (hashParams ? hashParams.get("solve") : null) ??
    (/(?:^|[?&#])solve(?:[=&]|$)/i.test(location.href) ? "1" : null);
  const solve =
    solveRaw != null &&
    !["0", "false", "no", "off"].includes(String(solveRaw).toLowerCase());
  return { pattern, solve };
}

function writeUrlState({ bits = null, solve = false, replace = true } = {}) {
  const pattern = bits != null ? bits : bitsEl.value;
  const parsed = parsePatternInput(pattern);
  const canon = parsed.ok ? parsed.bits : null;
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  if (canon) {
    url.searchParams.set("board", canon);
    if (solve) url.searchParams.set("solve", "1");
  }
  const next = url.pathname + url.search + url.hash;
  const cur = location.pathname + location.search + location.hash;
  if (next === cur) return;
  syncingUrl = true;
  if (replace) history.replaceState(null, "", next);
  else history.pushState(null, "", next);
  queueMicrotask(() => {
    syncingUrl = false;
  });
}

function applyUrlState({ autoSolve = true } = {}) {
  const { pattern, solve } = readUrlState();
  if (!pattern) return false;
  const parsed = parsePatternInput(pattern);
  if (!parsed.ok) {
    outEl.textContent = parsed.error || "Invalid pattern in URL.";
    return false;
  }
  applyParsedBits(parsed);
  setIdleStatus();
  writeUrlState({ bits: parsed.bits, solve: false, replace: true });
  if (autoSolve && solve) {
    queueMicrotask(() => startSolve());
  }
  return true;
}

function boardCell() {
  const n = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--board-cell")
  );
  return Number.isFinite(n) && n > 0 ? n : 28;
}

function boardGap() {
  const n = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--board-gap")
  );
  return Number.isFinite(n) ? n : 0;
}

function cellIndex(r, c) {
  return r * size.width + c;
}

function rebuildGrid() {
  clearTour();
  boardEl.innerHTML = "";
  cells = [];
  boardEl.style.gridTemplateColumns = `repeat(${size.width}, var(--board-cell))`;
  document.getElementById("boardBtns").style.maxWidth =
    `calc(${size.width} * var(--board-cell) + ${size.width - 1} * var(--board-gap))`;
  for (let i = 0; i < size.cells; i++) {
    const d = document.createElement("div");
    const r = Math.floor(i / size.width);
    const c = i % size.width;
    d.className = "cell" + ((r + c) % 2 ? " chk" : "");
    d.onclick = () => {
      if (solving) return;
      clearTour();
      d.classList.toggle("wall");
      bitsFromBoard();
      lastResult = null;
      setIdleStatus();
      writeUrlState({ bits: bitsEl.value });
    };
    boardEl.appendChild(d);
    cells.push(d);
  }
  bitsEl.placeholder = `${size.cells} bits (1=wall 0=empty); paste also accepts pattern 12…`;
  if (bitsEl.value.length !== size.cells) {
    bitsEl.value = emptyBits(size.cells);
  }
  boardFromBits();
  fitBoardGrid();
}

function bitsFromBoard() {
  bitsEl.value = cells.map((c) => (c.classList.contains("wall") ? "1" : "0")).join("");
}

function boardFromBits() {
  const bits = bitsEl.value;
  clearTour();
  for (let i = 0; i < size.cells; i++) {
    cells[i].classList.toggle("wall", bits[i] === "1");
  }
}

function cellCenter(r, c) {
  const cell = boardCell();
  const gap = boardGap();
  return [c * (cell + gap) + cell / 2, r * (cell + gap) + cell / 2];
}

function clearTour() {
  shownTour = null;
  shownTourCycle = false;
  boardEl.classList.remove("solved");
  snakeSvg.innerHTML = "";
  cells.forEach((c) => {
    c.classList.remove("snake", "start", "end", "proof");
  });
}

function showTour(tour, isCycle) {
  const keep = tour;
  const keepC = !!isCycle;
  clearTour();
  shownTour = keep;
  shownTourCycle = keepC;
  if (!tour || !tour.length) return;
  boardEl.classList.add("solved");
  const cell = boardCell();
  const pts = tour.map(([r, c]) => cellCenter(r, c));
  const n = pts.length;
  const headI = n - 1;
  const neckI = n > 1 ? n - 2 : 0;
  let ux = 0;
  let uy = -1;
  if (n > 1) {
    const dx = pts[headI][0] - pts[neckI][0];
    const dy = pts[headI][1] - pts[neckI][1];
    const len = Math.hypot(dx, dy) || 1;
    ux = dx / len;
    uy = dy / len;
  }
  let tipPull = 0;
  let headPull = 0;
  if (n > 1) {
    const gapPx = Math.hypot(pts[0][0] - pts[headI][0], pts[0][1] - pts[headI][1]);
    if (gapPx < cell * 1.25) {
      tipPull = cell * 0.45;
      headPull = cell * 0.2;
    }
  }
  let tipX = pts[0][0];
  let tipY = pts[0][1];
  if (n > 1 && tipPull) {
    const dx = pts[1][0] - pts[0][0];
    const dy = pts[1][1] - pts[0][1];
    const len = Math.hypot(dx, dy) || 1;
    tipX += (dx / len) * tipPull;
    tipY += (dy / len) * tipPull;
  }
  const headX = pts[headI][0] - ux * headPull;
  const headY = pts[headI][1] - uy * headPull;
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  const headW = cell * 0.7;
  const tipW = cell * 0.32;
  const headCol = [0x5b, 0x8d, 0xef];
  const tipCol = [0x2a, 0x4a, 0xb8];
  const mix = (t) => {
    const c = headCol.map((v, i) => Math.round(v + (tipCol[i] - v) * t));
    return "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  const tAt = (i) => (n <= 1 ? 0 : (headI - i) / headI);
  const widthAt = (t) => headW * (1 - t) + tipW * t;
  const f = (v) => v.toFixed(1);
  const poly = [];
  poly.push([tipX, tipY, 1]);
  for (let i = 1; i < headI; i++) poly.push([pts[i][0], pts[i][1], tAt(i)]);
  poly.push([headX, headY, 0]);
  let body = "";
  for (let i = 0; i < poly.length - 1; i++) {
    const [x0, y0, t0] = poly[i];
    const [x1, y1, t1] = poly[i + 1];
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const u0 = s / steps;
      const u1 = (s + 1) / steps;
      const xa = x0 + (x1 - x0) * u0;
      const ya = y0 + (y1 - y0) * u0;
      const xb = x0 + (x1 - x0) * u1;
      const yb = y0 + (y1 - y0) * u1;
      const t = t0 * (1 - (u0 + u1) / 2) + t1 * ((u0 + u1) / 2);
      body += `<path d="M${f(xa)},${f(ya)} L${f(xb)},${f(yb)}" fill="none" stroke="${mix(t)}" stroke-width="${f(widthAt(t))}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  const col = mix(0);
  const neckR = headW / 2;
  const bulgeR = neckR * 0.82;
  const bulgeX = neckR * 0.12;
  const bulgeY = neckR * 0.92;
  const snoutR = neckR * 1.02;
  const snoutX = neckR * 0.78;
  const eyeR = Math.max(2.6, bulgeR * 0.72);
  const eyeX = bulgeX + bulgeR * 0.02;
  const eyeY = bulgeY;
  const pupilR = Math.max(1.3, eyeR * 0.4);
  const pupilFwd = eyeR * 0.38;
  const pupilIn = eyeR * 0.1;
  const nostrilR = Math.max(0.7, neckR * 0.08);
  const nostrilX = snoutX + snoutR * 0.58;
  const nostrilY = neckR * 0.14;
  snakeSvg.innerHTML = `
    <defs>
      <filter id="snakeShadow" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="${Math.max(1, cell * 0.05).toFixed(1)}" stdDeviation="${Math.max(1, cell * 0.045).toFixed(1)}" flood-color="#000" flood-opacity="0.4"/>
      </filter>
    </defs>
    <g filter="url(#snakeShadow)">${body}
      <g transform="translate(${f(headX)},${f(headY)}) rotate(${f(angle)})">
        <circle cx="0" cy="0" r="${f(neckR)}" fill="${col}"/>
        <circle cx="${f(bulgeX)}" cy="${f(-bulgeY)}" r="${f(bulgeR)}" fill="${col}"/>
        <circle cx="${f(bulgeX)}" cy="${f(bulgeY)}" r="${f(bulgeR)}" fill="${col}"/>
        <circle cx="${f(snoutX)}" cy="0" r="${f(snoutR)}" fill="${col}"/>
      </g>
    </g>
    <g transform="translate(${f(headX)},${f(headY)}) rotate(${f(angle)})">
      <circle cx="${f(eyeX)}" cy="${f(-eyeY)}" r="${f(eyeR)}" fill="#fff"/>
      <circle cx="${f(eyeX)}" cy="${f(eyeY)}" r="${f(eyeR)}" fill="#fff"/>
      <circle cx="${f(eyeX + pupilFwd)}" cy="${f(-eyeY + pupilIn)}" r="${f(pupilR)}" fill="#1a3a8a"/>
      <circle cx="${f(eyeX + pupilFwd)}" cy="${f(eyeY - pupilIn)}" r="${f(pupilR)}" fill="#1a3a8a"/>
      <circle cx="${f(nostrilX)}" cy="${f(-nostrilY)}" r="${f(nostrilR)}" fill="#2a4a9a" opacity="0.75"/>
      <circle cx="${f(nostrilX)}" cy="${f(nostrilY)}" r="${f(nostrilR)}" fill="#2a4a9a" opacity="0.75"/>
    </g>`;
  for (const [r, c] of tour) {
    const el = cells[cellIndex(r, c)];
    if (el) el.classList.add("snake");
  }
  cells[cellIndex(tour[0][0], tour[0][1])]?.classList.add("start");
  if (!isCycle) {
    const e = tour[tour.length - 1];
    cells[cellIndex(e[0], e[1])]?.classList.add("end");
  }
}

function showColoringProof(color, hasTour) {
  cells.forEach((c) => c.classList.remove("proof"));
  if (hasTour || !color) return;
  if (!color.path_coloring && !color.cycle_coloring) return;
  const cellsRc = [].concat(color.proof_cells || [], color.cycle_proof_cells || []);
  for (const rc of cellsRc) {
    const r = rc[0];
    const c = rc[1];
    const el = cells[cellIndex(r, c)];
    if (el) el.classList.add("proof");
  }
}

function addChip(label, cls) {
  const el = document.createElement("span");
  el.className = "chip " + cls;
  el.textContent = label;
  chipsEl.appendChild(el);
}

function boardStatus(data, solved, stopped) {
  const lines = [];
  const walls = data.walls != null ? data.walls : "?";
  lines.push(walls + " walls.");
  const c = data.coloring || {};
  if (c.black != null) {
    let color = `Coloring: ${c.black} black / ${c.white} white`;
    color += c.cycle_possible ? ", cycle possible" : ", cycle impossible";
    color += c.path_possible ? ", path possible" : ", path impossible";
    lines.push(color + ".");
    if (c.cycle_reasons && c.cycle_reasons.length) {
      for (const r of c.cycle_reasons) lines.push("Cycle coloring: " + r.text + ".");
    }
    if (c.reasons && c.reasons.length) {
      for (const r of c.reasons) lines.push("Path coloring: " + r.text + ".");
    }
  }
  if (stopped) lines.push("Stopped by user.");
  if (solved || data.tour) {
    const n = data.tour ? data.tour.length : 0;
    if (data.kind === "cycle") {
      lines.push("Hamiltonian cycle found (" + n + " cells). Best (head meets tail).");
    } else if (data.kind === "path" || data.tour) {
      const gap = data.end_gap != null ? data.end_gap : "?";
      const minGap = data.min_end_gap != null ? data.min_end_gap : "?";
      let line =
        "Hamiltonian path found (" +
        n +
        " cells), head–tail gap " +
        gap +
        " (closest possible " +
        minGap +
        ").";
      if (data.tour_best) line += " Best.";
      else if (data.tour_best === false) line += " Not proven closest.";
      lines.push(line);
    } else if (solved) {
      lines.push("No cycle or path found.");
    }
  }
  return lines.join("\n");
}

function setBoardStatus(data, solved, stopped = false) {
  lastResult = data;
  chipsEl.innerHTML = "";
  const c = (data && data.coloring) || {};
  showColoringProof(c, !!(data && data.tour));
  if (data) {
    const kind =
      data.kind ||
      (data.solution === "cycle" ? "cycle" : data.has_path === true ? "path" : null);
    if (kind === "cycle") addChip("Cycle", "cycle");
    else if (kind === "path") addChip("Path", "path");
    else if (solved && !data.tour) addChip("No", "none");
    if (c.cycle_coloring) addChip("Cycle coloring: no", "none");
    if (c.path_coloring) addChip("Path coloring: no", "none");
    if (stopped) addChip("Stopped", "notbest");
    if (data.tour) {
      if (kind === "cycle" || data.tour_best) addChip("Best", "best");
      else if (data.tour_best === false) addChip("Not proven closest", "notbest");
    }
  }
  outEl.textContent = boardStatus(data || {}, solved, stopped);
  outEl.classList.toggle(
    "tour-best",
    !!(data && data.tour && (data.tour_best || data.kind === "cycle"))
  );
  outEl.classList.toggle(
    "tour-open",
    !!(data && data.tour && data.kind !== "cycle" && data.tour_best === false)
  );
}

function setIdleStatus() {
  const walls = [...bitsEl.value].filter((ch) => ch === "1").length;
  outEl.textContent = `${walls} walls. Ready.`;
  outEl.classList.remove("tour-best", "tour-open");
  chipsEl.innerHTML = "";
}

function setBusy(busy) {
  solving = busy;
  solveBtn.disabled = busy;
  stopBtn.disabled = !busy;
  randomBtn.disabled = busy;
  sizeSel.disabled = busy;
  solveBtn.textContent = busy ? "Solving…" : "Solve";
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./solve-worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (err) => {
    appendLog("Worker error: " + (err.message || err));
    setBusy(false);
  };
  return worker;
}

function killWorker() {
  if (!worker) return;
  try {
    worker.postMessage({ type: "cancel" });
  } catch {
    /* ignore */
  }
  try {
    worker.terminate();
  } catch {
    /* ignore */
  }
  worker = null;
}

function appendLog(msg) {
  logEl.hidden = false;
  const cur = logEl.textContent ? logEl.textContent + "\n" + msg : msg;
  const lines = cur.split("\n");
  logEl.textContent = lines.slice(-200).join("\n");
  logEl.scrollTop = logEl.scrollHeight;
}

function onWorkerMessage(ev) {
  const msg = ev.data || {};
  if (msg.id !== solveId) return;
  if (msg.type === "log") {
    appendLog(msg.message);
    return;
  }
  if (msg.type === "tour") {
    if (msg.tour) showTour(msg.tour, msg.kind === "cycle");
    setBoardStatus(msg, true, false);
    return;
  }
  if (msg.type === "error") {
    outEl.textContent = "Solve failed: " + msg.message;
    setBusy(false);
    writeUrlState({ bits: bitsEl.value, solve: false });
    return;
  }
  if (msg.type === "done") {
    if (msg.tour) showTour(msg.tour, msg.kind === "cycle");
    setBoardStatus(msg, true, !!msg.stopped);
    if (msg.stopped) appendLog("Stopped.");
    setBusy(false);
    // Keep shareable pattern link; drop solve= so refresh does not re-run forever.
    writeUrlState({ bits: bitsEl.value, solve: false });
  }
}

function applyParsedBits(parsed, { rewrite = true } = {}) {
  if (parsed.size && parsed.size.id !== size.id) {
    size = parsed.size;
    sizeSel.value = size.id;
    rebuildGrid();
  }
  if (rewrite && parsed.ok) {
    bitsEl.value = parsed.bits;
    boardFromBits();
  }
}

function startSolve() {
  const parsed = parsePatternInput(bitsEl.value);
  if (!parsed.ok) {
    outEl.textContent = parsed.error;
    return;
  }
  applyParsedBits(parsed);
  clearTour();
  boardFromBits();
  writeUrlState({ bits: parsed.bits, solve: true });
  logEl.hidden = false;
  logEl.textContent = "";
  setBusy(true);
  const id = ++solveId;
  ensureWorker().postMessage({
    type: "solve",
    id,
    bits: parsed.bits,
    width: size.width,
    height: size.height,
  });
  outEl.textContent = "Solving…";
}

function stopSolve() {
  if (!solving) return;
  killWorker();
  setBusy(false);
  if (lastResult && lastResult.tour) {
    setBoardStatus(lastResult, true, true);
  } else {
    outEl.textContent = (outEl.textContent || "") + "\nStopped by user.";
  }
  appendLog("Stopped.");
  writeUrlState({ bits: bitsEl.value, solve: false });
}

function fitBoardGrid() {
  const wrap = document.querySelector(".board-wrap");
  const row = document.querySelector(".row");
  if (!wrap || !row) return;
  const availH = Math.max(120, row.clientHeight - 56);
  const availW = Math.max(120, Math.min(row.clientWidth * 0.55, window.innerWidth - 40));
  const cellW = Math.floor(availW / size.width);
  const cellH = Math.floor(availH / size.height);
  const cell = Math.max(10, Math.min(42, cellW, cellH));
  document.documentElement.style.setProperty("--board-cell", cell + "px");
  if (shownTour) showTour(shownTour, shownTourCycle);
}

// Size select
for (const s of Object.values(SIZES)) {
  const o = document.createElement("option");
  o.value = s.id;
  o.textContent = `${s.label} (${s.width}×${s.height})`;
  sizeSel.appendChild(o);
}
sizeSel.value = "small";
sizeSel.onchange = () => {
  size = SIZES[sizeSel.value] || SIZES.small;
  bitsEl.value = emptyBits(size.cells);
  rebuildGrid();
  setIdleStatus();
  writeUrlState({ bits: bitsEl.value });
};

bitsEl.addEventListener("input", () => {
  if (solving) return;
  const raw = bitsEl.value;
  const parsed = parsePatternInput(raw);
  if (parsed.ok) {
    applyParsedBits(parsed);
    setIdleStatus();
    writeUrlState({ bits: parsed.bits });
    return;
  }
  // Live toggle: if already canonical length for current size, apply directly
  const cleaned = [...raw].filter((ch) => "01".includes(ch)).join("");
  if (cleaned.length === size.cells && /^[01]+$/.test(cleaned)) {
    bitsEl.value = cleaned;
    boardFromBits();
    setIdleStatus();
    writeUrlState({ bits: cleaned });
  }
});

bitsEl.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text");
  const parsed = parsePatternInput(text);
  if (!parsed.ok) {
    outEl.textContent = parsed.error;
    return;
  }
  applyParsedBits(parsed);
  setIdleStatus();
  writeUrlState({ bits: parsed.bits });
});

solveBtn.onclick = () => startSolve();
stopBtn.onclick = () => stopSolve();
stopBtn.disabled = true;

randomBtn.onclick = () => {
  if (solving) return;
  const wmap = newPattern(size.width, size.height);
  bitsEl.value = wallMapToBits(wmap);
  boardFromBits();
  setIdleStatus();
  writeUrlState({ bits: bitsEl.value });
  appendLog(`Random pattern (${size.label}).`);
  logEl.hidden = false;
};

copyBtn.onclick = async () => {
  const parsed = parsePatternInput(bitsEl.value);
  const bits = parsed.ok ? parsed.bits : bitsEl.value.replace(/[^01]/g, "").slice(0, size.cells);
  bitsEl.value = bits.padEnd(size.cells, "0").slice(0, size.cells);
  boardFromBits();
  try {
    await navigator.clipboard.writeText(bitsEl.value);
    copyBtn.textContent = "Copied";
    setTimeout(() => {
      copyBtn.textContent = "Copy pattern";
    }, 1200);
  } catch {
    bitsEl.select();
  }
};

clearBtn.onclick = () => {
  if (solving) stopSolve();
  bitsEl.value = emptyBits(size.cells);
  boardFromBits();
  logEl.textContent = "";
  logEl.hidden = true;
  lastResult = null;
  outEl.textContent = "No board loaded.";
  outEl.classList.remove("tour-best", "tour-open");
  chipsEl.innerHTML = "";
  writeUrlState({ bits: null });
  // Clear query entirely
  syncingUrl = true;
  history.replaceState(null, "", location.pathname);
  queueMicrotask(() => {
    syncingUrl = false;
  });
};

window.addEventListener("resize", () => {
  requestAnimationFrame(fitBoardGrid);
});

window.addEventListener("popstate", () => {
  if (syncingUrl) return;
  if (!applyUrlState({ autoSolve: true })) {
    rebuildGrid();
    setIdleStatus();
  }
});

window.addEventListener("hashchange", () => {
  if (syncingUrl) return;
  applyUrlState({ autoSolve: true });
});

rebuildGrid();
if (!applyUrlState({ autoSolve: true })) {
  setIdleStatus();
}
