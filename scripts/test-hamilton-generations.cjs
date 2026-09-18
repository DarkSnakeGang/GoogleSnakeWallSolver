/**
 * Node regression: solve generations bump + stale messages ignored.
 * Does not need Playwright — loads HamiltonMod.js in a vm sandbox.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const code = fs.readFileSync(path.join(root, "HamiltonMod.js"), "utf8");

const window = {
  NepDebug: false,
  wallCoords: [],
  timeKeeper: {
    getCurrentSetting(k) {
      return k === "size" ? 1 : 0;
    },
  },
  CurrentModeNum: 1,
};
const sandbox = {
  window,
  console,
  URL,
  Blob: class Blob {
    constructor(parts) {
      this.parts = parts;
    }
  },
  Worker: class Worker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
    }
    postMessage() {}
    terminate() {}
  },
  document: {
    getElementById() {
      return null;
    },
    getElementsByClassName() {
      return [];
    },
    createElement() {
      return {
        style: {},
        getContext() {
          return null;
        },
      };
    },
    querySelector() {
      return null;
    },
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  performance: { now: () => Date.now() },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const HM = window.HamiltonMod;
HM.runCodeBefore();

const dims = { width: 10, height: 9, cells: 90 };
const empty90 = "0".repeat(90);
const impossible = "0" + "1".repeat(89);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Colorings
assert(
  !HM.isColoringImpossible(HM.pathColoringFromBits(empty90, 10, 9)),
  "empty board should be coloring-possible"
);
assert(
  HM.isColoringImpossible(HM.pathColoringFromBits(impossible, 10, 9)),
  "single open cell should be coloring-impossible"
);

// Generation A (would search)
HM._startSolve(empty90, dims);
const idA = HM.solveId;
const bitsA = HM._activeBits;
assert(idA >= 1, "solveId bumped");
assert(HM.iconState === "searching", "searching on solvable pattern");
assert(HM.solvePhase === "searching", "phase searching");

// Fake a live tour for A
HM.onWorkerMessage({
  type: "tour",
  id: idA,
  bits: bitsA,
  tour: [
    [0, 0],
    [0, 1],
  ],
  kind: "path",
});
assert(HM.currentTour && HM.currentTour.length === 2, "tour applied for active id");
assert(HM.iconState === "ok", "ok after tour");

// Supersede with coloring-impossible B
HM._startSolve(impossible, dims);
const idB = HM.solveId;
assert(idB !== idA, "solveId must change");
assert(HM.iconState === "none", "immediate none on impossible");
assert(!HM.currentTour, "tour cleared");
assert(HM.solvePhase === "none", "phase none");

// Stale A results must not apply
HM.onWorkerMessage({
  type: "tour",
  id: idA,
  bits: bitsA,
  tour: [
    [1, 1],
    [1, 2],
    [1, 3],
  ],
  kind: "cycle",
});
HM.onWorkerMessage({
  type: "done",
  id: idA,
  bits: bitsA,
  tour: [
    [1, 1],
    [1, 2],
    [1, 3],
  ],
  kind: "cycle",
  stopped: false,
});
assert(!HM.currentTour, "stale tour ignored");
assert(HM.iconState === "none", "stale done ignored");

// stopped done for active id ignored
HM.onWorkerMessage({
  type: "done",
  id: idB,
  bits: impossible,
  tour: [
    [2, 2],
    [2, 3],
  ],
  kind: "path",
  stopped: true,
});
assert(!HM.currentTour, "stopped done ignored");
assert(HM.iconState === "none", "icon stays none");

// Wrong bits for active id ignored
HM.onWorkerMessage({
  type: "tour",
  id: idB,
  bits: empty90,
  tour: [
    [3, 3],
    [3, 4],
  ],
  kind: "path",
});
assert(!HM.currentTour, "wrong-bits tour ignored");

// Reset bumps generation
const idBeforeReset = HM.solveId;
HM.onGameReset();
assert(HM.solveId !== idBeforeReset, "reset bumps solveId");
assert(HM.iconState === "idle", "idle after reset");
assert(!HM._activeBits, "active bits cleared");

console.log("PASS: hamilton solve-generation regression");
