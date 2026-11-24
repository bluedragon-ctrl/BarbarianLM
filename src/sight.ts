/**
 * One sight rule for him and the monsters: a cell is seen if a line from tile centre to tile centre reaches it
 * without passing through a wall. Monsters never block sight. Where the line passes exactly halfway between two
 * tiles, either may be taken, so one open is enough. The rule is the same both ways round.
 */
import { MONSTER_KINDS, SHOWN_KINDS, isWall, isWounded, shownKind, type Monster, type Tile } from './tiles';

/** What sight needs of a map. */
export interface SightMap { size: number; tiles: Tile[] }

/** Chebyshev distance: the size of the square around `a` that `b` lies in. */
export function squareDistance(size: number, a: number, b: number): number {
  return Math.max(Math.abs((a % size) - (b % size)), Math.abs(Math.floor(a / size) - Math.floor(b / size)));
}

/** The cells a line at offset `num / n` may pass through on one axis: one, or two when it is exactly halfway. */
function axisCells(num: number, n: number): number[] {
  if (num % n === 0) return [num / n];
  if ((2 * num) % n === 0) return [Math.floor(num / n), Math.ceil(num / n)];
  return [Math.round(num / n)];
}

/**
 * Whether the line from `from` to `to` is clear: every tile it passes between them is open (or, at a halfway
 * point, at least one of the two). The end tiles themselves may be walls, so he sees the wall that blocks him.
 */
export function lineClear(map: SightMap, from: number, to: number): boolean {
  const { size, tiles } = map;
  const fx = from % size;
  const fy = Math.floor(from / size);
  const dx = (to % size) - fx;
  const dy = Math.floor(to / size) - fy;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  for (let k = 1; k < n; k++) {
    let open = false;
    for (const ox of axisCells(k * dx, n)) {
      for (const oy of axisCells(k * dy, n)) {
        const x = fx + ox;
        const y = fy + oy;
        if (x >= 0 && y >= 0 && x < size && y < size && !isWall(tiles[y * size + x])) open = true;
      }
    }
    if (!open) return false;
  }
  return true;
}

/** Whether `to` is seen from `from` within a square of `range` tiles. */
export function sees(map: SightMap, from: number, to: number, range: number): boolean {
  return squareDistance(map.size, from, to) <= range && lineClear(map, from, to);
}

/** View cell kinds: the 12 shown tile kinds, then dark, then the 5 monsters (18 in all). */
export const DARK = SHOWN_KINDS;
export const MONSTER_VIEW_KIND = (kind: Monster['kind']): number => SHOWN_KINDS + 1 + MONSTER_KINDS.indexOf(kind);
export const VIEW_KINDS = SHOWN_KINDS + 1 + MONSTER_KINDS.length;
/** His view is always this many cells across. */
export const VIEW_SIZE = 5;
/** How far he sees: 1 tile around him in the dark, 2 with a lit torch. */
export const SIGHT_DARK = 1;
export const SIGHT_LIT = 2;

export interface ViewCell { kind: number; wounded: boolean; rich: boolean }

/** What a view needs: the map with wall HP and gold, the monsters, where he is and whether his torch is lit. */
export interface ViewSource extends SightMap { wallHp: number[]; gold: number[]; monsters: Monster[]; pos: number; lit: boolean }

/**
 * His 5 × 5 view, row by row from the top-left, his own tile in the middle. Cells out of the light, behind a wall
 * or off the map are dark. A monster hides what it stands on.
 */
export function viewOf(s: ViewSource): ViewCell[] {
  const out: ViewCell[] = [];
  forViewCells(s, (i) => {
    if (i < 0) {
      out.push({ kind: DARK, wounded: false, rich: false });
      return;
    }
    const m = s.monsters.find((q) => q.pos === i);
    out.push(m
      ? { kind: MONSTER_VIEW_KIND(m.kind), wounded: isWounded(m), rich: m.rich }
      : { kind: shownKind(s.tiles[i], s.wallHp[i], s.gold[i]), wounded: false, rich: false });
  });
  return out;
}

/**
 * Calls `f` for each cell of his 5 × 5 view, row by row from the top-left, with the map tile it shows, or -1 where
 * the cell is dark (out of the light, behind a wall or off the map).
 */
function forViewCells(s: Pick<ViewSource, 'size' | 'tiles' | 'pos' | 'lit'>, f: (i: number) => void): void {
  const { size } = s;
  const range = s.lit ? SIGHT_LIT : SIGHT_DARK;
  const half = VIEW_SIZE >> 1;
  const px = s.pos % size;
  const py = Math.floor(s.pos / size);
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = px + dx;
      const y = py + dy;
      const i = y * size + x;
      const inside = x >= 0 && y >= 0 && x < size && y < size;
      f(!inside || Math.max(Math.abs(dx), Math.abs(dy)) > range || !lineClear(s, s.pos, i) ? -1 : i);
    }
  }
}

/** The map tiles he sees now: exactly the cells of his view that are not dark. */
export function seenTiles(s: Pick<ViewSource, 'size' | 'tiles' | 'pos' | 'lit'>): number[] {
  const out: number[] = [];
  forViewCells(s, (i) => { if (i >= 0) out.push(i); });
  return out;
}
