/**
 * The seeded dungeon generator: rooms cut from stone, joined by corridors with a few loops, the stairs in a room,
 * cracked walls where a short dig saves many steps, then contents that grow richer and more dangerous with depth
 * (walking distance from the stairs). Everything comes from the code's random stream, so a code always gives the
 * same dungeon; changing anything here changes every code.
 */
import { randInt, rngFrom, shuffle, type Rng } from './rng';
import {
  BEDROCK, CRACKED_HP, FLOOR, GOLD, MONSTER_STATS, POTION, STAIRS, STRENGTH, TORCH, TRAP, VIGOUR, WALL, WALL_HP,
  isOpen, type Monster, type MonsterKind, type Tile,
} from './tiles';

export const DUNGEON_SIZE = 20;

export interface Room { x: number; y: number; w: number; h: number }

export interface Dungeon {
  code: string;
  size: number;
  tiles: Tile[];
  /** HP of each stone wall (0 elsewhere). */
  wallHp: number[];
  /** Gold in each pile (0 elsewhere). */
  gold: number[];
  stairs: number;
  rooms: Room[];
  /** In their fixed acting order. */
  monsters: Monster[];
}

/** Generator numbers *(tune)*. */
export const GEN = {
  maxRooms: 8,
  roomAttempts: 300,
  roomMin: 3,
  roomMax: 5,
  /** Corridors beyond the spanning tree, so there are loops. */
  extraLinks: 2,
  crackedWalls: 3,
  /** A cracked wall goes only where digging through saves at least this many steps. */
  crackMinSaving: 8,
  /** No monster starts this close to the stairs (walking distance). */
  safeDistance: 5,
  /** Rooms of the deepest this many get a troll guarding a heap. */
  trollRooms: 1,
  richChance: 0.25,
  potions: 2,
  torches: 2,
  /**
   * Strength and vigour, each by the room-depth range it goes in: one closer, one deeper, so he weighs a longer,
   * riskier trip for both against a shorter one for one.
   */
  strengths: [[0.3, 0.7], [0.6, 1]],
  vigours: [[0.2, 0.6], [0.5, 1]],
  traps: 4,
  smallPile: 3,
  heap: 10,
} as const;

// Directions in the fixed order up, right, down, left.
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export const xyOf = (size: number, i: number): [number, number] => [i % size, Math.floor(i / size)];

/** The 4 side neighbours of a tile, in the order up, right, down, left (off the grid skipped). */
export function sideNeighbours(size: number, i: number): number[] {
  const [x, y] = xyOf(size, i);
  const out: number[] = [];
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d];
    const ny = y + DY[d];
    if (nx >= 0 && ny >= 0 && nx < size && ny < size) out.push(ny * size + nx);
  }
  return out;
}

/** Walking distance from `from` to every tile over open tiles, no digging (-1: unreachable). */
export function walkingDistances(d: Pick<Dungeon, 'size' | 'tiles'>, from: number): number[] {
  const dist = new Array<number>(d.tiles.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const n of sideNeighbours(d.size, i)) {
      if (dist[n] < 0 && isOpen(d.tiles[n])) {
        dist[n] = dist[i] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

/** Depth: walking distance from the stairs. */
export const depths = (d: Dungeon): number[] => walkingDistances(d, d.stairs);

export const roomTiles = (size: number, r: Room): number[] => {
  const out: number[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(y * size + x);
  return out;
};

const roomCentre = (size: number, r: Room): number => (r.y + (r.h >> 1)) * size + r.x + (r.w >> 1);

/** Steps saved by digging through the wall at `i`: walking round between its two open sides, minus the 2 steps through. */
export function digSaving(d: Pick<Dungeon, 'size' | 'tiles'>, i: number): number {
  if (d.tiles[i] !== WALL) return 0;
  const [x, y] = xyOf(d.size, i);
  let best = 0;
  for (const [ax, ay, bx, by] of [[x - 1, y, x + 1, y], [x, y - 1, x, y + 1]]) {
    const a = ay * d.size + ax;
    const b = by * d.size + bx;
    if (!isOpen(d.tiles[a]) || !isOpen(d.tiles[b])) continue;
    const round = walkingDistances(d, a)[b];
    if (round > 0) best = Math.max(best, round - 2);
  }
  return best;
}

export function generateDungeon(code: string): Dungeon {
  const size = DUNGEON_SIZE;
  const rng = rngFrom(code);
  const tiles: Tile[] = new Array<Tile>(size * size).fill(WALL);
  const at = (x: number, y: number) => y * size + x;
  for (let i = 0; i < size; i++) {
    tiles[at(i, 0)] = BEDROCK;
    tiles[at(i, size - 1)] = BEDROCK;
    tiles[at(0, i)] = BEDROCK;
    tiles[at(size - 1, i)] = BEDROCK;
  }

  // 1. Rooms, never touching: at least one wall between any two.
  const rooms: Room[] = [];
  for (let k = 0; k < GEN.roomAttempts && rooms.length < GEN.maxRooms; k++) {
    const w = GEN.roomMin + randInt(rng, GEN.roomMax - GEN.roomMin + 1);
    const h = GEN.roomMin + randInt(rng, GEN.roomMax - GEN.roomMin + 1);
    const x = 1 + randInt(rng, size - 2 - w + 1);
    const y = 1 + randInt(rng, size - 2 - h + 1);
    const clear = rooms.every((r) => x + w < r.x || r.x + r.w < x || y + h < r.y || r.y + r.h < y);
    if (clear) rooms.push({ x, y, w, h });
  }
  for (const r of rooms) for (const i of roomTiles(size, r)) tiles[i] = FLOOR;

  // 2. Corridors: a spanning tree (each new room joined to its nearest joined room), then a few extra links.
  const centres = rooms.map((r) => roomCentre(size, r));
  const gap = (a: number, b: number) => {
    const [ax, ay] = xyOf(size, centres[a]);
    const [bx, by] = xyOf(size, centres[b]);
    return Math.abs(ax - bx) + Math.abs(ay - by);
  };
  const linked = new Set<string>();
  const link = (a: number, b: number) => {
    linked.add(`${Math.min(a, b)},${Math.max(a, b)}`);
    carveCorridor(tiles, size, centres[a], centres[b], rng);
  };
  const joined = [0];
  while (joined.length < rooms.length) {
    let best: [number, number] | null = null;
    for (let b = 0; b < rooms.length; b++) {
      if (joined.includes(b)) continue;
      for (const a of joined) if (!best || gap(a, b) < gap(best[0], best[1])) best = [a, b];
    }
    const [a, b] = best!;
    link(a, b);
    joined.push(b);
  }
  const extras: [number, number][] = [];
  for (let a = 0; a < rooms.length; a++) {
    for (let b = a + 1; b < rooms.length; b++) if (!linked.has(`${a},${b}`)) extras.push([a, b]);
  }
  extras.sort((p, q) => gap(p[0], p[1]) - gap(q[0], q[1]));
  for (const [a, b] of shuffle(rng, extras.slice(0, GEN.extraLinks * 2)).slice(0, GEN.extraLinks)) link(a, b);

  // 3. Stairs: in one of the rooms that reach deepest, so there is a real way to go.
  const reach = rooms.map((r) => Math.max(...walkingDistances({ size, tiles }, roomCentre(size, r))));
  const byReach = rooms.map((_, k) => k).sort((p, q) => reach[q] - reach[p] || p - q);
  const stairsRoom = byReach[randInt(rng, Math.max(1, Math.ceil(rooms.length / 2)))];
  const sr = rooms[stairsRoom];
  const stairs = at(sr.x + 1 + randInt(rng, sr.w - 2), sr.y + 1 + randInt(rng, sr.h - 2));
  tiles[stairs] = STAIRS;

  const wallHp: number[] = tiles.map((t) => (t === WALL ? WALL_HP : 0));
  const gold = new Array<number>(size * size).fill(0);
  const dungeon: Dungeon = { code, size, tiles, wallHp, gold, stairs, rooms, monsters: [] };

  // 4. Cracked walls: first where a wall already parts two places that are far apart on foot; then, while there
  // are too few, a shortcut corridor between two rooms that are close but far apart on foot, blocked in the
  // middle by a cracked wall (until it is dug, both halves are dead ends).
  const cracked: number[] = [];
  const farFromCracked = (i: number) => cracked.every((c) => {
    const [cx, cy] = xyOf(size, c);
    const [x, y] = xyOf(size, i);
    return Math.abs(cx - x) + Math.abs(cy - y) >= 4;
  });
  const natural = shuffle(rng, tiles.map((_, i) => i).filter((i) => tiles[i] === WALL))
    .map((i) => [i, digSaving(dungeon, i)] as const)
    .filter(([, s]) => s >= GEN.crackMinSaving)
    .sort((p, q) => q[1] - p[1]);
  for (const [i] of natural) {
    if (cracked.length >= GEN.crackedWalls) break;
    if (!farFromCracked(i)) continue;
    wallHp[i] = CRACKED_HP;
    cracked.push(i);
  }
  const pairs: [number, number, number][] = [];
  for (let a = 0; a < rooms.length; a++) {
    const walk = walkingDistances(dungeon, centres[a]);
    for (let b = a + 1; b < rooms.length; b++) pairs.push([a, b, walk[centres[b]] - gap(a, b)]);
  }
  shuffle(rng, pairs).sort((p, q) => q[2] - p[2]);
  for (const [a, b, extra] of pairs) {
    if (cracked.length >= GEN.crackedWalls || extra < GEN.crackMinSaving) break;
    const before = tiles.slice();
    const dug = carveCorridor(tiles, size, centres[a], centres[b], rng);
    // The wall to leave: a straight stretch of the new corridor, as near its middle as possible.
    const straight = dug.filter((i, k) => k > 0 && k < dug.length - 1 && isStraight(size, dug[k - 1], i, dug[k + 1]));
    straight.sort((p, q) => Math.abs(dug.indexOf(p) - (dug.length - 1) / 2) - Math.abs(dug.indexOf(q) - (dug.length - 1) / 2));
    // It must save enough itself, and the new corridor must not take the point out of an earlier cracked wall.
    const wall = straight.find((i) => {
      tiles[i] = WALL;
      const ok = farFromCracked(i) && [i, ...cracked].every((c) => digSaving(dungeon, c) >= GEN.crackMinSaving);
      tiles[i] = FLOOR;
      return ok;
    });
    if (wall === undefined) {
      for (let i = 0; i < tiles.length; i++) tiles[i] = before[i];
      continue;
    }
    tiles[wall] = WALL;
    wallHp[wall] = CRACKED_HP;
    for (const i of dug) if (i !== wall) wallHp[i] = 0;
    cracked.push(wall);
  }

  placeContents(dungeon, stairsRoom, rng);
  return dungeon;
}

/**
 * An L-shaped corridor between two tiles, horizontal or vertical leg first at random. Returns the tiles it dug out
 * of stone, in order along the way, each with the tile before and after it on the way (consecutive only where the
 * corridor runs through stone).
 */
function carveCorridor(tiles: Tile[], size: number, from: number, to: number, rng: Rng): number[] {
  let [x, y] = xyOf(size, from);
  const [tx, ty] = xyOf(size, to);
  const horizontalFirst = rng() < 0.5;
  const dug: number[] = [];
  const dig = () => {
    const i = y * size + x;
    if (tiles[i] === WALL) { tiles[i] = FLOOR; dug.push(i); }
  };
  const walkX = () => { while (x !== tx) { x += Math.sign(tx - x); dig(); } };
  const walkY = () => { while (y !== ty) { y += Math.sign(ty - y); dig(); } };
  if (horizontalFirst) { walkX(); walkY(); } else { walkY(); walkX(); }
  return dug;
}

/** Whether `b` lies between `a` and `c` in a straight line, all three side by side. */
function isStraight(size: number, a: number, b: number, c: number): boolean {
  return a - b === b - c && (Math.abs(a - b) === 1 || Math.abs(a - b) === size);
}

/** Gold, monsters, items and traps, by how deep each room is. */
function placeContents(d: Dungeon, stairsRoom: number, rng: Rng) {
  const { size, tiles } = d;
  const depth = depths(d);
  const maxDepth = Math.max(...depth);
  const inRoom = new Array<boolean>(size * size).fill(false);
  for (const r of d.rooms) for (const i of roomTiles(size, r)) inRoom[i] = true;

  // Each room's depth as a fraction of the deepest tile: 0 at the stairs, 1 at the far end.
  const roomDepth = d.rooms.map((r) => {
    const ts = roomTiles(size, r);
    return ts.reduce((s, i) => s + depth[i], 0) / ts.length / maxDepth;
  });
  const others = d.rooms.map((_, k) => k).filter((k) => k !== stairsRoom).sort((p, q) => roomDepth[p] - roomDepth[q] || p - q);
  const trollRooms = new Set(others.slice(-GEN.trollRooms));

  const occupied = new Set<number>();
  const isEmpty = (i: number) => tiles[i] === FLOOR && !occupied.has(i);
  const freeIn = (k: number, minDepth = 0) => shuffle(rng, roomTiles(size, d.rooms[k]).filter((i) => isEmpty(i) && depth[i] >= minDepth));
  const putGold = (i: number, amount: number) => { tiles[i] = GOLD; d.gold[i] = amount; };
  const putMonster = (kind: MonsterKind, i: number) => {
    d.monsters.push({ kind, pos: i, hp: MONSTER_STATS[kind].hp, rich: rng() < GEN.richChance });
    occupied.add(i);
  };
  const monsterIn = (k: number, kind: MonsterKind) => {
    const spot = freeIn(k, GEN.safeDistance)[0];
    if (spot !== undefined) putMonster(kind, spot);
  };

  for (const k of others) {
    const t = roomDepth[k];
    if (trollRooms.has(k)) {
      // A troll stands next to the heap it guards: taking the heap means standing beside it.
      for (const i of freeIn(k, GEN.safeDistance)) {
        const guard = sideNeighbours(size, i).find((n) => inRoom[n] && isEmpty(n) && depth[n] >= GEN.safeDistance);
        if (guard === undefined) continue;
        putGold(i, GEN.heap);
        putMonster('troll', guard);
        break;
      }
      const extra = freeIn(k)[0];
      if (extra !== undefined) putGold(extra, GEN.heap);
      continue;
    }
    const piles = t < 1 / 3 ? [GEN.smallPile] : t < 2 / 3 ? [GEN.smallPile, GEN.smallPile] : [GEN.heap, GEN.smallPile];
    for (const amount of piles) {
      const spot = freeIn(k)[0];
      if (spot !== undefined) putGold(spot, amount);
    }
    if (t < 1 / 3) {
      if (rng() < 0.5) monsterIn(k, 'rat');
    } else if (t < 2 / 3) {
      monsterIn(k, 'goblin');
      if (rng() < 0.5) monsterIn(k, 'rat');
    } else {
      monsterIn(k, 'slime');
      if (rng() < 0.5) monsterIn(k, 'goblin');
    }
  }

  // Items: each in a room whose depth lies in the given range (or any room if none does).
  const placeItem = (tile: Tile, lo: number, hi: number) => {
    const fits = others.filter((k) => roomDepth[k] >= lo && roomDepth[k] <= hi && !trollRooms.has(k));
    const pool = shuffle(rng, fits.length ? fits : others.slice());
    for (const k of pool) {
      const spot = freeIn(k)[0];
      if (spot !== undefined) { tiles[spot] = tile; return; }
    }
  };
  for (let n = 0; n < GEN.potions; n++) placeItem(POTION, 0.2, 0.8);
  placeItem(TORCH, 0, 0.5);
  for (let n = 1; n < GEN.torches; n++) placeItem(TORCH, 0.3, 0.8);
  for (const [lo, hi] of GEN.strengths) placeItem(STRENGTH, lo, hi);
  for (const [lo, hi] of GEN.vigours) placeItem(VIGOUR, lo, hi);

  // Spike traps in corridors, away from the stairs and from each other.
  const corridor = shuffle(rng, tiles.map((_, i) => i).filter((i) => !inRoom[i] && isEmpty(i) && depth[i] >= 3));
  const traps: number[] = [];
  for (const i of corridor) {
    if (traps.length >= GEN.traps) break;
    if (sideNeighbours(size, i).some((n) => tiles[n] === TRAP)) continue;
    tiles[i] = TRAP;
    traps.push(i);
  }
}
