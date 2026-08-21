/** Wall pattern generation + Hamiltonian cycle Pattern.solve (from research wall.py). */

export function newBlank(width, height) {
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

/** Place one random eligible wall; mutate b. Returns false if none left. */
export function newWall(b) {
  const lx = b[0].length;
  const ly = b.length;
  const elig = generateEligible(b);
  if (!elig.length) return false;
  const [x, y] = elig[(Math.random() * elig.length) | 0];
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

/** Complete maximal valid wall pattern as grid (1=empty eligible-marked, 2=wall). */
export function newPattern(width, height) {
  const b = newBlank(width, height);
  while (newWall(b));
  return b;
}

/** Canonical 0/1 bits from a wall map (2 = wall). */
export function wallMapToBits(wmap) {
  let out = "";
  for (let y = 0; y < wmap.length; y++) {
    for (let x = 0; x < wmap[0].length; x++) {
      out += wmap[y][x] === 2 ? "1" : "0";
    }
  }
  return out;
}

export function bitsToWallMap(bits, width, height) {
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

export class Pattern {
  constructor(x, y, { wmap = null, smap = null, walls = null } = {}) {
    this.wallmap = wmap ? wmap.map((row) => row.slice()) : newPattern(x, y);
    this.snakemap = smap
      ? smap.map((row) => row.map((c) => c.slice()))
      : new4map(x, y);
    this.lenx = x;
    this.leny = y;
    this.adjacencymap = newAdjmap(this.wallmap, this.snakemap);
    this.ham = true;
    this.wallcount = walls != null ? walls : this.countWalls();
    this._progress = null;
    this._cancelled = null;
  }

  clone() {
    const p = Object.create(Pattern.prototype);
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
    return (
      mapsEqual(this.wallmap, other.wallmap) &&
      mapsEqual(this.snakemap, other.snakemap)
    );
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
    if (
      (this.wallmap[0][0] === 3 && cycleCheck(this.snakemap, 0, 0) === need) ||
      (this.wallmap[0][1] === 3 && cycleCheck(this.snakemap, 1, 0) === need)
    ) {
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
}
