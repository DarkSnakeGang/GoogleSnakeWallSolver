/**
 * Classic (non-module) worker entry — same protocol as solve-worker.js.
 * Bundled to js/hamilton-classic-worker.js for blob Workers under game CSP.
 */
import {
  configureBoard,
  pathColoringReport,
  bitsToGrid,
  findHamiltonianPath,
  improvePathEndpoints,
  pathEndGap,
  minPathEndGap,
  tourFromSnakemap,
  progressScope,
  setCancelCheck,
  initDfsWasm,
  dfsWasmReady,
  syncWasmCancel,
} from "./hampath.js";
import { dfsWasmSetCancelled } from "./dfs-wasm-stub.js";
import { Pattern, bitsToWallMap } from "./wall.js";

let cancelled = false;
let activeSolveId = 0;
let dfsBackendLogged = false;

setCancelCheck(() => cancelled);

const wasmInit = initDfsWasm();

function isActive(id) {
  return id === activeSolveId && !cancelled;
}

function postActive(id, payload) {
  if (!isActive(id) && payload.type !== "done") return;
  // Still emit done for the active id so the host can see stopped=true;
  // skip entirely if a newer solve already replaced this id.
  if (id !== activeSolveId) return;
  self.postMessage(payload);
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === "cancel") {
    cancelled = true;
    dfsWasmSetCancelled(true);
    syncWasmCancel();
    return;
  }
  if (msg.type !== "solve") return;

  const { bits, width, height, id } = msg;
  activeSolveId = id;
  cancelled = false;
  dfsWasmSetCancelled(false);

  try {
    await wasmInit;
    // A newer solve or cancel may have arrived while awaiting wasm.
    if (id !== activeSolveId) return;
    if (cancelled) {
      postActive(id, {
        type: "done",
        id,
        stopped: true,
        bits,
        walls: 0,
        coloring: null,
        tour: null,
        kind: "none",
        has_path: false,
        tour_best: null,
        end_gap: null,
        min_end_gap: null,
      });
      return;
    }
    if (!dfsBackendLogged) {
      dfsBackendLogged = true;
      postActive(id, {
        type: "log",
        id,
        message: dfsWasmReady() ? "DFS: wasm" : "DFS: js",
      });
    }
    if (id !== activeSolveId || cancelled) return;
    const result = runSolve(bits, width, height, id);
    postActive(id, {
      type: "done",
      id,
      stopped: cancelled || id !== activeSolveId,
      ...result,
    });
  } catch (err) {
    if (id !== activeSolveId) return;
    postActive(id, {
      type: "error",
      id,
      message: err && err.message ? err.message : String(err),
    });
  }
};

function emit(id, text) {
  postActive(id, { type: "log", id, message: text });
}

function emitTour(id, payload) {
  postActive(id, { type: "tour", id, ...payload });
}

function finish(tour, cycle, tourBest, color, bits, walls, cycleOpen) {
  const gap = pathEndGap(tour, cycle);
  const minGap = tour
    ? minPathEndGap(tour.length, cycle ? true : cycleOpen)
    : null;
  return {
    bits,
    walls,
    coloring: color,
    tour,
    kind: cycle ? "cycle" : tour ? "path" : "none",
    has_path: !!(cycle || tour),
    tour_best: cycle ? true : tourBest,
    end_gap: gap,
    min_end_gap: minGap,
  };
}

function runSolve(bits, width, height, id) {
  configureBoard(width, height);
  const walls = [...bits].filter((ch) => ch === "1").length;
  const grid = bitsToGrid(bits);
  const color = pathColoringReport(grid);
  emit(
    id,
    `${walls} walls · coloring ${color.black} black / ${color.white} white` +
      ` · cycle ${color.cycle_possible ? "possible" : "impossible"}` +
      ` · path ${color.path_possible ? "possible" : "impossible"}`
  );

  let tour = null;
  let cycle = false;
  let tourBest = null;
  const cycleOpen = !!color.cycle_possible;

  const push = (curTour, curCycle, curBest) => {
    const gap = pathEndGap(curTour, curCycle);
    const minGap = minPathEndGap(
      curTour ? curTour.length : 0,
      curCycle ? true : cycleOpen
    );
    emitTour(id, {
      bits,
      walls,
      coloring: color,
      tour: curTour,
      kind: curCycle ? "cycle" : curTour ? "path" : "none",
      has_path: !!(curCycle || curTour),
      tour_best: curBest,
      end_gap: gap,
      min_end_gap: minGap,
    });
  };

  if (!color.path_possible && !color.cycle_possible) {
    emit(id, "coloring rules out a cycle and a path");
    return finish(null, false, null, color, bits, walls, cycleOpen);
  }

  return progressScope((msg) => emit(id, msg), 1000, () => {
    if (color.path_possible && isActive(id)) {
      emit(id, "searching for a path");
      const found = findHamiltonianPath(grid);
      if (!isActive(id)) {
        return finish(tour, cycle, tourBest, color, bits, walls, cycleOpen);
      }
      if (found) {
        tour = found;
        const gap = pathEndGap(found);
        const minGap = minPathEndGap(found.length, cycleOpen);
        tourBest = gap != null && minGap != null && gap <= minGap;
        emit(id, `path found (gap ${gap})`);
        push(tour, false, tourBest);
      } else {
        emit(id, "no path");
      }
    }

    if (color.cycle_possible && !cycle && isActive(id)) {
      emit(id, "searching for a cycle");
      const wmap = bitsToWallMap(bits, width, height);
      const pattern = new Pattern(width, height, { wmap, walls });
      pattern._progress = {
        tick(extra) {
          emit(id, extra || "cycle search");
        },
      };
      pattern._cancelled = () => !isActive(id);
      const res = pattern.solve();
      if (!isActive(id)) {
        return finish(tour, cycle, tourBest, color, bits, walls, cycleOpen);
      }
      if (res) {
        const found = tourFromSnakemap(res.wallmap, res.snakemap);
        if (found) {
          tour = found;
          cycle = true;
          tourBest = true;
          emit(id, "cycle found");
          push(tour, true, true);
        }
      } else {
        emit(id, "no cycle");
      }
    }

    if (tour && !cycle && isActive(id)) {
      const gap = pathEndGap(tour);
      const minGap = minPathEndGap(tour.length, cycleOpen);
      if (gap != null && minGap != null && gap <= minGap) {
        tourBest = true;
        emit(id, `already closest (gap ${gap}, minimum ${minGap})`);
        push(tour, false, true);
      } else {
        emit(id, `searching closest (gap ${gap}, minimum ${minGap})`);
        const [newTour, newGap, isBest] = improvePathEndpoints(grid, tour, {
          cyclePossible: cycleOpen,
          onBetter(t, g, best) {
            if (!isActive(id)) return;
            tour = t;
            tourBest = best;
            if (g === 1 && t.length % 2 === 0) {
              cycle = true;
              tourBest = true;
              emit(id, "gap 1 is a cycle");
              push(tour, true, true);
            } else {
              push(tour, false, best);
            }
          },
        });
        if (newTour) tour = newTour;
        if (newGap != null) {
          /* keep */
        }
        if (isBest) tourBest = true;
      }
    }

    return finish(tour, cycle, tourBest, color, bits, walls, cycleOpen);
  });
}
