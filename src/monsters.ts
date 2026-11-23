/**
 * What the monsters do after each of his actions. Next to means sharing a side. A mobile monster next to him hits
 * him; otherwise, if it notices him, it steps towards him by a shortest path; otherwise it wanders. An immobile one
 * only hits. They act one at a time, in their fixed order (the generator's order).
 */
import { DX, DY, sideNeighbours } from './dungeon';
import { randInt, type Rng } from './rng';
import { sees } from './sight';
import { FLOOR, MONSTER_STATS, isItem, type Monster, type Tile } from './tiles';
import type { RaidState } from './world';

/** A monster notices him within a square of this many tiles, if it can see him. */
export const NOTICE_RANGE = 3;
/** ... or of this many while his torch is lit. */
export const NOTICE_RANGE_LIT = 5;
/** A wandering monster draws one of this many choices: up, right, down, left, or stay. */
export const WANDER_CHOICES = 5;

export interface MonsterHit { kind: Monster['kind']; damage: number }

/** The tile kinds a monster may step onto: floor and items. Never traps, stairs or walls. */
export const monsterMayEnter = (t: Tile): boolean => t === FLOOR || isItem(t);

/** Whether a monster may step onto tile `i` now: a tile it may enter, without him or another monster on it. */
export function freeForMonster(s: RaidState, i: number): boolean {
  return monsterMayEnter(s.map.tiles[i]) && i !== s.pos && !s.monsters.some((m) => m.pos === i);
}

export const isNextTo = (size: number, a: number, b: number): boolean => sideNeighbours(size, a).includes(b);

export function noticeRange(s: RaidState): number {
  return s.torchLeft > 0 ? NOTICE_RANGE_LIT : NOTICE_RANGE;
}

export function notices(s: RaidState, m: Monster): boolean {
  return sees(s.map, m.pos, s.pos, noticeRange(s));
}

/**
 * Steps from every tile to him for a monster: breadth-first from his tile over tiles monsters may enter, ignoring
 * other monsters (they move). -1 where no monster could reach him.
 */
export function chaseDistances(s: RaidState): number[] {
  const { size, tiles } = s.map;
  const dist = new Array<number>(tiles.length).fill(-1);
  dist[s.pos] = 0;
  const queue = [s.pos];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const n of sideNeighbours(size, i)) {
      if (dist[n] < 0 && monsterMayEnter(tiles[n])) {
        dist[n] = dist[i] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

/**
 * The tile a noticing monster steps to: of its free side neighbours, the one nearest him, ties in the order up,
 * right, down, left. It only steps if that brings it closer; otherwise it waits.
 */
export function chaseStep(s: RaidState, m: Monster, dist: number[]): number {
  let best = m.pos;
  let bestDist = dist[m.pos] < 0 ? Infinity : dist[m.pos];
  for (const n of sideNeighbours(s.map.size, m.pos)) {
    if (dist[n] >= 0 && dist[n] < bestDist && freeForMonster(s, n)) {
      best = n;
      bestDist = dist[n];
    }
  }
  return best;
}

/** A wandering step: one draw from the monster stream, one in 5 each for up, right, down, left or stay. */
export function wanderStep(s: RaidState, m: Monster, rng: Rng): number {
  const d = randInt(rng, WANDER_CHOICES);
  if (d === 4) return m.pos;
  const { size } = s.map;
  const x = (m.pos % size) + DX[d];
  const y = Math.floor(m.pos / size) + DY[d];
  if (x < 0 || y < 0 || x >= size || y >= size) return m.pos;
  const n = y * size + x;
  return freeForMonster(s, n) ? n : m.pos;
}

/** Every monster acts once, in order. Returns the hits he took. Draws from `rng` only for wandering monsters. */
export function monstersAct(s: RaidState, rng: Rng): MonsterHit[] {
  const hits: MonsterHit[] = [];
  let dist: number[] | null = null;
  for (const m of s.monsters) {
    const stats = MONSTER_STATS[m.kind];
    if (isNextTo(s.map.size, m.pos, s.pos)) {
      s.hp = Math.max(0, s.hp - stats.attack);
      hits.push({ kind: m.kind, damage: stats.attack });
      continue;
    }
    if (!stats.mobile) continue;
    if (notices(s, m)) {
      dist ??= chaseDistances(s);
      m.pos = chaseStep(s, m, dist);
    } else {
      m.pos = wanderStep(s, m, rng);
    }
  }
  return hits;
}
