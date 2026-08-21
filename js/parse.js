/** PuddingBot-style pattern paste parsing → canonical 0/1 bits (1 = wall). */

export const SIZES = {
  small: { id: "small", label: "Small", width: 10, height: 9, cells: 90 },
  standard: { id: "standard", label: "Standard", width: 17, height: 15, cells: 255 },
  large: { id: "large", label: "Large", width: 24, height: 21, cells: 504 },
};

const BY_CELLS = new Map(Object.values(SIZES).map((s) => [s.cells, s]));

const CODE_FENCE_RE = /^```(?:\w+)?\s*|\s*```$/gs;
const LEADING_MENTION_RE = /^<@!?\d+>\s*/;

export function unwrapCopiedPattern(raw) {
  let text = (raw || "").trim();
  text = text.replace(CODE_FENCE_RE, "").trim();
  if (
    text.length >= 2 &&
    text[0] === text[text.length - 1] &&
    (text[0] === '"' || text[0] === "'" || text[0] === "`")
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.replace(LEADING_MENTION_RE, "").trim();
}

/** Keep only 0/1/2 cells (spaces, letters, punctuation ignored). */
export function normalizePatternString(patternString) {
  return [...(patternString || "")].filter((ch) => ch === "0" || ch === "1" || ch === "2").join("");
}

/**
 * Minority digit = walls; count tie → higher digit = walls.
 * Returns solver form: 1 = empty, 2 = wall (PuddingBot internal).
 */
function mapToEmptyAndWall(cleaned) {
  const counts = new Map();
  for (const ch of cleaned) counts.set(ch, (counts.get(ch) || 0) + 1);
  if (counts.size <= 1) return "1".repeat(cleaned.length);
  let wallChar = null;
  let best = null;
  for (const [ch, n] of counts) {
    const key = [n, -Number(ch)];
    if (
      best == null ||
      key[0] < best[0] ||
      (key[0] === best[0] && key[1] < best[1])
    ) {
      best = key;
      wallChar = ch;
    }
  }
  return [...cleaned].map((ch) => (ch === wallChar ? "2" : "1")).join("");
}

/** Canonical research bits: 1 = wall, 0 = empty. */
export function toCanonicalBits(cleaned012) {
  if (!cleaned012) return "";
  const mapped = mapToEmptyAndWall(cleaned012);
  return [...mapped].map((ch) => (ch === "2" ? "1" : "0")).join("");
}

/**
 * Parse paste → { ok, bits, size, error }.
 * bits are canonical 0/1. size is a SIZES entry when length matches.
 */
export function parsePatternInput(raw) {
  const cleaned = normalizePatternString(unwrapCopiedPattern(raw));
  if (!cleaned.length) {
    return { ok: false, bits: "", size: null, error: "No 0/1/2 cells found." };
  }
  const size = BY_CELLS.get(cleaned.length) || null;
  if (!size) {
    return {
      ok: false,
      bits: cleaned,
      size: null,
      error: `Need 90, 255, or 504 cells after stripping; got ${cleaned.length}.`,
    };
  }
  return { ok: true, bits: toCanonicalBits(cleaned), size, error: null };
}

export function sizeForCells(n) {
  return BY_CELLS.get(n) || null;
}

export function emptyBits(cells) {
  return "0".repeat(cells);
}
