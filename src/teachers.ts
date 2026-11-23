/**
 * The teachers: six hand-written ways to play the barbarian, for his lessons (imitation). Each teacher sees only
 * what he could see (the cells of his view that are not dark) and remembers every tile it has seen on this trip.
 * A shared planner finds the cheapest way over those tiles, counting turns for walking, digging and fighting and HP
 * for hits; the teachers are rule sets on top of it. They re-plan every turn, because monsters move.
 *
 * A teacher has no randomness of its own: ties are broken in fixed orders (directions up, right, down, left; tiles
 * by index), so the same raid gives the same actions. No DOM.
 */
import { sideNeighbours } from './dungeon';
import { chaseDistances } from './monsters';
import { rngFrom } from './rng';
import { lineClear, seenTiles, squareDistance } from './sight';
import {
  BEDROCK, CRACKED_HP, FLOOR, GOLD, MONSTER_STATS, POTION, STAIRS, STRENGTH, TORCH, TRAP, VIGOUR, WALL, isOpen,
  monsterGold, type Monster, type MonsterKind, type Tile,
} from './tiles';
import {
  DRINK, LEAVE, LIGHT_TORCH, PICK_UP, RULES, WAIT, newRaid, step, torchLit,
  type Action, type RaidState, type StepResult,
} from './world';
import type { Dungeon } from './dungeon';

// ── What a teacher knows ────────────────────────────────────────────────────

/** A monster as the teacher last saw it. */
export interface KnownMonster { kind: MonsterKind; pos: number; hp: number; rich: boolean; seenAt: number }

/** A mobile monster out of sight is remembered where it was last seen for this many turns, then forgotten. */
export const MOBILE_MEMORY = 4;

/** The tiles a teacher has seen this trip, as they were when last seen, and the monsters it remembers. */
export interface Knowledge {
  size: number;
  seen: Uint8Array;
  tiles: Tile[];
  wallHp: number[];
  gold: number[];
  monsters: KnownMonster[];
  stairs: number;
}

export function newKnowledge(s: RaidState): Knowledge {
  const n = s.map.tiles.length;
  return {
    size: s.map.size,
    seen: new Uint8Array(n),
    tiles: new Array<Tile>(n).fill(BEDROCK),
    wallHp: new Array<number>(n).fill(0),
    gold: new Array<number>(n).fill(0),
    monsters: [],
    stairs: s.map.stairs,
  };
}

/**
 * Adds what he sees now. A tile under a monster keeps what was known of it (the monster hides it), or counts as
 * floor if it was never seen. Monsters in sight replace what was remembered there; an immobile one is remembered
 * until its tile is seen empty, a mobile one for `MOBILE_MEMORY` turns out of sight, or until one of the same kind
 * is seen close enough to be it.
 */
export function observe(k: Knowledge, s: RaidState): number[] {
  const now = seenTiles({ ...s.map, pos: s.pos, lit: torchLit(s) });
  const inSight = new Set(now);
  const visible: KnownMonster[] = [];
  for (const i of now) {
    const m = s.monsters.find((q) => q.pos === i);
    if (m) {
      visible.push({ kind: m.kind, pos: i, hp: m.hp, rich: m.rich, seenAt: s.turn });
      if (!k.seen[i]) k.tiles[i] = FLOOR;
    } else {
      k.tiles[i] = s.map.tiles[i];
      k.wallHp[i] = s.map.wallHp[i];
      k.gold[i] = s.map.gold[i];
    }
    k.seen[i] = 1;
  }
  const size = k.size;
  const manhattan = (a: number, b: number) =>
    Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size));
  const kept = k.monsters.filter((m) => {
    if (inSight.has(m.pos)) return false;
    if (!MONSTER_STATS[m.kind].mobile) return true;
    const age = s.turn - m.seenAt;
    if (age > MOBILE_MEMORY) return false;
    return !visible.some((v) => v.kind === m.kind && manhattan(v.pos, m.pos) <= age + 1);
  });
  k.monsters = [...kept, ...visible];
  return now;
}

const knownMonsterAt = (k: Knowledge, i: number): KnownMonster | undefined => k.monsters.find((m) => m.pos === i);

// ── The planner ─────────────────────────────────────────────────────────────

/** How a teacher treats walls: never digs, digs at his real attack, or as if every wall falls in one blow. */
export type DigRule = 'never' | 'real' | 'pickaxe';

export interface PlanOptions {
  attack: number;
  dig: DigRule;
  /** Whether he may fight this monster on the way; if not, its tile is closed. */
  mayFight: (m: KnownMonster) => boolean;
  /** How many turns one HP of damage is worth. */
  hpWeight: number;
  /** A tile where he would take this much damage or more in one turn is closed (it would knock him out). */
  damageLimit?: number;
  /** Monsters and their hits are ignored, traps are not (for the way back). */
  turnsOnly?: boolean;
}

/** Blows to beat a monster, or to break a wall, at this attack. */
export const blows = (hp: number, attack: number): number => Math.ceil(hp / attack);

/**
 * Damage he takes beating a monster: it hits after each of his blows but the last, plus once more if he has to
 * step next to it first (it does not strike first when it comes to him).
 */
export function fightDamage(m: Pick<KnownMonster, 'kind' | 'hp'>, attack: number, approach: boolean): number {
  return MONSTER_STATS[m.kind].attack * (blows(m.hp, attack) - 1 + (approach ? 1 : 0));
}

/** Turns and damage to enter tile `i`, or null where the planner may not go. */
export function enterCost(k: Knowledge, i: number, o: PlanOptions): { turns: number; damage: number } | null {
  if (!k.seen[i]) return null;
  const t = k.tiles[i];
  if (t === BEDROCK) return null;
  let turns = 1;
  let damage = t === TRAP ? RULES.trapDamage : 0;
  if (t === WALL) {
    if (o.dig === 'never') return null;
    turns += o.dig === 'pickaxe' ? 1 : blows(k.wallHp[i], o.attack);
  }
  if (o.turnsOnly) return { turns, damage };
  const m = knownMonsterAt(k, i);
  if (m) {
    if (!o.mayFight(m)) return null;
    turns += blows(m.hp, o.attack);
    damage += fightDamage(m, o.attack, false);
  }
  // Every monster next to the tile hits him while he stands there (the approach hit, for one he will fight). The
  // plan does not remember fights on the way, so a monster beaten earlier on a path still counts beyond it: a
  // little careful, never reckless.
  for (const q of k.monsters) {
    if (q !== m && sideNeighbours(k.size, i).includes(q.pos)) damage += MONSTER_STATS[q.kind].attack;
  }
  if (o.damageLimit !== undefined && damage - (m ? fightDamage(m, o.attack, false) : 0) >= o.damageLimit) return null;
  return { turns, damage };
}

/** The cheapest ways from one tile to every known tile. `cost` is turns + hpWeight × damage; -1 where unreachable. */
export interface Plan { from: number; cost: Float64Array; turns: Int32Array; damage: Int32Array; prev: Int32Array }

/**
 * Dijkstra over the known tiles from `from`. The cost of a step is the cost of entering its tile (`enterCost`).
 * Ties go to the tile found first, neighbours in the order up, right, down, left, so the plan is deterministic.
 */
export function plan(k: Knowledge, from: number, o: PlanOptions): Plan {
  const n = k.tiles.length;
  const cost = new Float64Array(n).fill(-1);
  const turns = new Int32Array(n).fill(-1);
  const damage = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  cost[from] = 0;
  turns[from] = 0;
  damage[from] = 0;
  const heap = new MinHeap();
  heap.push(0, from);
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    for (const j of sideNeighbours(k.size, i)) {
      if (done[j]) continue;
      const c = enterCost(k, j, o);
      if (!c) continue;
      const nc = cost[i] + c.turns + o.hpWeight * c.damage;
      if (cost[j] < 0 || nc < cost[j] - 1e-9) {
        cost[j] = nc;
        turns[j] = turns[i] + c.turns;
        damage[j] = damage[i] + c.damage;
        prev[j] = i;
        heap.push(nc, j);
      }
    }
  }
  return { from, cost, turns, damage, prev };
}

/** The first tile on the plan's way to `to` (`to` itself if next to the start), or -1 if there is no way. */
export function firstStep(p: Plan, to: number): number {
  if (to === p.from || p.cost[to] < 0) return -1;
  let i = to;
  while (p.prev[i] !== p.from) i = p.prev[i];
  return i;
}

/** A small binary heap of tiles by cost; equal costs come out in the order they went in. */
class MinHeap {
  private items: [number, number, number][] = [];
  private count = 0;
  get size() { return this.items.length; }
  push(cost: number, tile: number) {
    const a = this.items;
    a.push([cost, this.count++, tile]);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!less(a[c], a[p])) break;
      [a[c], a[p]] = [a[p], a[c]];
      c = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let m = p;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === p) break;
        [a[m], a[p]] = [a[p], a[m]];
        p = m;
      }
    }
    return top[2];
  }
}
const less = (x: [number, number, number], y: [number, number, number]) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);

/**
 * The way back to the stairs from every known tile: the turns to walk (and, if he digs, dig) it, and the spike-trap
 * damage on it (monsters ignored: they move). Found from the stairs outwards; -1 where there is no known way.
 */
export function wayBack(k: Knowledge, attack: number, dig: DigRule): { turns: Int32Array; damage: Int32Array } {
  // Fewest turns first, then fewest traps: one HP is worth a hundredth of a turn.
  const p = plan(k, k.stairs, { attack, dig, mayFight: () => true, hpWeight: 0.01, turnsOnly: true });
  return { turns: p.turns, damage: p.damage };
}

// ── The teachers ────────────────────────────────────────────────────────────

export const TEACHERS = ['warrior', 'healer', 'thief', 'dwarf', 'pickaxe', 'goblin'] as const;
export type TeacherName = typeof TEACHERS[number];
export const TEACHER_LABELS: Record<TeacherName, string> = {
  warrior: 'Old warrior', healer: 'Healer', thief: 'Thief', dwarf: 'Dwarf', pickaxe: 'Dwarf with his own pickaxe',
  goblin: 'Goblin in disguise',
};

/** A teacher's rules *(tune)*. */
export interface TeacherRules {
  /** How many turns one HP of damage is worth to him when planning. */
  hpWeight: number;
  dig: DigRule;
  /**
   * Fights a monster only if beating it leaves at least this much HP: a share of max HP. `null`: fights anything
   * he could beat with his potions too (the warrior).
   */
  fightSpare: number | null;
  /**
   * Never goes to a fight: monster tiles are closed to him, gold near a slime or troll (or with a monster on or
   * next to it) is not worth it. He still strikes back at a mobile monster next to him that he can beat.
   */
  avoidMonsters: boolean;
  /** Monsters' gold counts as gold to go for. */
  huntMonsters: boolean;
  /** `nextHit`: drinks only when the hits coming this turn would knock him out. `belowHalf`: below half HP. */
  drink: 'nextHit' | 'belowHalf';
  /** Lights a torch when it would show at least this many tiles he has not seen. */
  torchReveal: number;
  /** ... and only if he would still have this many torches left after lighting it. */
  torchKeep: number;
  /** Turns to spare when heading back to the stairs. */
  timeMargin: number;
  /** Heads home with no potions left and HP at or below this share of max HP (null: never). */
  homeHp: number | null;
  /** Waits for a monster at two steps to come to him, so he strikes first. */
  waits: boolean;
  /** The goblin in disguise: walks into any troll in sight. */
  trollBait: boolean;
}

const HEALER: TeacherRules = {
  hpWeight: 2, dig: 'never', fightSpare: 1 / 3, avoidMonsters: false, huntMonsters: false, drink: 'belowHalf',
  torchReveal: 5, torchKeep: 0, timeMargin: 20, homeHp: 1 / 2, waits: true, trollBait: false,
};
const WARRIOR: TeacherRules = {
  hpWeight: 1, dig: 'never', fightSpare: null, avoidMonsters: false, huntMonsters: true, drink: 'nextHit',
  torchReveal: 5, torchKeep: 0, timeMargin: 5, homeHp: 1 / 4, waits: false, trollBait: false,
};
export const TEACHER_RULES: Record<TeacherName, TeacherRules> = {
  warrior: WARRIOR,
  healer: HEALER,
  thief: { ...HEALER, hpWeight: 10, avoidMonsters: true, torchReveal: 2 },
  dwarf: { ...HEALER, dig: 'real' },
  pickaxe: { ...HEALER, dig: 'pickaxe' },
  goblin: { ...WARRIOR, trollBait: true },
};

/** Why a teacher took its action, for tests and the measuring script. */
export type Reason =
  | 'leave' | 'troll' | 'flee' | 'drink' | 'fight' | 'wait' | 'torch' | 'pickUp' | 'target' | 'explore' | 'home' | 'stuck';

export interface Teacher {
  name: TeacherName;
  rules: TeacherRules;
  knowledge: Knowledge;
  /** Heading back to the stairs, for good. */
  goingHome: boolean;
  /** Why the last action was taken. */
  reason: Reason;
  /** The action for the raid now. Call once per turn, before `step`. */
  act(s: RaidState): Action;
}

/** What a tile is worth picking up to him now: gold by its amount, useful items as 3 (a small pile), else 0. */
function itemValue(s: RaidState, t: Tile, gold: number): number {
  if (t === GOLD) return gold;
  if (t === POTION) return s.potions < RULES.packMax ? 3 : 0;
  if (t === TORCH) return s.torches < RULES.packMax ? 3 : 0;
  if (t === STRENGTH || t === VIGOUR) return 3;
  return 0;
}

const dirTo = (size: number, from: number, to: number): Action => {
  const d = to - from;
  return (d === -size ? 0 : d === 1 ? 1 : d === size ? 2 : 3) as Action;
};

export function newTeacher(name: TeacherName, s: RaidState, rules: TeacherRules = TEACHER_RULES[name]): Teacher {
  const k = newKnowledge(s);
  const t: Teacher = {
    name, rules, knowledge: k, goingHome: false, reason: 'explore',
    act(state) {
      const [a, why] = decide(t, state);
      t.reason = why;
      lastWasWait = a === WAIT;
      return a;
    },
  };
  let lastWasWait = false;

  function decide(t: Teacher, s: RaidState): [Action, Reason] {
    const r = t.rules;
    const size = k.size;
    observe(k, s);
    const here = s.map.tiles[s.pos];
    if (t.goingHome && here === STAIRS) return [LEAVE, 'leave'];

    const nextTo = (i: number) => sideNeighbours(size, i);
    // The way back: from a tile he goes to, he must still make it out before the gate closes, and with HP left
    // after the traps on the way (potions counted).
    const back = wayBack(k, s.attack, r.dig === 'pickaxe' ? 'real' : r.dig);
    const enough = (turns: number, at: number) =>
      back.turns[at] >= 0 && turns + back.turns[at] + r.timeMargin < s.timeLeft;
    const survives = (damage: number, at: number) => damage + back.damage[at] < s.hp + s.potions * RULES.potionHeal;
    const adjacent = k.monsters.filter((m) => nextTo(s.pos).includes(m.pos));
    const incoming = adjacent.reduce((sum, m) => sum + MONSTER_STATS[m.kind].attack, 0);
    /** Hits he would take standing on tile `i` while the monsters act (as they stand now). */
    const standing = (i: number) => k.monsters.reduce(
      (sum, m) => sum + (nextTo(i).includes(m.pos) ? MONSTER_STATS[m.kind].attack : 0), 0);
    // The warrior counts his potions and only needs to stay up; the others want HP to spare without them.
    const reserve = r.fightSpare === null ? s.hp + s.potions * RULES.potionHeal : s.hp;
    const afford = (damage: number): boolean => (r.fightSpare === null
      ? damage < reserve
      : damage === 0 || reserve - damage >= r.fightSpare * s.maxHp);
    // A fight he can afford, and still get home past the traps after it.
    const mayFight = (m: KnownMonster, approach = true, at = s.pos): boolean => {
      const damage = fightDamage(m, s.attack, approach);
      return afford(damage) && survives(damage, at);
    };
    // HP weighs more the less of it he has.
    const opts: PlanOptions = {
      attack: s.attack, dig: r.dig, hpWeight: (r.hpWeight * s.maxHp) / s.hp, damageLimit: s.hp,
      mayFight: (m) => !r.avoidMonsters && mayFight(m),
    };
    const stepTo = (p: Plan, to: number): Action | null => {
      const f = firstStep(p, to);
      return f < 0 ? null : dirTo(size, s.pos, f);
    };

    // The goblin in disguise: a troll in sight, and he walks into it.
    if (r.trollBait) {
      const troll = k.monsters.find((m) => m.kind === 'troll' && m.seenAt === s.turn);
      if (troll) {
        const a = stepTo(plan(k, s.pos, { ...opts, hpWeight: 0, mayFight: () => true }), troll.pos);
        if (a !== null) return [a, 'troll'];
      }
    }

    // Next to a slime or troll he will not fight: step to the free tile next to him where the fewest hits land,
    // if it is better than staying. (A mobile one he will not fight is left to the plan: any step away from it
    // means it has to step after him, and then it does not hit that turn.)
    const mobile = (m: KnownMonster) => MONSTER_STATS[m.kind].mobile;
    const isFoe = (m: KnownMonster) => (!r.avoidMonsters || mobile(m)) && mayFight(m, false);
    if (adjacent.some((m) => !mobile(m) && !isFoe(m))) {
      let best = -1;
      let bestHits = incoming;
      for (const n of nextTo(s.pos)) {
        const tn = k.tiles[n];
        if (!k.seen[n] || !isOpen(tn) || knownMonsterAt(k, n)) continue;
        const hits = standing(n) + (tn === TRAP ? RULES.trapDamage : 0);
        if (hits >= s.hp) continue;
        if (hits < bestHits || (hits === bestHits && best >= 0 && back.turns[n] < back.turns[best])) {
          best = n;
          bestHits = hits;
        }
      }
      if (best >= 0 && !adjacent.some(isFoe)) return [dirTo(size, s.pos, best), 'flee'];
      if (best >= 0 && bestHits === 0 && incoming >= s.hp) return [dirTo(size, s.pos, best), 'flee'];
    }

    // Potions.
    if (s.potions > 0) {
      // The next hit: from the monsters next to him, or from one he knows of a step or two away.
      const near = (m: KnownMonster) => {
        const d = Math.abs((m.pos % size) - (s.pos % size)) + Math.abs(Math.floor(m.pos / size) - Math.floor(s.pos / size));
        return d <= 2;
      };
      const nextHit = Math.max(incoming, ...k.monsters.filter(near).map((m) => MONSTER_STATS[m.kind].attack));
      const low = r.drink === 'nextHit' ? nextHit >= s.hp : s.hp * 2 < s.maxHp;
      if (low) return [DRINK, 'drink'];
    }

    // A monster next to him: strike the one he would beat soonest, if he fights it.
    const foes = adjacent.filter(isFoe)
      .sort((a, b) => blows(a.hp, s.attack) - blows(b.hp, s.attack));
    if (foes.length) return [dirTo(size, s.pos, foes[0].pos), 'fight'];

    // A monster two steps away that will come to him: wait, and strike first.
    if (r.waits && !adjacent.length && !lastWasWait) {
      const dist = chaseDistances(s);
      const coming = k.monsters.some((m) => m.seenAt === s.turn && MONSTER_STATS[m.kind].mobile &&
        dist[m.pos] === 2 && mayFight(m, false));
      if (coming) return [WAIT, 'wait'];
    }

    // The torch: light it when it would show enough unseen tiles.
    if (s.torches > r.torchKeep && !torchLit(s)) {
      let reveal = 0;
      for (let i = 0; i < k.tiles.length; i++) {
        if (!k.seen[i] && squareDistance(size, s.pos, i) === 2 && lineClear(s.map, s.pos, i)) reveal++;
      }
      if (reveal >= r.torchReveal) return [LIGHT_TORCH, 'torch'];
    }

    // Something worth taking where he stands, unless a monster would hit him for it.
    const safeHere = incoming === 0 || (!r.avoidMonsters && incoming < s.hp - 1);
    if (itemValue(s, here, s.map.gold[s.pos]) > 0 && safeHere) return [PICK_UP, 'pickUp'];

    // Where to go.
    if (!t.goingHome) {
      if (!enough(0, s.pos)) t.goingHome = true;
      if (r.homeHp !== null && s.potions === 0 && s.hp <= r.homeHp * s.maxHp) t.goingHome = true;
      if (!survives(RULES.trapDamage, s.pos)) t.goingHome = true;
    }
    const p = plan(k, s.pos, opts);
    if (!t.goingHome) {
      // Gold and items he knows of (and, for a greedy teacher, monsters' gold): the nearest he has time for.
      let best = -1;
      let bestValue = 0;
      const consider = (i: number, value: number, extra: number) => {
        if (value <= 0 || p.cost[i] < 0 || !enough(p.turns[i] + extra, i)) return;
        const damage = p.damage[i] + extra * standing(i);
        if (!afford(damage) || !survives(damage + RULES.trapDamage, i)) return;
        if (best < 0 || p.cost[i] < p.cost[best] || (p.cost[i] === p.cost[best] && value > bestValue)) {
          best = i;
          bestValue = value;
        }
      };
      const guarded = (i: number) => k.monsters.some((m) =>
        (mobile(m) ? squareDistance(size, m.pos, i) <= 1 : squareDistance(size, m.pos, i) <= 2));
      for (let i = 0; i < k.tiles.length; i++) {
        if (!k.seen[i] || i === s.pos) continue;
        if (r.avoidMonsters && guarded(i)) continue;
        consider(i, itemValue(s, k.tiles[i], k.gold[i]), 1);
      }
      if (r.huntMonsters) for (const m of k.monsters) consider(m.pos, monsterGold(m as Monster), 1);
      if (best >= 0) {
        const a = stepTo(p, best);
        if (a !== null) return [a, 'target'];
      }
      // Nothing known: explore the nearest tile next to unseen ones (or, for a digger, a cracked wall).
      let frontier = -1;
      for (let i = 0; i < k.tiles.length; i++) {
        if (!k.seen[i] || i === s.pos || p.cost[i] < 0) continue;
        const ti = k.tiles[i];
        const open = isOpen(ti) && ti !== STAIRS;
        const crack = ti === WALL && r.dig !== 'never' && k.wallHp[i] <= CRACKED_HP;
        if (!open && !crack) continue;
        if (!unseenAround(k, i, crack)) continue;
        if (!enough(p.turns[i], i) || !afford(p.damage[i]) || !survives(p.damage[i] + RULES.trapDamage, i)) continue;
        if (frontier < 0 || p.cost[i] < p.cost[frontier]) frontier = i;
      }
      if (frontier >= 0) {
        const a = stepTo(p, frontier);
        if (a !== null) return [a, 'explore'];
      }
      t.goingHome = true;
    }
    if (here === STAIRS) return [LEAVE, 'leave'];
    const home = stepTo(p, k.stairs);
    if (home !== null) return [home, 'home'];
    // No way home he can take without being knocked out: drink if he can, else take the cheapest way anyway.
    if (s.potions > 0 && s.hp < s.maxHp) return [DRINK, 'drink'];
    const anyWay = stepTo(plan(k, s.pos, { ...opts, mayFight: () => true, damageLimit: undefined }), k.stairs);
    if (anyWay !== null) return [anyWay, 'home'];
    return [WAIT, 'stuck'];
  }

  return t;
}

/** Whether a tile has unseen tiles round it: any of its 8 neighbours, or for a wall, its 4 sides. */
function unseenAround(k: Knowledge, i: number, sidesOnly: boolean): boolean {
  const { size } = k;
  const x = i % size;
  const y = Math.floor(i / size);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx === 0 && dy === 0) || (sidesOnly && dx !== 0 && dy !== 0)) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size && !k.seen[ny * size + nx]) return true;
    }
  }
  return false;
}

// ── A teacher's raid ────────────────────────────────────────────────────────

export interface TeacherTurn { action: Action; reason: Reason; result: StepResult }

/**
 * A whole raid played by a teacher, raid number `n` (the monster stream is `code|n|monsters`, as for him). The
 * pickaxe dwarf plays with his own pickaxe (every wall falls in one blow) unless `ownPickaxe` is false: then he
 * plans as if it did, but digs at the barbarian's real attack, which is what copying him does.
 */
export function teacherRaid(
  d: Dungeon, name: TeacherName, n = 0,
  o: { ownPickaxe?: boolean; rules?: TeacherRules; onTurn?: (s: RaidState, t: Teacher, turn: TeacherTurn) => void } = {},
): { state: RaidState; turns: TeacherTurn[] } {
  const s = newRaid(d);
  const t = newTeacher(name, s, o.rules);
  const monsterRng = rngFrom(`${d.code}|${n}|monsters`);
  const pickaxe = t.rules.dig === 'pickaxe' && (o.ownPickaxe ?? true);
  const turns: TeacherTurn[] = [];
  while (!s.ended) {
    const action = t.act(s);
    const turn = { action, reason: t.reason, result: step(s, action, monsterRng, { pickaxe }) };
    turns.push(turn);
    o.onTurn?.(s, t, turn);
  }
  return { state: s, turns };
}
