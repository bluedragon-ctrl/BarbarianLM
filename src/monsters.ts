/**
 * What the monsters do after each of his actions. Next to means sharing a side. A mobile monster next to him hits
 * him; otherwise, if it notices him, it steps towards him by a shortest path; otherwise it wanders. An immobile one
 * only hits. They act one at a time, in their fixed order (the generator's order). A chasing monster may step onto
 * a spike trap, which hurts it as it hurts him; a wandering one never does.
 */
import { DX, DY, sideNeighbours } from './dungeon';
import { randInt, type Rng } from './rng';
import { sees } from './sight';
import { FLOOR, MONSTER_STATS, TRAP, TRAP_DAMAGE, isItem, type Monster, type Tile } from './tiles';
import type { RaidState } from './world';

/** A monster notices him within a square of this many tiles, if it can see him. */
export const NOTICE_RANGE = 3;
/** ... or of this many while his torch is lit. */
export const NOTICE_RANGE_LIT = 5;
/** A wandering monster draws one of this many choices: up, right, down, left, or stay. */
export const WANDER_CHOICES = 5;

/** A spike trap counts as this many steps to a chasing monster, so it goes round when that is no longer. */
export const TRAP_STEPS = 2;

export interface MonsterHit { kind: Monster['kind']; damage: number }
/** A chasing monster that stepped onto a spike trap; a beaten one is gone, with no gold. */
export interface MonsterTrapped { monster: Monster; damage: number; beaten: boolean }

/** The tile kinds a wandering monster may step onto: floor and items. Never traps, stairs or walls. */
export const monsterMayEnter = (t: Tile): boolean => t === FLOOR || isItem(t);
/** ... and a chasing one: spike traps too. */
export const chaserMayEnter = (t: Tile): boolean => monsterMayEnter(t) || t === TRAP;

const untaken = (s: RaidState, i: number): boolean => i !== s.pos && !s.monsters.some((m) => m.pos === i);

/** Whether a wandering monster may step onto tile `i` now: a tile it may enter, without him or another monster on it. */
export function freeForMonster(s: RaidState, i: number): boolean {
  return monsterMayEnter(s.map.tiles[i]) && untaken(s, i);
}

/** Steps it costs a chasing monster to step onto tile `i`. */
const stepCost = (t: Tile): number => (t === TRAP ? TRAP_STEPS : 1);

export const isNextTo = (size: number, a: number, b: number): boolean => sideNeighbours(size, a).includes(b);

export function noticeRange(s: RaidState): number {
  return s.torchLeft > 0 ? NOTICE_RANGE_LIT : NOTICE_RANGE;
}

export function notices(s: RaidState, m: Monster): boolean {
  return sees(s.map, m.pos, s.pos, noticeRange(s));
}

/**
 * Steps from every tile to him for a chasing monster, over tiles it may enter, a trap counting 2 (the tile it starts
 * on and his own tile are free). Other monsters are ignored: they move. -1 where no monster could reach him.
 * Costs are 1 or 2, so a queue per distance keeps it exact.
 */
export function chaseDistances(s: RaidState): number[] {
  const { size, tiles } = s.map;
  const dist = new Array<number>(tiles.length).fill(-1);
  dist[s.pos] = 0;
  const buckets: number[][] = [[s.pos]];
  for (let d = 0; d < buckets.length; d++) {
    for (const i of buckets[d] ?? []) {
      if (dist[i] !== d) continue;
      // From tile n, a monster steps onto i: that costs i's steps (his own tile costs 1, he is no trap to it).
      const cost = i === s.pos ? 1 : stepCost(tiles[i]);
      for (const n of sideNeighbours(size, i)) {
        if (!chaserMayEnter(tiles[n])) continue;
        const nd = d + cost;
        if (dist[n] < 0 || nd < dist[n]) {
          dist[n] = nd;
          (buckets[nd] ??= []).push(n);
        }
      }
    }
  }
  return dist;
}

/**
 * The tile a noticing monster steps to: of its free side neighbours on a shortest way to him, the first in the
 * order up, right, down, left. If none is free (no way to him, or another monster in the way), it waits.
 */
export function chaseStep(s: RaidState, m: Monster, dist: number[]): number {
  if (dist[m.pos] < 0) return m.pos;
  for (const n of sideNeighbours(s.map.size, m.pos)) {
    const t = s.map.tiles[n];
    if (dist[n] >= 0 && chaserMayEnter(t) && dist[n] + stepCost(t) === dist[m.pos] && untaken(s, n)) return n;
  }
  return m.pos;
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

/**
 * Every monster acts once, in order. Returns the hits he took and the monsters that stepped onto traps (beaten ones
 * are removed after all have acted). Draws from `rng` only for wandering monsters.
 */
export function monstersAct(s: RaidState, rng: Rng): { hits: MonsterHit[]; trapped: MonsterTrapped[] } {
  const hits: MonsterHit[] = [];
  const trapped: MonsterTrapped[] = [];
  let dist: number[] | null = null;
  for (const m of s.monsters) {
    const stats = MONSTER_STATS[m.kind];
    if (isNextTo(s.map.size, m.pos, s.pos)) {
      s.hp = Math.max(0, s.hp - stats.attack);
      hits.push({ kind: m.kind, damage: stats.attack });
      continue;
    }
    if (!stats.mobile) continue;
    if (m.hp <= 0) continue; // beaten by a trap earlier this turn; never acts again
    if (notices(s, m)) {
      dist ??= chaseDistances(s);
      const to = chaseStep(s, m, dist);
      if (to !== m.pos && s.map.tiles[to] === TRAP) {
        m.hp = Math.max(0, m.hp - TRAP_DAMAGE);
        trapped.push({ monster: { ...m, pos: to }, damage: TRAP_DAMAGE, beaten: m.hp === 0 });
      }
      m.pos = to;
    } else {
      m.pos = wanderStep(s, m, rng);
    }
  }
  s.monsters = s.monsters.filter((m) => m.hp > 0);
  return { hits, trapped };
}
