# Google Snake Wall Solver

Client-side (GitHub Pages) board for solving Google Snake **Wall** patterns. Runs entirely in the browser — no server, no database.

Open [index.html](index.html) locally via any static file server, or enable GitHub Pages on this repo (Settings → Pages → Deploy from `main` / root).

## Board sizes

| Size | Width × Height | Cells |
|------|----------------|------:|
| Small | 10 × 9 | 90 |
| Standard | 17 × 15 | 255 |
| Large | 24 × 21 | 504 |

(Wiki labels swap axis order; this app matches research/`carrot` width × height.)

## Controls

- **Solve** — coloring prune, then Hamiltonian path, then cycle (if coloring allows), then closest head–tail gap for paths. No timeouts.
- **Stop** — abort the current search; keeps the best tour found so far.
- **Random** — generates a complete valid wall pattern (carrot adjacency / edge / corner rules). Does not pull from a list.
- **Copy pattern** — clipboard gets canonical `0`/`1` bits only (`1` = wall).
- **Clear** — empty board.

## Shareable URLs

Patterns sync into the address bar as you edit:

| URL | Effect |
|-----|--------|
| `?board=0101…` | Load that pattern (90 / 255 / 504 bits; size follows length) |
| `?board=0101…&solve=1` | Load and **immediately Solve** |
| `#board=0101…` | Same via hash (research Board style) |
| `#board=0101…&solve=1` | Hash form with auto-solve |

Aliases: `p` / `pattern` for the bits; `solve` with no value also counts as on. Paste-style strings in the param are parsed the same as the textarea. After a solve finishes, `solve` is dropped from the URL so a refresh does not loop; the `board=` bits remain for sharing.

## Paste formats

As generous as PuddingBot `/wallall`:

- PuddingMod clipboard: `pattern 122101…`
- Raw `0`/`1` or `1`/`2` grids (spaces / newlines / fences / Discord mentions stripped)
- Minority digit = walls (tie → higher digit)
- Length `90` / `255` / `504` auto-selects board size

## Wall pattern rules (geometry)

Complete patterns follow community/`wall.py` carrot rules: no 8-neighbor wall adjacency, ±2 spacing on borders, and corner anti–death-trap pairs. Live spawn radius and snake occupancy are ignored for static pattern work.

## Local preview

```bash
npx --yes serve .
```

Then open the printed URL. Module workers need HTTP(S), not `file://`.
