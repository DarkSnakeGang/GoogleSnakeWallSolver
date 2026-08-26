(() => {
  // js/dfs-wasm-stub.js
  function dfsWasmReady() {
    return false;
  }
  async function initDfsWasm() {
    return false;
  }
  function dfsWasmConfigure() {
  }
  function dfsWasmSetCancelled() {
  }
  function dfsWasmRun() {
    return false;
  }

  // js/hampath.js
  var WALL = 2;
  var WIDTH = 10;
  var HEIGHT = 9;
  var N = WIDTH * HEIGHT;
  var NEIGHBORS = [];
  var NBR_MASK = [];
  var DY = [-1, 1, 0, 0];
  var DX = [0, 0, -1, 1];
  var OPP = [1, 0, 3, 2];
  var activeProgress = null;
  var cancelCheck = null;
  var cancelCounter = 0;
  function bit(i) {
    return 1n << BigInt(i);
  }
  function bitCount(value) {
    let count = 0;
    for (let bits = value; bits; bits &= bits - 1n) count++;
    return count;
  }
  function lowestBitIndex(value) {
    if (!value) return -1;
    let index = 0;
    for (let bits = value; (bits & 1n) === 0n; bits >>= 1n) index++;
    return index;
  }
  function checkCancelled(force = false) {
    if (!cancelCheck) return false;
    if (!force && (++cancelCounter & 4095) !== 0) return false;
    return Boolean(cancelCheck());
  }
  function setCancelCheck(fn) {
    if (fn != null && typeof fn !== "function") {
      throw new TypeError("cancel check must be a function or null");
    }
    cancelCheck = fn || null;
    cancelCounter = 0;
    dfsWasmSetCancelled(false);
  }
  function syncWasmCancel() {
    dfsWasmSetCancelled(Boolean(cancelCheck && cancelCheck()));
  }
  function configureBoard(width = 10, height = 9) {
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
      throw new RangeError("board width and height must be positive integers");
    }
    WIDTH = width;
    HEIGHT = height;
    N = width * height;
    NEIGHBORS = Array.from({ length: N }, (_, i) => {
      const r = Math.floor(i / WIDTH);
      const c = i % WIDTH;
      const out = [];
      if (r > 0) out.push(i - WIDTH);
      if (r + 1 < HEIGHT) out.push(i + WIDTH);
      if (c > 0) out.push(i - 1);
      if (c + 1 < WIDTH) out.push(i + 1);
      return out;
    });
    NBR_MASK = NEIGHBORS.map((neighbors) => {
      let mask = 0n;
      for (const neighbor of neighbors) mask |= bit(neighbor);
      return mask;
    });
    dfsWasmConfigure(width, height);
  }
  configureBoard();
  var SearchProgress = class {
    constructor(emit2, interval = 1e3) {
      if (typeof emit2 !== "function") throw new TypeError("emit must be a function");
      this.emit = emit2;
      this.interval = interval < 10 ? interval * 1e3 : interval;
      this.t0 = performance.now();
      this.last = 0;
      this.steps = 0;
      this.phase = "start";
    }
    setPhase(phase) {
      this.phase = phase;
      this.steps = 0;
      this.send("", true);
    }
    add(n = 1, extra = "") {
      this.steps += n;
      if ((this.steps & 8191) === 0) this.maybeSend(extra);
    }
    tick(extra = "") {
      this.steps++;
      this.maybeSend(extra);
    }
    maybeSend(extra = "") {
      if (performance.now() - this.last >= this.interval) this.send(extra);
    }
    send(extra = "", force = false) {
      const now = performance.now();
      if (!force && now - this.last < this.interval) return;
      this.last = now;
      const elapsed = (now - this.t0) / 1e3;
      const parts = [`${elapsed.toFixed(0)}s`, this.phase];
      if (this.steps) {
        parts.push(`${this.steps.toLocaleString()} steps`);
        if (elapsed >= 1) parts.push(`${Math.round(this.steps / elapsed).toLocaleString()}/s`);
      }
      if (extra) parts.push(extra);
      this.emit(parts.join(" \xB7 "));
    }
  };
  function progressScope(emit2, interval = 1e3, run = null) {
    if (typeof interval === "function") {
      run = interval;
      interval = 1e3;
    }
    const previous = activeProgress;
    const progress = new SearchProgress(emit2, interval);
    activeProgress = progress;
    progress.close = () => {
      if (activeProgress === progress) activeProgress = previous;
    };
    progress.dispose = progress.close;
    if (typeof run !== "function") return progress;
    try {
      const result = run(progress);
      if (result && typeof result.finally === "function") {
        return result.finally(() => progress.close());
      }
      progress.close();
      return result;
    } catch (error) {
      progress.close();
      throw error;
    }
  }
  function currentProgress() {
    return activeProgress;
  }
  function idx(r, c) {
    return r * WIDTH + c;
  }
  function cellOf(i) {
    return [Math.floor(i / WIDTH), i % WIDTH];
  }
  function colorOf(i) {
    const [r, c] = cellOf(i);
    return r + c & 1;
  }
  function validateGrid(grid) {
    if (!Array.isArray(grid) || grid.length !== HEIGHT || grid.some((row) => !Array.isArray(row) || row.length !== WIDTH)) {
      throw new RangeError(`expected ${HEIGHT}x${WIDTH} grid`);
    }
  }
  function freeMask(grid) {
    let free = 0n;
    for (let r = 0; r < HEIGHT; r++) {
      for (let c = 0; c < WIDTH; c++) {
        if (grid[r][c] !== WALL) free |= bit(idx(r, c));
      }
    }
    return free;
  }
  function degree(i, remaining) {
    return bitCount(NBR_MASK[i] & remaining);
  }
  function reachableMask(start, remaining) {
    let seen = 0n;
    const stack = [start];
    while (stack.length) {
      if (checkCancelled()) return seen;
      const i = stack.pop();
      const cellBit = bit(i);
      if (seen & cellBit) continue;
      seen |= cellBit;
      let rest = NBR_MASK[i] & remaining & ~seen;
      while (rest) {
        const nextBit = rest & -rest;
        stack.push(lowestBitIndex(nextBit));
        rest ^= nextBit;
      }
    }
    return seen;
  }
  function coloringAllowsPath(grid) {
    let black = 0;
    let white = 0;
    for (let r = 0; r < HEIGHT; r++) {
      for (let c = 0; c < WIDTH; c++) {
        if (grid[r][c] !== WALL) r + c & 1 ? black++ : white++;
      }
    }
    return Math.abs(black - white) <= 1;
  }
  function pathColoringReport(grid) {
    validateGrid(grid);
    const free = freeMask(grid);
    const nfree = bitCount(free);
    let black = 0;
    let white = 0;
    const deg1 = [];
    const isolated = [];
    for (let i = 0; i < N; i++) {
      if (!(free & bit(i))) continue;
      colorOf(i) ? black++ : white++;
      const d = degree(i, free);
      if (d === 0) isolated.push(i);
      else if (d === 1) deg1.push(i);
    }
    const diff = Math.abs(black - white);
    const reasons = [];
    const cycleReasons = [];
    const proofCells = [];
    const cycleProofCells = [];
    const add = (bucket, proof, code, text, indices) => {
      const cells = indices.map(cellOf);
      bucket.push({ code, text, cells });
      for (const cell of cells) {
        if (!proof.some(([r, c]) => r === cell[0] && c === cell[1])) proof.push(cell);
      }
    };
    const addPath = (code, text, cells) => add(reasons, proofCells, code, text, cells);
    const addCycle = (code, text, cells) => add(cycleReasons, cycleProofCells, code, text, cells);
    const extra = [];
    let first = -1;
    if (nfree > 1) {
      first = lowestBitIndex(free);
      const reached = reachableMask(first, free);
      let rest = free & ~reached;
      while (rest) {
        const start = lowestBitIndex(rest);
        extra.push(start);
        rest &= ~reachableMask(start, free);
      }
    }
    if (nfree > 0 && nfree < 4) {
      addCycle(
        "too_small",
        `${nfree} open cell${nfree === 1 ? "" : "s"} (a grid cycle needs at least 4)`,
        [...isolated, ...deg1]
      );
    }
    if (nfree > 1 && isolated.length) {
      const count = isolated.length;
      addCycle("isolated", `${count} isolated open cell${count === 1 ? "" : "s"} (a cycle cannot jump the gap)`, isolated);
      addPath("isolated", `${count} isolated open cell${count === 1 ? "" : "s"} (a path cannot jump the gap)`, isolated);
    }
    if (extra.length) {
      const starts = [first, ...extra];
      addCycle("disconnected", `${starts.length} disconnected open regions (a cycle stays in one piece)`, starts);
      addPath("disconnected", `${starts.length} disconnected open regions (a path stays in one piece)`, starts);
    }
    if (black !== white) {
      addCycle("imbalance", `|black\u2212white|=${diff} (a cycle needs equally many black and white cells)`, []);
    }
    if (nfree & 1 && diff >= 3) {
      addPath("path_imbalance", `|black\u2212white|=${diff} on an odd board (a path needs a difference of exactly 1)`, []);
    }
    if (deg1.length) {
      addCycle("dead_end", `${deg1.length} dead-end${deg1.length === 1 ? "" : "s"} (a cycle has no endpoints)`, deg1);
    }
    if (deg1.length > 2) {
      addPath("too_many_dead_ends", `${deg1.length} dead-ends (a path has two ends; extras cannot be visited)`, deg1);
    }
    if (nfree > 1 && nfree & 1 && deg1.length) {
      const majority = black > white ? 1 : 0;
      const bad = deg1.filter((i) => colorOf(i) !== majority);
      if (bad.length) {
        addPath(
          "minority_dead_end",
          "dead-end on the minority color; both path ends must sit on the majority color",
          bad
        );
      }
    } else if (nfree > 1 && !(nfree & 1) && deg1.length === 2 && colorOf(deg1[0]) === colorOf(deg1[1])) {
      addPath(
        "same_color_dead_ends",
        "both dead-ends are the same color; a path's two ends must be opposite colors",
        deg1
      );
    }
    if (nfree > 3 && !checkCancelled(true)) {
      const cuts = [];
      for (let i = 0; i < N; i++) {
        if (!(free & bit(i))) continue;
        const remaining = free ^ bit(i);
        let components = 0;
        let left = remaining;
        while (left) {
          const start = lowestBitIndex(left);
          left &= ~reachableMask(start, remaining);
          if (++components >= 3) {
            cuts.push(i);
            break;
          }
        }
        if (checkCancelled()) break;
      }
      if (cuts.length) {
        const text = `${cuts.length} cell${cuts.length === 1 ? "" : "s"} whose removal splits the board into three rooms`;
        addCycle("three_way_cut", `${text} (a cycle cannot serve three rooms)`, cuts);
        addPath("three_way_cut", `${text} (a path has only two ends)`, cuts);
      }
    }
    const pathColoring = reasons.length > 0;
    const cycleColoring = cycleReasons.length > 0;
    return {
      black,
      white,
      diff,
      cycle_possible: !cycleColoring,
      cycle_coloring: cycleColoring,
      cycle_coloring_no: black !== white,
      cycle_reasons: cycleReasons,
      cycle_proof_cells: cycleProofCells,
      path_possible: !pathColoring && diff <= 1,
      path_coloring: pathColoring,
      blocked: pathColoring,
      reasons,
      proof_cells: proofCells
    };
  }
  function bitsToGrid(text) {
    let bits = String(text).replace(/\s/g, "");
    if (/^[12]*$/.test(bits)) bits = bits.replace(/1/g, "0").replace(/2/g, "1");
    if (bits.length !== N || /[^01]/.test(bits)) {
      throw new RangeError(`expected ${N} wall bits`);
    }
    return Array.from({ length: HEIGHT }, (_, r) => Array.from({ length: WIDTH }, (_2, c) => bits[idx(r, c)] === "1" ? WALL : 1));
  }
  function colorCount(remaining) {
    let black = 0;
    for (let bits = remaining; bits; ) {
      const next = bits & -bits;
      if (colorOf(lowestBitIndex(next))) black++;
      bits ^= next;
    }
    return black;
  }
  function warnsdorffDfsJs(initialHead, initialRemaining, initialCount, initialBlack, requiredEnd = null, nodes = null, nodeLimit = 0, path = null) {
    let head = initialHead;
    let remaining = initialRemaining;
    let count = initialCount;
    let black = initialBlack;
    let added = 0;
    const progress = currentProgress();
    const fail = () => {
      if (path && added) path.splice(path.length - added, added);
      return false;
    };
    while (true) {
      if (checkCancelled()) return fail();
      if (nodeLimit) {
        nodes[0]++;
        if (nodes[0] > nodeLimit) return fail();
      }
      progress?.add(1);
      if (count <= 1) {
        if (requiredEnd == null || head === requiredEnd) {
          path?.push(head);
          return true;
        }
        return fail();
      }
      if (requiredEnd != null && head === requiredEnd) return fail();
      const white = count - black;
      if (count & 1) {
        if (colorOf(head) ? black !== white + 1 : white !== black + 1) return fail();
      } else if (black !== white) return fail();
      const open = remaining ^ bit(head);
      const openCount = count - 1;
      const openBlack = black - (colorOf(head) ? 1 : 0);
      let neighbors = NEIGHBORS[head].filter((n) => Boolean(open & bit(n)));
      if (!neighbors.length) return fail();
      const isolated = neighbors.filter((n) => (NBR_MASK[n] & open) === 0n);
      if (isolated.length) {
        if (isolated.length > 1 || openCount !== 1) return fail();
        neighbors = isolated;
      }
      if (neighbors.length === 1) {
        if (path) {
          path.push(head);
          added++;
        }
        head = neighbors[0];
        remaining = open;
        count = openCount;
        black = openBlack;
        continue;
      }
      const degreeOne = [];
      for (let bits = open; bits; ) {
        const next = bits & -bits;
        const i = lowestBitIndex(next);
        const d = bitCount(NBR_MASK[i] & open);
        if (d === 0) return fail();
        if (d === 1 && degreeOne.push(i) > 2) return fail();
        bits ^= next;
      }
      if (degreeOne.length === 2) {
        const forced = new Set(degreeOne);
        neighbors = neighbors.filter((n) => forced.has(n));
        if (!neighbors.length) return fail();
      }
      const row = Math.floor(head / WIDTH);
      neighbors.sort((a, b) => {
        const degreeDiff = bitCount(NBR_MASK[a] & open) - bitCount(NBR_MASK[b] & open);
        if (degreeDiff) return degreeDiff;
        const aSnake = (row & 1) === 0 && a === head + 1 || row & 1 && a === head - 1 ? 0 : 1;
        const bSnake = (row & 1) === 0 && b === head + 1 || row & 1 && b === head - 1 ? 0 : 1;
        return aSnake - bSnake;
      });
      if (path) {
        path.push(head);
        added++;
      }
      for (const neighbor of neighbors) {
        if (checkCancelled()) return fail();
        if (reachableMask(neighbor, open) !== open) continue;
        if (warnsdorffDfsJs(
          neighbor,
          open,
          openCount,
          openBlack,
          requiredEnd,
          nodes,
          nodeLimit,
          path
        )) return true;
      }
      return fail();
    }
  }
  function warnsdorffDfs(initialHead, initialRemaining, initialCount, initialBlack, requiredEnd = null, nodes = null, nodeLimit = 0, path = null) {
    if (dfsWasmReady()) {
      dfsWasmConfigure(WIDTH, HEIGHT);
      dfsWasmSetCancelled(Boolean(cancelCheck && cancelCheck()));
      const wantPath = path != null;
      const result = dfsWasmRun(
        initialHead,
        initialRemaining,
        initialCount,
        initialBlack,
        requiredEnd,
        {
          nodeLimit: nodeLimit || 0,
          wantPath,
          useMemo: false,
          nodes: nodes || [0]
        }
      );
      if (result === null) {
      } else if (wantPath) {
        if (Array.isArray(result)) {
          for (const i of result) path.push(i);
          return true;
        }
        return false;
      } else {
        return Boolean(result);
      }
    }
    return warnsdorffDfsJs(
      initialHead,
      initialRemaining,
      initialCount,
      initialBlack,
      requiredEnd,
      nodes,
      nodeLimit,
      path
    );
  }
  function pathStarts(free, nfree, degreeOne) {
    if (degreeOne.length) return degreeOne.slice(0, 1);
    const black = colorCount(free);
    const white = nfree - black;
    const starts = [];
    for (let i = 0; i < N; i++) {
      if (!(free & bit(i))) continue;
      if (nfree & 1) {
        if (colorOf(i) === (black > white ? 1 : 0)) starts.push(i);
      } else if (colorOf(i)) starts.push(i);
    }
    starts.sort((a, b) => degree(a, free) - degree(b, free));
    return starts;
  }
  function exhaustiveHamPath(grid, {
    nodeLimit = 0,
    budgets = null,
    wantPath = false
  } = {}) {
    const free = freeMask(grid);
    const nfree = bitCount(free);
    if (nfree <= 1) {
      const cells = [];
      for (let i = 0; i < N; i++) if (free & bit(i)) cells.push(cellOf(i));
      return wantPath ? cells : true;
    }
    const black = colorCount(free);
    const degreeOne = [];
    for (let i = 0; i < N; i++) {
      if (free & bit(i) && degree(i, free) === 1) degreeOne.push(i);
    }
    const starts = pathStarts(free, nfree, degreeOne);
    const requiredEnd = degreeOne.length === 2 ? degreeOne[1] : null;
    const searchBudgets = budgets || (nodeLimit ? [nodeLimit] : [4e3, 16e3, 64e3, 0]);
    for (const budget of searchBudgets) {
      currentProgress()?.setPhase(`path DFS (${budget ? `${budget.toLocaleString()} node cap` : "unlimited"})`);
      const nodes = budget ? [0] : null;
      for (const start of starts) {
        if (checkCancelled(true)) return wantPath ? null : false;
        if (nodes) nodes[0] = 0;
        const found = wantPath ? [] : null;
        if (warnsdorffDfs(
          start,
          free,
          nfree,
          black,
          requiredEnd,
          nodes,
          budget,
          found
        )) {
          return wantPath ? found.map(cellOf) : true;
        }
      }
    }
    return wantPath ? null : false;
  }
  function inBounds(x, y) {
    return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
  }
  var PathBoard = class _PathBoard {
    static lastWin = null;
    constructor(grid) {
      this.w = grid.map((row) => row.map((cell) => cell === WALL ? WALL : 1));
      this.s = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => [0, 0, 0, 0]));
      this.nfree = grid.reduce((sum, row) => sum + row.reduce((n, cell) => n + (cell !== WALL ? 1 : 0), 0), 0);
      this.ends = 0;
      this.dead = false;
      this.g = 0;
      this.cancelled = false;
    }
    clone() {
      const board = Object.create(_PathBoard.prototype);
      board.w = this.w.map((row) => row.slice());
      board.s = this.s.map((row) => row.map((cell) => cell.slice()));
      board.nfree = this.nfree;
      board.ends = this.ends;
      board.dead = this.dead;
      board.g = this.g;
      board.cancelled = this.cancelled;
      return board;
    }
    adj(x, y) {
      const result = [0, 0, 0, 0];
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (!inBounds(nx, ny) || this.w[ny][nx] === WALL) result[d] = 1;
        else if (this.w[ny][nx] === 3) result[d] = this.s[ny][nx][OPP[d]] ? 2 : 1;
      }
      return result;
    }
    place(x, y, dirs) {
      this.w[y][x] = 3;
      this.s[y][x] = [0, 0, 0, 0];
      for (const d of dirs) this.s[y][x][d] = 1;
      if (dirs.length === 1) this.ends++;
    }
    otherDir(x, y, came) {
      let found = null;
      for (let d = 0; d < 4; d++) {
        if (this.s[y][x][d] && d !== came) {
          if (found != null) return found;
          found = d;
        }
      }
      return found;
    }
    joinCycleLength(x, y, d1, d2) {
      const n1x = x + DX[d1], n1y = y + DY[d1];
      const n2x = x + DX[d2], n2y = y + DY[d2];
      if (!inBounds(n1x, n1y) || !inBounds(n2x, n2y) || this.w[n1y][n1x] !== 3 || this.w[n2y][n2x] !== 3 || !this.s[n1y][n1x][OPP[d1]] || !this.s[n2y][n2x][OPP[d2]]) return 0;
      let cx = n1x, cy = n1y, came = OPP[d1];
      let length = 1;
      for (let step = 0; step < this.nfree + 2; step++) {
        const next = this.otherDir(cx, cy, came);
        if (next == null) return 0;
        const nx = cx + DX[next], ny = cy + DY[next];
        length++;
        if (nx === n2x && ny === n2y) return length + 1;
        cx = nx;
        cy = ny;
        came = OPP[next];
      }
      return 0;
    }
    joinOk(x, y, dirs) {
      if (dirs.length !== 2) return true;
      const loop = this.joinCycleLength(x, y, dirs[0], dirs[1]);
      if (!loop) return true;
      return loop === this.nfree ? "full" : false;
    }
    force() {
      while (!this.dead) {
        if (checkCancelled()) {
          this.cancelled = true;
          return false;
        }
        let changed = false;
        for (let y = 0; y < HEIGHT; y++) {
          for (let x = 0; x < WIDTH; x++) {
            if (this.w[y][x] !== 1) continue;
            const adjacent = this.adj(x, y);
            const blocked = adjacent.filter((v) => v === 1).length;
            const headCount = adjacent.filter((v) => v === 2).length;
            if (headCount >= 3 || blocked === 4) {
              this.dead = true;
              return false;
            }
            if (blocked === 3) {
              if (this.ends >= 2) {
                this.dead = true;
                return false;
              }
              this.place(x, y, [adjacent.findIndex((v) => v !== 1)]);
              changed = true;
              continue;
            }
            const heads = [];
            const opens = [];
            for (let d = 0; d < 4; d++) {
              if (adjacent[d] === 2) heads.push(d);
              if (adjacent[d] !== 1) opens.push(d);
            }
            if (heads.length === 2) {
              const ok = this.joinOk(x, y, heads);
              if (ok === "full") {
                this.place(x, y, heads);
                return this.win();
              }
              if (ok) {
                this.place(x, y, heads);
                changed = true;
                continue;
              }
              if (blocked === 2) {
                this.dead = true;
                return false;
              }
            }
            if (this.ends >= 2 && blocked === 2) {
              const ok = this.joinOk(x, y, opens);
              if (ok === "full") {
                this.place(x, y, opens);
                return this.win();
              }
              if (!ok) {
                this.dead = true;
                return false;
              }
              this.place(x, y, opens);
              changed = true;
            }
          }
        }
        if (!changed) break;
      }
      return false;
    }
    walkFromEnd(x, y) {
      const d = this.s[y][x].findIndex(Boolean);
      const seen = /* @__PURE__ */ new Set([`${x},${y}`]);
      let came = OPP[d], cx = x + DX[d], cy = y + DY[d];
      for (let step = 0; step < this.nfree + 2; step++) {
        const key = `${cx},${cy}`;
        if (!inBounds(cx, cy) || this.w[cy][cx] !== 3 || seen.has(key)) return 0;
        seen.add(key);
        const next = this.otherDir(cx, cy, came);
        if (next == null) return seen.size;
        cx += DX[next];
        cy += DY[next];
        came = OPP[next];
      }
      return 0;
    }
    isCover() {
      const ends = [];
      let snakes = 0;
      for (let y2 = 0; y2 < HEIGHT; y2++) {
        for (let x2 = 0; x2 < WIDTH; x2++) {
          if (this.w[y2][x2] === 1) return false;
          if (this.w[y2][x2] !== 3) continue;
          snakes++;
          const d = this.s[y2][x2].reduce((a, b) => a + b, 0);
          if (d === 1) ends.push([x2, y2]);
          else if (d !== 2) return false;
        }
      }
      if (snakes !== this.nfree) return false;
      if (ends.length === 2) return this.walkFromEnd(...ends[0]) === this.nfree;
      if (ends.length !== 0 || !snakes) return false;
      const start = this.firstSnake();
      if (!start) return false;
      const [x, y] = start;
      const dirs = this.s[y][x].map((v, d) => v ? d : -1).filter((d) => d >= 0);
      const seen = /* @__PURE__ */ new Set([`${x},${y}`]);
      let cx = x + DX[dirs[0]], cy = y + DY[dirs[0]], came = OPP[dirs[0]];
      for (let step = 0; step < this.nfree + 2; step++) {
        if (!inBounds(cx, cy) || this.w[cy][cx] !== 3) return false;
        const key = `${cx},${cy}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const next = this.otherDir(cx, cy, came);
        if (next == null) return false;
        const nx = cx + DX[next], ny = cy + DY[next];
        if (nx === x && ny === y) return seen.size === this.nfree;
        cx = nx;
        cy = ny;
        came = OPP[next];
      }
      return false;
    }
    firstSnake() {
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) if (this.w[y][x] === 3) return [x, y];
      }
      return null;
    }
    pickEmpty() {
      let best = null, bestOpen = 5;
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (this.w[y][x] !== 1) continue;
          const open = 4 - this.adj(x, y).filter((v) => v === 1).length;
          if (open < bestOpen) {
            bestOpen = open;
            best = [x, y];
            if (open <= 2) return best;
          }
        }
      }
      return best;
    }
    guesses(x, y, allowNewEnds = false) {
      const adjacent = this.adj(x, y);
      const opens = [0, 1, 2, 3].filter((d) => adjacent[d] !== 1);
      const out = [];
      for (let i = 0; i < opens.length; i++) {
        for (let j = i + 1; j < opens.length; j++) out.push([opens[i], opens[j]]);
      }
      if (allowNewEnds && this.ends < 2) for (const d of opens) out.push([d]);
      return out;
    }
    pathCells() {
      if (!this.isCover()) return null;
      const ends = [];
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (this.w[y][x] === 3 && this.s[y][x].reduce((a, b) => a + b, 0) === 1) {
            ends.push([x, y]);
          }
        }
      }
      let start;
      let d;
      let cycle = false;
      if (ends.length === 2) {
        start = ends[0];
        d = this.s[start[1]][start[0]].findIndex(Boolean);
      } else {
        start = this.firstSnake();
        if (!start) return null;
        d = this.s[start[1]][start[0]].findIndex(Boolean);
        cycle = true;
      }
      const [sx, sy] = start;
      const cells = [[sy, sx]];
      let cx = sx + DX[d], cy = sy + DY[d], came = OPP[d];
      for (let step = 0; step < this.nfree; step++) {
        if (cycle && cx === sx && cy === sy) return cells.length === this.nfree ? cells : null;
        if (!inBounds(cx, cy)) return null;
        cells.push([cy, cx]);
        const next = this.otherDir(cx, cy, came);
        if (next == null) return !cycle && cells.length === this.nfree ? cells : null;
        cx += DX[next];
        cy += DY[next];
        came = OPP[next];
      }
      return null;
    }
    win() {
      _PathBoard.lastWin = this;
      return true;
    }
    originalDeg2() {
      const cells = [];
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (this.w[y][x] === 1 && this.adj(x, y).filter((v) => v === 1).length === 2) {
            cells.push([x, y]);
          }
        }
      }
      return cells;
    }
    placeThrough(x, y) {
      if (this.w[y][x] !== 1) return true;
      const adjacent = this.adj(x, y);
      const opens = [0, 1, 2, 3].filter((d) => adjacent[d] !== 1);
      if (opens.length !== 2) return true;
      const ok = this.joinOk(x, y, opens);
      if (ok === "full") {
        this.place(x, y, opens);
        return "full";
      }
      if (!ok) {
        this.dead = true;
        return false;
      }
      this.place(x, y, opens);
      return true;
    }
    guessRest(allowNewEnds = false) {
      this.g++;
      currentProgress()?.tick();
      if (checkCancelled()) {
        this.cancelled = true;
        return false;
      }
      if (this.force()) return true;
      if (this.dead || this.cancelled) return false;
      if (this.isCover()) return this.win();
      const cell = this.pickEmpty();
      if (!cell) return false;
      const [x, y] = cell;
      for (const piece of this.guesses(x, y, allowNewEnds)) {
        if (checkCancelled()) {
          this.cancelled = true;
          return false;
        }
        const next = this.clone();
        if (piece.length === 1 && next.ends >= 2) continue;
        if (piece.length === 2) {
          const ok = next.joinOk(x, y, piece);
          if (ok === "full") {
            next.place(x, y, piece);
            return next.win();
          }
          if (!ok) continue;
        }
        next.place(x, y, piece);
        if (next.guessRest(allowNewEnds)) return true;
        if (next.cancelled) {
          this.cancelled = true;
          return false;
        }
      }
      return false;
    }
    dirsOf([x, y]) {
      const adjacent = this.adj(x, y);
      return [0, 1, 2, 3].filter((d) => adjacent[d] !== 1);
    }
    legalEndCells() {
      const empties = [];
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) if (this.w[y][x] === 1) empties.push([x, y]);
      }
      empties.sort((a, b) => this.adj(a[0], a[1]).filter((v) => v !== 1).length - this.adj(b[0], b[1]).filter((v) => v !== 1).length);
      if (this.nfree & 1) {
        let black = 0;
        for (let y = 0; y < HEIGHT; y++) {
          for (let x = 0; x < WIDTH; x++) {
            if (this.w[y][x] !== WALL && x + y & 1) black++;
          }
        }
        const majority = black > this.nfree - black ? 1 : 0;
        return [empties.filter(([x, y]) => (x + y & 1) === majority), null];
      }
      return [
        empties.filter(([x, y]) => x + y & 1),
        empties.filter(([x, y]) => !(x + y & 1))
      ];
    }
    tryEndPair(a, b) {
      if (a[0] === b[0] && a[1] === b[1]) return false;
      for (const da of this.dirsOf(a)) {
        for (const db of this.dirsOf(b)) {
          if (checkCancelled()) {
            this.cancelled = true;
            return false;
          }
          const board = this.clone();
          board.g = 0;
          if (board.w[a[1]][a[0]] !== 1 || board.w[b[1]][b[0]] !== 1) continue;
          board.place(a[0], a[1], [da]);
          board.place(b[0], b[1], [db]);
          if (board.guessRest(false)) return true;
          if (board.cancelled) {
            this.cancelled = true;
            return false;
          }
        }
      }
      return false;
    }
    solveRemainingEnds() {
      if (this.force()) return true;
      if (this.dead || this.cancelled) return false;
      if (this.isCover()) return this.win();
      const need = 2 - this.ends;
      if (need <= 0) return this.guessRest(false);
      const [groupA, groupB] = this.legalEndCells();
      if (need === 1) {
        let already = null;
        for (let y = 0; y < HEIGHT && !already; y++) {
          for (let x = 0; x < WIDTH; x++) {
            if (this.w[y][x] === 3 && this.s[y][x].reduce((a, b) => a + b, 0) === 1) {
              already = [x, y];
              break;
            }
          }
        }
        const placedColor = already ? already[0] + already[1] & 1 : null;
        const candidates = groupB == null ? groupA : placedColor === 1 ? groupB : groupA;
        for (const p of candidates) {
          for (const d of this.dirsOf(p)) {
            const board = this.clone();
            if (board.w[p[1]][p[0]] !== 1) continue;
            board.place(p[0], p[1], [d]);
            if (board.guessRest(false)) return true;
            if (board.cancelled) {
              this.cancelled = true;
              return false;
            }
          }
        }
        return false;
      }
      if (groupB == null) {
        for (let i = 0; i < groupA.length; i++) {
          for (let j = i + 1; j < groupA.length; j++) {
            if (this.tryEndPair(groupA[i], groupA[j])) return true;
            if (this.cancelled) return false;
          }
        }
        return false;
      }
      for (const a of groupA) {
        for (const b of groupB) {
          if (this.tryEndPair(a, b)) return true;
          if (this.cancelled) return false;
        }
      }
      return false;
    }
    tryDeg2Exceptions(deg2, exceptions, endDirs) {
      const board = this.clone();
      const exceptionKeys = new Set(exceptions.map(([x, y]) => `${x},${y}`));
      for (let i = 0; i < exceptions.length; i++) {
        const [x, y] = exceptions[i];
        const d = endDirs[i];
        if (board.w[y][x] !== 1 || board.adj(x, y)[d] === 1) return false;
        board.place(x, y, [d]);
      }
      for (const [x, y] of deg2) {
        if (exceptionKeys.has(`${x},${y}`)) continue;
        const result = board.placeThrough(x, y);
        if (result === "full") return board.win();
        if (!result) return false;
      }
      const ok = board.ends >= 2 ? board.guessRest(false) : board.solveRemainingEnds();
      if (board.cancelled) this.cancelled = true;
      return ok;
    }
    solve() {
      _PathBoard.lastWin = null;
      if (this.force()) return true;
      if (this.dead || this.cancelled) return false;
      if (this.isCover()) return this.win();
      const allDeg2 = this.originalDeg2();
      if (this.ends >= 2) return this.guessRest(false);
      const cellColor = ([x, y]) => x + y & 1;
      let majority = null;
      let candidates = allDeg2;
      if (this.nfree & 1) {
        let black = 0;
        for (let y = 0; y < HEIGHT; y++) {
          for (let x = 0; x < WIDTH; x++) {
            if (this.w[y][x] !== WALL && x + y & 1) black++;
          }
        }
        majority = black > this.nfree - black ? 1 : 0;
        candidates = allDeg2.filter((cell) => cellColor(cell) === majority);
      }
      const need = 2 - this.ends;
      for (let k = 0; k <= need; k++) {
        if (checkCancelled(true)) {
          this.cancelled = true;
          return false;
        }
        if (k === 0) {
          if (this.tryDeg2Exceptions(allDeg2, [], [])) return true;
        } else if (k === 1) {
          for (const cell of candidates) {
            for (const d of this.dirsOf(cell)) {
              if (this.tryDeg2Exceptions(allDeg2, [cell], [d])) return true;
              if (this.cancelled) return false;
            }
          }
        } else {
          for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
              const a = candidates[i], b = candidates[j];
              if (majority == null && cellColor(a) === cellColor(b)) continue;
              for (const da of this.dirsOf(a)) {
                for (const db of this.dirsOf(b)) {
                  if (this.tryDeg2Exceptions(allDeg2, [a, b], [da, db])) return true;
                  if (this.cancelled) return false;
                }
              }
            }
          }
        }
      }
      return false;
    }
  };
  function warnsdorffTour(grid, nodeLimit = 12e3) {
    const free = freeMask(grid);
    const nfree = bitCount(free);
    if (nfree <= 1) {
      for (let i = 0; i < N; i++) if (free & bit(i)) return [cellOf(i)];
      return [];
    }
    const degreeOne = [];
    for (let i = 0; i < N; i++) {
      if (free & bit(i) && degree(i, free) === 1) degreeOne.push(i);
    }
    if (degreeOne.length > 2) return null;
    let starts = degreeOne.length ? degreeOne : Array.from({ length: N }, (_, i) => i).filter((i) => free & bit(i) && degree(i, free) === 2);
    if (!starts.length) starts = Array.from({ length: N }, (_, i) => i).filter((i) => free & bit(i));
    let nodes = 0;
    let path = [];
    const dfs = (head, remaining) => {
      if (checkCancelled()) return false;
      if (++nodes > nodeLimit) return false;
      currentProgress()?.add(1);
      path.push(head);
      if (bitCount(remaining) <= 1) return true;
      const open = remaining & ~bit(head);
      const neighbors = NEIGHBORS[head].filter((n) => open & bit(n));
      if (!neighbors.length) {
        path.pop();
        return false;
      }
      const row = Math.floor(head / WIDTH);
      neighbors.sort((a, b) => {
        const d = degree(a, open) - degree(b, open);
        if (d) return d;
        const sa = (row & 1) === 0 && a === head + 1 || row & 1 && a === head - 1 ? 0 : 1;
        const sb = (row & 1) === 0 && b === head + 1 || row & 1 && b === head - 1 ? 0 : 1;
        return sa - sb;
      });
      for (const next of neighbors) if (dfs(next, open)) return true;
      path.pop();
      return false;
    };
    for (const start of starts.slice(0, 6)) {
      path = [];
      nodes = 0;
      if (dfs(start, free) && path.length === nfree) return path.map(cellOf);
      if (checkCancelled(true)) return null;
    }
    return null;
  }
  function findHamiltonianPath(grid) {
    validateGrid(grid);
    if (!coloringAllowsPath(grid) || !pathColoringReport(grid).path_possible) return null;
    if (checkCancelled(true)) return null;
    const nfree = grid.flat().filter((cell) => cell !== WALL).length;
    if (nfree <= 1) {
      for (let r = 0; r < HEIGHT; r++) {
        for (let c = 0; c < WIDTH; c++) if (grid[r][c] !== WALL) return [[r, c]];
      }
      return [];
    }
    currentProgress()?.setPhase("path Warnsdorff tour");
    const tour = warnsdorffTour(grid);
    if (tour && verifyPath(grid, tour)) return tour;
    if (checkCancelled(true)) return null;
    const found = exhaustiveHamPath(grid, {
      wantPath: true,
      budgets: [4e3, 16e3, 0]
    });
    if (found && verifyPath(grid, found)) return found;
    if (checkCancelled(true)) return null;
    currentProgress()?.setPhase("path forced-fill search");
    const board = new PathBoard(grid);
    if (board.solve() && PathBoard.lastWin) {
      const cells = PathBoard.lastWin.pathCells();
      if (cells && verifyPath(grid, cells)) return cells;
    }
    return null;
  }
  function pathEndGap(tour, isCycle = false) {
    if (!tour || !tour.length) return null;
    if (isCycle) return 1;
    if (tour.length <= 1) return 0;
    const a = tour[0], b = tour[tour.length - 1];
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  }
  function minPathEndGap(nfree, cyclePossible = false) {
    if (nfree <= 1) return 0;
    if (nfree === 2) return 1;
    if (nfree & 1) return 2;
    return cyclePossible ? 1 : 3;
  }
  function cellManhattan(a, b) {
    const [r1, c1] = cellOf(a);
    const [r2, c2] = cellOf(b);
    return Math.abs(r1 - r2) + Math.abs(c1 - c2);
  }
  function pathBetween(grid, start, end, nodeLimit) {
    const free = freeMask(grid);
    const nfree = bitCount(free);
    if (!(free & bit(start)) || !(free & bit(end))) return null;
    if (start === end) return nfree === 1 ? [cellOf(start)] : null;
    const path = [];
    const nodes = nodeLimit ? [0] : null;
    if (warnsdorffDfs(
      start,
      free,
      nfree,
      colorCount(free),
      end,
      nodes,
      nodeLimit,
      path
    )) {
      const tour = path.map(cellOf);
      return verifyPath(grid, tour) ? tour : null;
    }
    return null;
  }
  function posaFromTail(path) {
    const positions = new Map(path.map((value, i) => [value, i]));
    const tail = path[path.length - 1];
    const out = [];
    for (const neighbor of NEIGHBORS[tail]) {
      const i = positions.get(neighbor);
      if (i == null || i >= path.length - 2) continue;
      out.push(path.slice(0, i + 1).concat(path.slice(i + 1).reverse()));
    }
    return out;
  }
  function rotationImprove(tour, minDistance, onBetter) {
    if (!tour || tour.length <= 2) {
      const distance = pathEndGap(tour);
      return [tour, distance, distance != null && distance <= minDistance];
    }
    const start = tour.map(([r, c]) => idx(r, c));
    let bestPath = start;
    let bestDistance = cellManhattan(start[0], start[start.length - 1]);
    if (bestDistance <= minDistance) return [tour, bestDistance, true];
    const endpointKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
    const seen = /* @__PURE__ */ new Set([endpointKey(start[0], start[start.length - 1])]);
    const queue = [start];
    let queueIndex = 0;
    currentProgress()?.setPhase(`rotate endpoints (gap ${bestDistance}, best ${minDistance})`);
    let steps = 0;
    while (queueIndex < queue.length) {
      if (checkCancelled()) break;
      if (++steps % 256 === 0) currentProgress()?.add(256);
      const current = queue[queueIndex++];
      for (const base of [current, current.slice().reverse()]) {
        for (const next of posaFromTail(base)) {
          const a = next[0], b = next[next.length - 1];
          const key = endpointKey(a, b);
          if (seen.has(key)) continue;
          seen.add(key);
          const distance = cellManhattan(a, b);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestPath = next;
            const cells = next.map(cellOf);
            onBetter?.(cells, bestDistance, bestDistance <= minDistance);
            currentProgress()?.setPhase(`rotate endpoints (gap ${bestDistance}, best ${minDistance})`);
            if (bestDistance <= minDistance) return [cells, bestDistance, true];
          }
          queue.push(next);
        }
      }
    }
    return [bestPath.map(cellOf), bestDistance, bestDistance <= minDistance];
  }
  function pathboardBetween(grid, start, end) {
    const [ra, ca] = cellOf(start);
    const [rb, cb] = cellOf(end);
    const board = new PathBoard(grid);
    if (board.tryEndPair([ca, ra], [cb, rb]) && PathBoard.lastWin) {
      const cells = PathBoard.lastWin.pathCells();
      if (cells && verifyPath(grid, cells)) return cells;
    }
    return null;
  }
  function improvePathEndpoints(grid, initialTour, {
    onBetter = null,
    cyclePossible = false
  } = {}) {
    validateGrid(grid);
    if (!initialTour || !initialTour.length) return [null, null, false];
    let tour = initialTour.map((cell) => cell.slice());
    const nfree = tour.length;
    let bestDistance = pathEndGap(tour);
    const minDistance = minPathEndGap(nfree, cyclePossible);
    if (bestDistance == null) return [tour, null, false];
    if (nfree <= 2 || bestDistance <= minDistance) return [tour, bestDistance, true];
    const free = freeMask(grid);
    const degreeOne = [];
    for (let i = 0; i < N; i++) {
      if (free & bit(i) && degree(i, free) === 1) degreeOne.push(i);
    }
    if (degreeOne.length === 2) return [tour, bestDistance, true];
    [tour, bestDistance] = rotationImprove(tour, minDistance, onBetter);
    if (bestDistance <= minDistance) return [tour, bestDistance, true];
    if (checkCancelled(true)) return [tour, bestDistance, false];
    const cells = [];
    for (let i = 0; i < N; i++) if (free & bit(i)) cells.push(i);
    const black = cells.filter((i) => colorOf(i)).length;
    const white = cells.length - black;
    const pairOk = (a, b) => {
      if (a === b) return false;
      const same = colorOf(a) === colorOf(b);
      if (nfree & 1) {
        if (!same || colorOf(a) !== (black > white ? 1 : 0)) return false;
      } else if (same) return false;
      return degreeOne.length !== 1 || a === degreeOne[0] || b === degreeOne[0];
    };
    const byDistance = /* @__PURE__ */ new Map();
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i], b = cells[j];
        const distance = cellManhattan(a, b);
        if (distance < minDistance || distance >= bestDistance || !pairOk(a, b)) continue;
        if (!byDistance.has(distance)) byDistance.set(distance, []);
        byDistance.get(distance).push([a, b]);
      }
    }
    for (const pairs of byDistance.values()) {
      pairs.sort((a, b) => degree(a[0], free) + degree(a[1], free) - degree(b[0], free) - degree(b[1], free));
    }
    const tryGap = (distance) => {
      const pairs = byDistance.get(distance) || [];
      if (!pairs.length) return "impossible";
      let leftover = [];
      currentProgress()?.setPhase(`closest ends gap ${distance} (forced fill, ${pairs.length} pairs)`);
      if (minDistance >= 3) {
        leftover = pairs.slice();
      } else {
        for (const [a, b] of pairs) {
          if (checkCancelled()) return "cancelled";
          const candidate = pathboardBetween(grid, a, b);
          if (candidate) {
            tour = candidate;
            bestDistance = distance;
            onBetter?.(tour, bestDistance, bestDistance <= minDistance);
            return "found";
          }
          leftover.push([a, b]);
        }
      }
      const budgets = minDistance >= 3 ? [0] : leftover.length < 80 ? [4e3, 16e3, 64e3, 25e4, 0] : [16e3, 64e3, 25e4, 0];
      for (const nodeLimit of budgets) {
        if (!leftover.length) break;
        currentProgress()?.setPhase(
          `closest ends gap ${distance} (${nodeLimit ? `${nodeLimit.toLocaleString()} cap` : "unlimited"}, ${leftover.length} pairs)`
        );
        const still = [];
        for (const [a, b] of leftover) {
          if (checkCancelled()) return "cancelled";
          let attempted = false;
          for (const [start, end] of [[a, b], [b, a]]) {
            if (degreeOne.length === 1 && start !== degreeOne[0]) continue;
            const candidate = pathBetween(grid, start, end, nodeLimit);
            attempted = true;
            if (candidate) {
              tour = candidate;
              bestDistance = distance;
              onBetter?.(tour, bestDistance, bestDistance <= minDistance);
              return "found";
            }
          }
          if (nodeLimit || attempted) still.push([a, b]);
        }
        leftover = nodeLimit ? still : [];
      }
      return leftover.length ? "inconclusive" : "impossible";
    };
    let inconclusive = false;
    for (let distance = bestDistance - 1; distance >= minDistance; distance--) {
      if (checkCancelled()) return [tour, bestDistance, false];
      if (distance >= bestDistance) continue;
      const status = tryGap(distance);
      if (status === "found") {
        inconclusive = false;
        if (bestDistance <= minDistance) return [tour, bestDistance, true];
        for (const key of [...byDistance.keys()]) if (key >= bestDistance) byDistance.delete(key);
      } else if (status === "cancelled") {
        return [tour, bestDistance, false];
      } else if (status === "inconclusive" && distance < bestDistance) {
        inconclusive = true;
      }
    }
    return [tour, bestDistance, bestDistance <= minDistance || !inconclusive];
  }
  function tourFromSnakemap(wmap, smap) {
    const height = wmap.length;
    const width = height ? wmap[0].length : 0;
    const nfree = wmap.reduce((sum, row) => sum + row.reduce((n, cell) => n + (cell !== WALL ? 1 : 0), 0), 0);
    if (nfree <= 0) return [];
    if (nfree === 1) {
      for (let y2 = 0; y2 < height; y2++) {
        for (let x2 = 0; x2 < width; x2++) if (wmap[y2][x2] !== WALL) return [[y2, x2]];
      }
    }
    const otherDir = (x2, y2, came2) => {
      let found = null;
      for (let d = 0; d < 4; d++) if (smap[y2][x2][d] && d !== came2) found = d;
      return found;
    };
    const ends = [];
    let anySnake = null;
    for (let y2 = 0; y2 < height; y2++) {
      for (let x2 = 0; x2 < width; x2++) {
        const d = smap[y2][x2].reduce((a, b) => a + b, 0);
        if (!d) continue;
        anySnake ||= [x2, y2];
        if (d === 1) ends.push([x2, y2]);
      }
    }
    if (ends.length) {
      const [x2, y2] = ends[0];
      const d = smap[y2][x2].findIndex(Boolean);
      const cells2 = [[y2, x2]];
      let cx2 = x2 + DX[d], cy2 = y2 + DY[d], came2 = OPP[d];
      for (let step = 0; step < nfree - 1; step++) {
        if (cx2 < 0 || cx2 >= width || cy2 < 0 || cy2 >= height) return null;
        cells2.push([cy2, cx2]);
        const next = otherDir(cx2, cy2, came2);
        if (next == null) return cells2.length === nfree ? cells2 : null;
        cx2 += DX[next];
        cy2 += DY[next];
        came2 = OPP[next];
      }
      return cells2.length === nfree ? cells2 : null;
    }
    if (!anySnake) return null;
    const [x, y] = anySnake;
    const dirs = smap[y][x].map((v, d) => v ? d : -1).filter((d) => d >= 0);
    if (dirs.length !== 2) return null;
    const cells = [[y, x]];
    let cx = x + DX[dirs[0]], cy = y + DY[dirs[0]], came = OPP[dirs[0]];
    for (let step = 0; step < nfree; step++) {
      if (cx === x && cy === y) return cells.length === nfree ? cells : null;
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) return null;
      cells.push([cy, cx]);
      const next = otherDir(cx, cy, came);
      if (next == null) return null;
      cx += DX[next];
      cy += DY[next];
      came = OPP[next];
    }
    return cells.length === nfree ? cells : null;
  }
  function verifyPath(grid, cells) {
    if (!cells || !cells.length) return false;
    const open = /* @__PURE__ */ new Set();
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] !== WALL) open.add(`${r},${c}`);
      }
    }
    const visited = new Set(cells.map(([r, c]) => `${r},${c}`));
    if (cells.length !== open.size || visited.size !== open.size) return false;
    for (const cell of visited) if (!open.has(cell)) return false;
    for (let i = 1; i < cells.length; i++) {
      const [r1, c1] = cells[i - 1];
      const [r2, c2] = cells[i];
      if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;
    }
    return true;
  }

  // js/wall.js
  function newBlank(width, height) {
    const b = Array.from({ length: height }, () => Array(width).fill(0));
    b[0][1] = 1;
    b[0][width - 2] = 1;
    b[1][0] = 1;
    b[1][width - 1] = 1;
    b[height - 2][0] = 1;
    b[height - 2][width - 1] = 1;
    b[height - 1][1] = 1;
    b[height - 1][width - 2] = 1;
    return b;
  }
  function generateEligible(b) {
    const lx = b[0].length;
    const ly = b.length;
    const elig = [];
    for (let i = 0; i < lx; i++) {
      for (let j = 0; j < ly; j++) {
        if (b[j][i] === 0) elig.push([i, j]);
      }
    }
    return elig;
  }
  function newWall(b) {
    const lx = b[0].length;
    const ly = b.length;
    const elig = generateEligible(b);
    if (!elig.length) return false;
    const [x, y] = elig[Math.random() * elig.length | 0];
    b[y][x] = 2;
    if (y !== 0) {
      b[y - 1][x] = 1;
      if (x !== 0) b[y - 1][x - 1] = 1;
      if (x !== lx - 1) b[y - 1][x + 1] = 1;
    }
    if (y !== ly - 1) {
      b[y + 1][x] = 1;
      if (x !== 0) b[y + 1][x - 1] = 1;
      if (x !== lx - 1) b[y + 1][x + 1] = 1;
    }
    if (x !== 0) b[y][x - 1] = 1;
    if (x !== lx - 1) b[y][x + 1] = 1;
    if (y === 0 || y === ly - 1) {
      if (x < lx - 2) b[y][x + 2] = 1;
      if (x > 1) b[y][x - 2] = 1;
    }
    if (x === 0 || x === lx - 1) {
      if (y < ly - 2) b[y + 2][x] = 1;
      if (y > 1) b[y - 2][x] = 1;
    }
    if (y === 0 && x === 2) b[2][0] = 1;
    if (y === 0 && x === lx - 3) b[2][lx - 1] = 1;
    if (y === 2 && x === 0) b[0][2] = 1;
    if (y === 2 && x === lx - 1) b[0][lx - 3] = 1;
    if (y === ly - 1 && x === 2) b[ly - 3][0] = 1;
    if (y === ly - 1 && x === lx - 3) b[ly - 3][lx - 1] = 1;
    if (y === ly - 3 && x === 0) b[ly - 1][2] = 1;
    if (y === ly - 3 && x === lx - 1) b[ly - 1][lx - 3] = 1;
    return true;
  }
  function newPattern(width, height) {
    const b = newBlank(width, height);
    while (newWall(b)) ;
    return b;
  }
  function bitsToWallMap(bits, width, height) {
    const b = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        row.push(bits[y * width + x] === "1" ? 2 : 1);
      }
      b.push(row);
    }
    return b;
  }
  function darkLightCheck(b) {
    let dark = 0;
    let light = 0;
    for (let j = 0; j < b.length; j++) {
      for (let i = 0; i < b[0].length; i++) {
        if (b[j][i] !== 2) {
          if ((i + j) % 2 === 0) light++;
          else dark++;
        }
      }
    }
    return dark === light;
  }
  function new4map(x, y) {
    const m = newBlank(x, y);
    for (let i = 0; i < x; i++) {
      for (let j = 0; j < y; j++) {
        m[j][i] = [0, 0, 0, 0];
      }
    }
    return m;
  }
  function adjCheck(wmap, smap, x, y) {
    const lx = wmap[0].length;
    const ly = wmap.length;
    const adj = [0, 0, 0, 0];
    if (y === 0) adj[0] = 1;
    else if (wmap[y - 1][x] >= 2) {
      adj[0] = 1;
      if (wmap[y - 1][x] === 3 && smap[y - 1][x][1] === 1) adj[0] = 2;
    }
    if (y === ly - 1) adj[1] = 1;
    else if (wmap[y + 1][x] >= 2) {
      adj[1] = 1;
      if (wmap[y + 1][x] === 3 && smap[y + 1][x][0] === 1) adj[1] = 2;
    }
    if (x === 0) adj[2] = 1;
    else if (wmap[y][x - 1] >= 2) {
      adj[2] = 1;
      if (wmap[y][x - 1] === 3 && smap[y][x - 1][3] === 1) adj[2] = 2;
    }
    if (x === lx - 1) adj[3] = 1;
    else if (wmap[y][x + 1] >= 2) {
      adj[3] = 1;
      if (wmap[y][x + 1] === 3 && smap[y][x + 1][2] === 1) adj[3] = 2;
    }
    return adj;
  }
  function newAdjmap(wmap, smap) {
    const lx = wmap[0].length;
    const ly = wmap.length;
    const adjmap = new4map(lx, ly);
    for (let i = 0; i < lx; i++) {
      for (let j = 0; j < ly; j++) {
        if (wmap[j][i] === 1) adjmap[j][i] = adjCheck(wmap, smap, i, j);
      }
    }
    return adjmap;
  }
  function cycleCheck(smap, x, y) {
    let d = smap[y][x].indexOf(1);
    const x0 = x;
    const y0 = y;
    let n = 0;
    const maxN = smap.length * smap[0].length;
    while (true) {
      n++;
      if (d === 0) {
        y -= 1;
        if (smap[y][x].reduce((a, b) => a + b, 0) === 2) {
          const a = smap[y][x].slice();
          a[1] = 0;
          d = a.indexOf(1);
        } else return false;
      } else if (d === 1) {
        y += 1;
        if (smap[y][x].reduce((a, b) => a + b, 0) === 2) {
          const a = smap[y][x].slice();
          a[0] = 0;
          d = a.indexOf(1);
        } else return false;
      } else if (d === 2) {
        x -= 1;
        if (smap[y][x].reduce((a, b) => a + b, 0) === 2) {
          const a = smap[y][x].slice();
          a[3] = 0;
          d = a.indexOf(1);
        } else return false;
      } else if (d === 3) {
        x += 1;
        if (smap[y][x].reduce((a, b) => a + b, 0) === 2) {
          const a = smap[y][x].slice();
          a[2] = 0;
          d = a.indexOf(1);
        } else return false;
      }
      if (x === x0 && y === y0) return n;
      if (n > maxN) return false;
    }
  }
  function countOf(arr, v) {
    let n = 0;
    for (const x of arr) if (x === v) n++;
    return n;
  }
  function snakeFillStep(wmap, adjmap, smap, max, pairing = true, cycleblock = true) {
    const lx = wmap[0].length;
    const ly = wmap.length;
    let ham = true;
    for (let i = 0; i < lx; i++) {
      for (let j = 0; j < ly; j++) {
        if (wmap[j][i] !== 1) continue;
        if (countOf(adjmap[j][i], 1) === 2) {
          for (let n = 0; n < 4; n++) {
            if (adjmap[j][i][n] === 0 || adjmap[j][i][n] === 2) smap[j][i][n] = 1;
          }
          wmap[j][i] = 3;
        }
        if (countOf(adjmap[j][i], 2) >= 3) ham = false;
        if (countOf(adjmap[j][i], 1) >= 3) ham = false;
        if (pairing && countOf(adjmap[j][i], 2) === 2) {
          if (cycleblock) {
            const test = smap.map((row) => row.map((cell) => cell.slice()));
            for (let n = 0; n < 4; n++) {
              if (adjmap[j][i][n] === 2) test[j][i][n] = 1;
            }
            const x = cycleCheck(test, i, j);
            if (!x) {
              smap[j][i] = test[j][i];
              wmap[j][i] = 3;
            } else if (x !== max) ham = false;
          } else {
            for (let n = 0; n < 4; n++) {
              if (adjmap[j][i][n] === 2) smap[j][i][n] = 1;
            }
            wmap[j][i] = 3;
          }
        }
      }
    }
    return ham;
  }
  function mapsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let j = 0; j < a.length; j++) {
      if (a[j].length !== b[j].length) return false;
      for (let i = 0; i < a[j].length; i++) {
        const av = a[j][i];
        const bv = b[j][i];
        if (Array.isArray(av)) {
          for (let k = 0; k < 4; k++) if (av[k] !== bv[k]) return false;
        } else if (av !== bv) return false;
      }
    }
    return true;
  }
  var Pattern = class _Pattern {
    constructor(x, y, { wmap = null, smap = null, walls = null } = {}) {
      this.wallmap = wmap ? wmap.map((row) => row.slice()) : newPattern(x, y);
      this.snakemap = smap ? smap.map((row) => row.map((c) => c.slice())) : new4map(x, y);
      this.lenx = x;
      this.leny = y;
      this.adjacencymap = newAdjmap(this.wallmap, this.snakemap);
      this.ham = true;
      this.wallcount = walls != null ? walls : this.countWalls();
      this._progress = null;
      this._cancelled = null;
    }
    clone() {
      const p = Object.create(_Pattern.prototype);
      p.wallmap = this.wallmap.map((row) => row.slice());
      p.snakemap = this.snakemap.map((row) => row.map((c) => c.slice()));
      p.adjacencymap = this.adjacencymap.map((row) => row.map((c) => c.slice()));
      p.lenx = this.lenx;
      p.leny = this.leny;
      p.ham = this.ham;
      p.wallcount = this.wallcount;
      p._progress = this._progress;
      p._cancelled = this._cancelled;
      return p;
    }
    countWalls() {
      let n = 0;
      for (let j = 0; j < this.leny; j++) {
        for (let i = 0; i < this.lenx; i++) {
          if (this.wallmap[j][i] === 2) n++;
        }
      }
      return n;
    }
    firstEmpty() {
      for (let j = 0; j < this.leny; j++) {
        for (let i = 0; i < this.lenx; i++) {
          if (this.wallmap[j][i] === 1) return [i, j];
        }
      }
      return null;
    }
    step(p = true) {
      const ok = snakeFillStep(
        this.wallmap,
        this.adjacencymap,
        this.snakemap,
        this.lenx * this.leny - this.wallcount,
        p
      );
      this.adjacencymap = newAdjmap(this.wallmap, this.snakemap);
      if (!ok) this.ham = false;
    }
    work(p = true, lim = true) {
      let prev = this.clone();
      if (p) this.work(false, lim);
      this.step(p);
      while ((this.ham || lim) && !this.equals(prev)) {
        if (this._cancelled && this._cancelled()) return;
        prev = this.clone();
        if (p) this.work(false, lim);
        this.step(p);
      }
    }
    equals(other) {
      return mapsEqual(this.wallmap, other.wallmap) && mapsEqual(this.snakemap, other.snakemap);
    }
    /**
     * @returns {Pattern|false} solved pattern or false
     */
    solve() {
      if (this._cancelled && this._cancelled()) return false;
      const prog = this._progress;
      if (prog) {
        let filled = 0;
        for (const row of this.wallmap) {
          for (const cell of row) if (cell === 3) filled++;
        }
        prog.tick(`${filled} cells forced`);
      }
      if (!this.ham) return false;
      const free = this.lenx * this.leny - this.wallcount;
      if (free % 2 || !darkLightCheck(this.wallmap)) {
        this.ham = false;
        return false;
      }
      this.work();
      if (this._cancelled && this._cancelled()) return false;
      if (!this.ham) return false;
      const need = this.leny * this.lenx - this.wallcount;
      if (this.wallmap[0][0] === 3 && cycleCheck(this.snakemap, 0, 0) === need || this.wallmap[0][1] === 3 && cycleCheck(this.snakemap, 1, 0) === need) {
        return this;
      }
      let guess = this.clone();
      const fe = this.firstEmpty();
      if (fe == null) return false;
      guess.wallmap[fe[1]][fe[0]] = 3;
      const guesspiece = [0, 0, 0, 0];
      if (this.adjacencymap[fe[1]][fe[0]][0] === 2) guesspiece[0] = 1;
      else if (this.adjacencymap[fe[1]][fe[0]][2] === 2) guesspiece[2] = 1;
      guesspiece[1] = 1;
      guess.snakemap[fe[1]][fe[0]] = guesspiece.slice();
      guess.adjacencymap = newAdjmap(guess.wallmap, guess.snakemap);
      if (!cycleCheck(guess.snakemap, fe[0], fe[1])) {
        const g1 = guess.solve();
        if (g1) return g1;
      }
      guess = this.clone();
      guess.wallmap[fe[1]][fe[0]] = 3;
      guesspiece[1] = 0;
      guesspiece[3] = 1;
      guess.snakemap[fe[1]][fe[0]] = guesspiece.slice();
      guess.adjacencymap = newAdjmap(guess.wallmap, guess.snakemap);
      if (!cycleCheck(guess.snakemap, fe[0], fe[1])) {
        const g2 = guess.solve();
        if (g2) return g2;
      }
      return false;
    }
  };

  // js/hamilton-classic-entry.js
  var cancelled = false;
  var dfsBackendLogged = false;
  setCancelCheck(() => cancelled);
  var wasmInit = initDfsWasm();
  self.onmessage = async (ev) => {
    const msg = ev.data || {};
    if (msg.type === "cancel") {
      cancelled = true;
      dfsWasmSetCancelled(true);
      syncWasmCancel();
      return;
    }
    if (msg.type !== "solve") return;
    cancelled = false;
    dfsWasmSetCancelled(false);
    const { bits, width, height, id } = msg;
    try {
      await wasmInit;
      if (!dfsBackendLogged) {
        dfsBackendLogged = true;
        self.postMessage({
          type: "log",
          id,
          message: dfsWasmReady() ? "DFS: wasm" : "DFS: js"
        });
      }
      const result = runSolve(bits, width, height, id);
      self.postMessage({
        type: "done",
        id,
        stopped: cancelled,
        ...result
      });
    } catch (err) {
      self.postMessage({
        type: "error",
        id,
        message: err && err.message ? err.message : String(err)
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
    const minGap = tour ? minPathEndGap(tour.length, cycle ? true : cycleOpen) : null;
    return {
      bits,
      walls,
      coloring: color,
      tour,
      kind: cycle ? "cycle" : tour ? "path" : "none",
      has_path: !!(cycle || tour),
      tour_best: cycle ? true : tourBest,
      end_gap: gap,
      min_end_gap: minGap
    };
  }
  function runSolve(bits, width, height, id) {
    configureBoard(width, height);
    const walls = [...bits].filter((ch) => ch === "1").length;
    const grid = bitsToGrid(bits);
    const color = pathColoringReport(grid);
    emit(
      id,
      `${walls} walls \xB7 coloring ${color.black} black / ${color.white} white \xB7 cycle ${color.cycle_possible ? "possible" : "impossible"} \xB7 path ${color.path_possible ? "possible" : "impossible"}`
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
        min_end_gap: minGap
      });
    };
    if (!color.path_possible && !color.cycle_possible) {
      emit(id, "coloring rules out a cycle and a path");
      return finish(null, false, null, color, bits, walls, cycleOpen);
    }
    return progressScope((msg) => emit(id, msg), 1e3, () => {
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
          }
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
              } else {
                push(tour, false, best);
              }
            }
          });
          if (newTour) tour = newTour;
          if (newGap != null) {
          }
          if (isBest) tourBest = true;
        }
      }
      return finish(tour, cycle, tourBest, color, bits, walls, cycleOpen);
    });
  }
})();
