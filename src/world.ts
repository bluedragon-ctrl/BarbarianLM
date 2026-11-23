/**
 * The world rules: a raid's state and what one action does to it, following the turn order in the design:
 * 1. he acts (if he left, the trip ends here); 2. a spike trap he stepped onto hits him; 3. the lit torch burns
 * down a turn and time goes down a turn; 4. each monster acts, in order; 5. knocked out at 0 HP, else locked in at
 * time 0. No DOM here, and no randomness but the monster stream passed to `step`.
 */
import { DX, DY, sideNeighbours, walkingDistances, type Dungeon } from './dungeon';
import { monstersAct, type MonsterHit, type MonsterTrapped } from './monsters';
import type { Rng } from './rng';
import { viewOf, type ViewCell } from './sight';
import {
  BEDROCK, FLOOR, GOLD, POTION, STAIRS, STRENGTH, TORCH, TRAP, TRAP_DAMAGE, VIGOUR, WALL, isItem, isOpen, monsterGold,
  type Monster, type Tile,
} from './tiles';

// The 9 actions (output tokens). The 4 bumps follow the direction order up, right, down, left.
export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;
export const PICK_UP = 4;
export const DRINK = 5;
export const LIGHT_TORCH = 6;
export const LEAVE = 7;
/** Does nothing on purpose: the dungeon answers while he stands still (a monster comes to him and he strikes first). */
export const WAIT = 8;
export type Action = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const ACTIONS = 9;
export const ACTION_NAMES = ['up', 'right', 'down', 'left', 'pick up', 'drink', 'light torch', 'leave', 'wait'] as const;

/** His numbers *(tune)*. */
export const RULES = {
  startHp: 14,
  startAttack: 2,
  startPotions: 2,
  startTorches: 1,
  /** At most this many potions, and this many torches, in his pack. */
  packMax: 3,
  potionHeal: 6,
  /** A torch burns one off a turn, the turn it is lit included: 16 gives 15 lit turns. */
  torchTurns: 16,
  vigourHp: 4,
  trapDamage: TRAP_DAMAGE,
  timeLimit: 200,
} as const;

export type TripEnd = 'left' | 'knockedOut' | 'lockedIn';

/** The raid's own copy of the map: digging, pickups and gold drops change it, never the dungeon. */
export interface RaidMap { size: number; tiles: Tile[]; wallHp: number[]; gold: number[]; stairs: number }

export interface RaidState {
  code: string;
  map: RaidMap;
  pos: number;
  hp: number;
  maxHp: number;
  attack: number;
  potions: number;
  torches: number;
  /** Turns of light left on the burning torch, this one included; lit while above 0. */
  torchLeft: number;
  gold: number;
  timeLeft: number;
  /** Actions taken so far. */
  turn: number;
  /** In their fixed acting order; beaten ones are removed. */
  monsters: Monster[];
  /**
   * Walking distance from the stairs to every tile on the raid's own map (monsters and traps do not block), for
   * the stairs compass and the way back. Kept up to date by `step`, which recomputes it when a wall is dug through.
   */
  stairsDist: number[];
  ended: TripEnd | null;
}

/** What one action did, for thoughts, the saga and counts. */
export interface StepResult {
  action: Action;
  /** What the action did: `nothing` is a wasted action (one "Block impossible actions" would block, or digging nothing). */
  did: 'walk' | 'attack' | 'dig' | 'pickUp' | 'drink' | 'light' | 'leave' | 'wait' | 'nothing';
  /** The tile kind picked up. */
  picked?: Tile;
  /** Gold added to his purse. */
  goldGained: number;
  /** The monster he hit, after the hit. */
  struck?: Monster;
  /** Set when his hit beat it; the gold it dropped and where. */
  beaten?: { monster: Monster; gold: number; at: number };
  /** The wall broke through to floor. */
  dugThrough: boolean;
  trapDamage: number;
  hits: MonsterHit[];
  /** Chasing monsters that stepped onto spike traps. */
  monstersTrapped: MonsterTrapped[];
  /** The torch went out this turn. */
  torchOut: boolean;
  ended: TripEnd | null;
}

export function newRaid(d: Dungeon): RaidState {
  const map: RaidMap = { size: d.size, tiles: d.tiles.slice(), wallHp: d.wallHp.slice(), gold: d.gold.slice(), stairs: d.stairs };
  return {
    code: d.code,
    map,
    pos: d.stairs,
    hp: RULES.startHp,
    maxHp: RULES.startHp,
    attack: RULES.startAttack,
    potions: RULES.startPotions,
    torches: RULES.startTorches,
    torchLeft: 0,
    gold: 0,
    timeLeft: RULES.timeLimit,
    turn: 0,
    monsters: d.monsters.map((m) => ({ ...m })),
    stairsDist: walkingDistances(map, map.stairs),
    ended: null,
  };
}

export const torchLit = (s: RaidState): boolean => s.torchLeft > 0;

/** The tile a bump in direction `dir` goes to (always on the map: bedrock rings it). */
export function bumpTarget(s: RaidState, dir: number): number {
  const { size } = s.map;
  return (Math.floor(s.pos / size) + DY[dir]) * size + (s.pos % size) + DX[dir];
}

const packFull = (s: RaidState, t: Tile): boolean =>
  (t === POTION && s.potions >= RULES.packMax) || (t === TORCH && s.torches >= RULES.packMax);

/**
 * For "Block impossible actions": which actions would do something. Blocked: picking up where there is nothing
 * to take or the pack is full, drinking with no potions, lighting with no torch or one burning, leaving off the
 * stairs, bumping bedrock. Bumping a stone wall is digging, and drinking at full HP still drinks: both allowed.
 * Wait is never blocked.
 */
export function allowedActions(s: RaidState): boolean[] {
  const here = s.map.tiles[s.pos];
  const out: boolean[] = [];
  for (let dir = 0; dir < 4; dir++) out.push(s.map.tiles[bumpTarget(s, dir)] !== BEDROCK);
  out.push(isItem(here) && !packFull(s, here));
  out.push(s.potions > 0);
  out.push(s.torches > 0 && !torchLit(s));
  out.push(here === STAIRS);
  out.push(true); // Wait always does what it says
  return out;
}

/**
 * Where a beaten monster's gold goes: onto its own tile if that is bare floor or gold, else onto the nearest bare
 * floor tile, searched breadth-first over open tiles with neighbours in the order up, right, down, left.
 * -1 if there is none (never, in a generated dungeon).
 */
export function dropSpot(map: RaidMap, from: number): number {
  const seen = new Set([from]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (map.tiles[i] === FLOOR || (i === from && map.tiles[i] === GOLD)) return i;
    for (const n of sideNeighbours(map.size, i)) {
      if (!seen.has(n) && isOpen(map.tiles[n])) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return -1;
}

function dropGold(map: RaidMap, at: number, amount: number): number {
  const i = dropSpot(map, at);
  if (i < 0) return -1;
  map.tiles[i] = GOLD;
  map.gold[i] += amount;
  return i;
}

/** Options for one step. */
export interface StepOptions {
  /** The pickaxe dwarf's own pickaxe: every wall falls in one blow (his lessons are played with it; he never is). */
  pickaxe?: boolean;
}

/**
 * He takes one action and the dungeon answers. Changes `s` in place. `monsterRng` is the `code|n|monsters` stream.
 */
export function step(s: RaidState, action: Action, monsterRng: Rng, opts: StepOptions = {}): StepResult {
  if (s.ended) throw new Error(`The trip has already ended (${s.ended})`);
  const r: StepResult = {
    action, did: 'nothing', goldGained: 0, dugThrough: false, trapDamage: 0, hits: [], monstersTrapped: [], torchOut: false, ended: null,
  };
  const { map } = s;
  const wasLit = torchLit(s);
  let steppedOn: Tile | null = null;
  s.turn++;

  // 1. He acts.
  if (action <= LEFT) {
    const to = bumpTarget(s, action);
    const target = s.monsters.find((m) => m.pos === to);
    if (target) {
      r.did = 'attack';
      target.hp = Math.max(0, target.hp - s.attack);
      r.struck = { ...target };
      if (target.hp === 0) {
        s.monsters.splice(s.monsters.indexOf(target), 1);
        const amount = monsterGold(target);
        r.beaten = { monster: { ...target }, gold: amount, at: dropGold(map, to, amount) };
      }
    } else if (map.tiles[to] === WALL) {
      r.did = 'dig';
      map.wallHp[to] = opts.pickaxe ? 0 : Math.max(0, map.wallHp[to] - s.attack);
      if (map.wallHp[to] === 0) {
        map.tiles[to] = FLOOR;
        r.dugThrough = true;
        s.stairsDist = walkingDistances(map, map.stairs);
      }
    } else if (map.tiles[to] !== BEDROCK) {
      r.did = 'walk';
      s.pos = to;
      steppedOn = map.tiles[to];
    }
  } else if (action === PICK_UP) {
    const here = map.tiles[s.pos];
    if (isItem(here) && !packFull(s, here)) {
      r.did = 'pickUp';
      r.picked = here;
      if (here === GOLD) {
        r.goldGained = map.gold[s.pos];
        s.gold += map.gold[s.pos];
        map.gold[s.pos] = 0;
      } else if (here === POTION) s.potions++;
      else if (here === TORCH) s.torches++;
      else if (here === STRENGTH) s.attack++;
      else if (here === VIGOUR) {
        s.maxHp += RULES.vigourHp;
        s.hp = s.maxHp;
      }
      map.tiles[s.pos] = FLOOR;
    }
  } else if (action === DRINK) {
    if (s.potions > 0) {
      r.did = 'drink';
      s.potions--;
      s.hp = Math.min(s.maxHp, s.hp + RULES.potionHeal);
    }
  } else if (action === LIGHT_TORCH) {
    if (s.torches > 0 && !wasLit) {
      r.did = 'light';
      s.torches--;
      s.torchLeft = RULES.torchTurns;
    }
  } else if (action === LEAVE) {
    if (map.tiles[s.pos] === STAIRS) {
      r.did = 'leave';
      s.ended = r.ended = 'left';
      return r;
    }
  } else if (action === WAIT) {
    r.did = 'wait';
  }

  // 2. Traps.
  if (steppedOn === TRAP) {
    r.trapDamage = RULES.trapDamage;
    s.hp = Math.max(0, s.hp - RULES.trapDamage);
  }

  // 3. The torch burns down a turn; time goes down a turn.
  if (s.torchLeft > 0) {
    s.torchLeft--;
    r.torchOut = s.torchLeft === 0;
  }
  s.timeLeft--;

  // 4. The monsters act.
  const acted = monstersAct(s, monsterRng);
  r.hits = acted.hits;
  r.monstersTrapped = acted.trapped;

  // 5. The end of the trip?
  if (s.hp <= 0) s.ended = 'knockedOut';
  else if (s.timeLeft <= 0) s.ended = 'lockedIn';
  r.ended = s.ended;
  return r;
}

/** Gold he keeps: all of it if he left, none otherwise. */
export const goldOut = (s: RaidState): number => (s.ended === 'left' ? s.gold : 0);

/** His 5 × 5 view now. */
export const view = (s: RaidState): ViewCell[] =>
  viewOf({ ...s.map, monsters: s.monsters, pos: s.pos, lit: torchLit(s) });
