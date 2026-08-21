/**
 * Solve pipeline worker: coloring → path → cycle → closest.
 * Messages in: { type: "solve", bits, width, height, id }
 *            { type: "cancel" }
 * Messages out: { type: "log"|"tour"|"done"|"error", ... }
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
} from "./hampath.js";
import { Pattern, bitsToWallMap } from "./wall.js";

let cancelled = false;

setCancelCheck(() => cancelled);

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  if (msg.type !== "solve") return;
  cancelled = false;
  const { bits, width, height, id } = msg;
  try {
    const result = runSolve(bits, width, height, id);
    self.postMessage({
      type: "done",
      id,
      stopped: cancelled,
      ...result,
    });
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      message: err && err.message ? err.message : String(err),
    });
  }
};

function emit(id, text) {
  self.postMessage({ type: "log", id, message: text });
}

function emitTour(id, payload) {
  self.postMessage({ type: "tour", id, ...payload });
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
    if (color.path_possible && !cancelled) {
      emit(id, "searching for a path");
      const found = findHamiltonianPath(grid);
      if (cancelled) return finish(tour, cycle, tourBest, color, bits, walls, cycleOpen);
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

    if (color.cycle_possible && !cycle && !cancelled) {
      emit(id, "searching for a cycle");
      const wmap = bitsToWallMap(bits, width, height);
      const pattern = new Pattern(width, height, { wmap, walls });
      pattern._progress = {
        tick(extra) {
          emit(id, extra || "cycle search");
        },
      };
      pattern._cancelled = () => cancelled;
      const res = pattern.solve();
      if (cancelled) return finish(tour, cycle, tourBest, color, bits, walls, cycleOpen);
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

    if (tour && !cycle && !cancelled) {
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
            tour = t;
            tourBest = best;
            if (g === 1 && t.length % 2 === 0) {
              cycle = true;
              tourBest = true;
              emit(id, "gap 1 is a cycle");
              push(tour, true, true);
              return;
            }
            emit(id, `closer path (gap ${g})`);
            push(tour, false, best);
          },
        });
        if (cancelled) return finish(tour, cycle, tourBest, color, bits, walls, cycleOpen);
        tour = newTour || tour;
        if (newGap === 1 && tour && tour.length % 2 === 0) {
          cycle = true;
          tourBest = true;
          emit(id, "cycle found from adjacent ends");
          push(tour, true, true);
        } else {
          tourBest = isBest;
          if (tourBest) emit(id, `best head-tail gap ${newGap} (minimum ${minGap})`);
          else emit(id, `gap ${newGap}, not proven closest (minimum ${minGap})`);
          push(tour, false, tourBest);
        }
      }
    }

    return finish(tour, cycle, tourBest, color, bits, walls, cycleOpen);
  });
}
