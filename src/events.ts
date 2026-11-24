/**
 * Hidden dungeon events: a bat colony, an old skeleton with a joke, a dripping echo… He cannot see them and no judge
 * scores them, so they never change what the model learns. A few change his stats (a bat snatches a coin): the model
 * sees the result in its pinned tokens, never the cause. Walking onto a spot sets it off (`step`), or seeing it come
 * into his view (`hear`); each spot happens once a raid. The cast and all wording live in `data/events.json`; this
 * module types it, places the spots in a dungeon from their own seeded streams, and follows a raid to say which
 * events happened. No DOM.
 *
 * Randomness: the spots come from `code|events` (fixed) or `code|events|n` (new every raid), their kinds from the
 * same label plus `|kinds`, and chances and versions from `code|n|story`. None of these is the dungeon's, the
 * actions' or the monsters' stream, so events on or off never change what is drawn from those.
 */
import data from './data/events.json';
import { depths, roomTiles, sideNeighbours, walkingDistances, type Dungeon } from './dungeon';
import { rngFrom, shuffle, type Rng } from './rng';
import { seenTiles, squareDistance } from './sight';
import { FLOOR, MONSTER_STATS, TRAP, isOpen, type MonsterKind } from './tiles';
import { RULES, torchLit, type RaidState } from './world';

/** Places the code knows; a kind's `fits` must be one of them. */
export const PLACES = ['anywhere', 'room', 'corridor', 'deadEnd', 'nearStairs', 'nearGuard', 'nearTrap', 'deep'] as const;
export type Place = typeof PLACES[number];
export const TRIGGERS = ['step', 'hear'] as const;
export type Trigger = typeof TRIGGERS[number];

/** The five effects an event can have on his stats. */
export const EFFECTS = ['takeGold', 'giveGold', 'giveTorch', 'heal', 'drainTorch'] as const;
export type Effect = typeof EFFECTS[number];
/** The effects that can find nothing to change (no gold, a full pack, full HP, no torch burning): they need quiet versions. */
export const QUIET_EFFECTS: readonly Effect[] = ['takeGold', 'giveTorch', 'heal', 'drainTorch'];
/** How much each effect changes *(tune)*. */
export const EFFECT_SIZE: Record<Effect, number> = { takeGold: 1, giveGold: 3, giveTorch: 1, heal: 3, drainTorch: 5 };

export interface EventKind {
  /** The kind number: permanent, never reused ("Show events" draws it). */
  id: number;
  name: string;
  fits: Place;
  /** `step`: when he steps onto the spot; `hear`: when the spot comes into his view. */
  trigger: Trigger;
  /** The chance (above 0, at most 1) that it really happens when he reaches the spot; missing means always. */
  chance?: number;
  /** Saga sentences, one per way it can turn out. */
  versions: string[];
  /** His thought lines when it happens. */
  thoughts: string[];
  /** The short pop-up word over him. */
  popup: string;
  /** What it does to his stats (`step` events only); none for most kinds. */
  effect?: Effect;
  /** What the effect did, without the story ("a bat snatched a coin"); needed with an effect. */
  deed?: string;
  /** Saga sentences for when its effect finds nothing to change. */
  quiet?: string[];
  /** Thought lines for when its effect finds nothing to change; missing: `thoughts`. */
  quietThoughts?: string[];
}

type Lines = string[];
type ByMonster = Record<MonsterKind, Lines>;

/** His thought lines (see `thoughts.ts`): `{a}`/`{A}` is the action word, `{dir}` where something is. */
export interface ThoughtLines {
  sure: Lines; likely: Lines; unsure: Lines;
  hit: ByMonster; trap: Lines; beaten: ByMonster; monster: ByMonster; gold: Lines; heap: Lines;
  picked: Record<'gold' | 'potion' | 'torch' | 'strength' | 'vigour', Lines>;
  dug: Lines; light: Lines; torchOut: Lines; drink: Lines; lowHp: Lines; lateTime: Lines;
  wasted: Record<'pickUp' | 'drink' | 'light' | 'leave' | 'bump', Lines>;
  endings: Record<'left' | 'leftNoGold' | 'knockedOut' | 'lockedIn', Lines>;
}

/** The skald's lines (see `saga.ts`). */
export interface SagaLines {
  openings: Lines;
  beatenOne: Lines; beatenMany: Lines; hits: Lines; trap: Lines; picked: Lines; digOne: Lines; digMany: Lines;
  potions: Lines; potionOne: Lines; torch: Lines; strength: Lines; vigour: Lines;
  endings: Record<'left' | 'leftNoGold' | 'knockedOut' | 'lockedIn', Lines>;
  boasts: Record<'beaten' | 'hits' | 'trap' | 'dig', Lines>;
  big: Lines;
  fantasy: Lines;
}

export interface EventData { events: EventKind[]; thoughts: ThoughtLines; saga: SagaLines }

export const DATA = data as EventData;
export const CAST: readonly EventKind[] = DATA.events;

/** The longest a pop-up word may be. */
export const MAX_POPUP = 16;
/** Made-up saga sentences must never mention gold: the gold carried out is always true. */
export const GOLD_WORDS = /gold|coin/i;

/** Problems in the data file (empty when it is fine); the tests run this. */
export function checkEventData(d: EventData): string[] {
  const errors: string[] = [];
  const ids = new Set<number>();
  const text = (s: unknown, where: string) => { if (typeof s !== 'string' || !s.trim()) errors.push(`${where}: empty text`); };
  const list = (l: unknown, where: string, min = 1) => {
    if (!Array.isArray(l) || l.length < min) errors.push(`${where}: needs at least ${min} line${min > 1 ? 's' : ''}`);
    else l.forEach((s) => text(s, where));
  };
  for (const k of d.events) {
    const w = `event ${k.id} (${k.name})`;
    if (!Number.isInteger(k.id) || k.id < 1) errors.push(`${w}: id must be a whole number from 1`);
    if (ids.has(k.id)) errors.push(`${w}: id used twice`);
    ids.add(k.id);
    text(k.name, w);
    if (!PLACES.includes(k.fits)) errors.push(`${w}: unknown place "${k.fits}"`);
    if (!TRIGGERS.includes(k.trigger)) errors.push(`${w}: unknown trigger "${k.trigger}"`);
    if (k.chance !== undefined && !(k.chance > 0 && k.chance <= 1)) errors.push(`${w}: chance must be above 0 and at most 1`);
    list(k.versions, `${w} versions`, 2);
    list(k.thoughts, `${w} thoughts`);
    text(k.popup, `${w} popup`);
    if (typeof k.popup === 'string' && k.popup.length > MAX_POPUP) errors.push(`${w}: pop-up longer than ${MAX_POPUP} characters`);
    if (k.effect !== undefined) {
      if (!EFFECTS.includes(k.effect)) errors.push(`${w}: unknown effect "${k.effect}"`);
      if (k.trigger !== 'step') errors.push(`${w}: an effect needs the step trigger`);
      if (QUIET_EFFECTS.includes(k.effect) && !k.quiet?.length) errors.push(`${w}: ${k.effect} needs at least 1 quiet version`);
      text(k.deed, `${w} deed`);
    } else {
      if (k.deed !== undefined) errors.push(`${w}: a deed only goes with an effect`);
      // Events without an effect can be borrowed into the saga as made-up parts, which never mention gold.
      if (k.versions?.some((s) => GOLD_WORDS.test(s))) errors.push(`${w}: an event without an effect must not mention gold or coins`);
    }
    if (k.quiet !== undefined) {
      if (!k.effect || !QUIET_EFFECTS.includes(k.effect)) errors.push(`${w}: quiet versions only for ${QUIET_EFFECTS.join(', ')}`);
      list(k.quiet, `${w} quiet`);
    }
    if (k.quietThoughts !== undefined) {
      if (k.quiet === undefined) errors.push(`${w}: quiet thoughts only with quiet versions`);
      list(k.quietThoughts, `${w} quietThoughts`);
    }
  }
  const t = d.thoughts;
  const groups = (o: unknown, name: string) => {
    if (!o || typeof o !== 'object') errors.push(`${name}: missing`);
    else for (const [k, v] of Object.entries(o)) list(v, `${name}.${k}`);
  };
  for (const k of ['sure', 'likely', 'unsure', 'trap', 'gold', 'heap', 'dug', 'light', 'torchOut', 'drink', 'lowHp', 'lateTime'] as const) list(t?.[k], `thoughts.${k}`);
  for (const k of ['hit', 'beaten', 'monster', 'picked', 'wasted', 'endings'] as const) groups(t?.[k], `thoughts.${k}`);
  for (const k of ['hit', 'beaten', 'monster'] as const) {
    for (const m of Object.keys(MONSTER_STATS)) if (!t?.[k]?.[m as keyof ByMonster]) errors.push(`thoughts.${k}.${m}: missing`);
  }
  const s = d.saga;
  for (const k of ['openings', 'beatenOne', 'beatenMany', 'hits', 'trap', 'picked', 'digOne', 'digMany', 'potions', 'potionOne', 'torch', 'strength', 'vigour', 'big', 'fantasy'] as const) {
    list(s?.[k], `saga.${k}`);
  }
  groups(s?.endings, 'saga.endings');
  groups(s?.boasts, 'saga.boasts');
  for (const k of ['left', 'leftNoGold', 'knockedOut', 'lockedIn'] as const) {
    if (!t?.endings?.[k]) errors.push(`thoughts.endings.${k}: missing`);
    if (!s?.endings?.[k]) errors.push(`saga.endings.${k}: missing`);
  }
  for (const k of ['beaten', 'hits', 'trap', 'dig'] as const) if (!s?.boasts?.[k]) errors.push(`saga.boasts.${k}: missing`);
  for (const line of [...(s?.fantasy ?? []), ...Object.values(s?.boasts ?? {}).flat()]) {
    if (GOLD_WORDS.test(line)) errors.push(`saga: made-up line mentions gold or coins: "${line}"`);
  }
  for (const line of s?.endings?.left ?? []) if (!line.includes('{gold}')) errors.push(`saga.endings.left: "${line}" must say {gold}`);
  return errors;
}

// ── Places ──────────────────────────────────────────────────────────────────

/** Place sizes *(tune)*: within this many steps of the stairs, within this square of a slime or troll, and the deepest share. */
export const NEAR_STAIRS = 4;
export const NEAR_GUARD = 2;
/** `deep`: at least this share of the dungeon's greatest depth. */
export const DEEP_FROM = 0.7;
/** `deadEnd`: a corridor tile within this many steps of a tile with one way out. */
export const DEAD_END_REACH = 2;

/** A test for each place, worked out once for a dungeon. */
export function placeTests(d: Dungeon): (place: Place, i: number) => boolean {
  const depth = depths(d);
  const maxDepth = Math.max(...depth);
  const inRoom = new Set(d.rooms.flatMap((r) => roomTiles(d.size, r)));
  const waysOut = (i: number) => sideNeighbours(d.size, i).filter((n) => isOpen(d.tiles[n])).length;
  const tips = d.tiles.flatMap((t, i) => (isOpen(t) && !inRoom.has(i) && waysOut(i) === 1 ? [i] : []));
  const nearTip = new Set<number>();
  for (const tip of tips) {
    walkingDistances(d, tip).forEach((s, i) => { if (s >= 0 && s <= DEAD_END_REACH && !inRoom.has(i)) nearTip.add(i); });
  }
  const guards = d.monsters.filter((m) => !MONSTER_STATS[m.kind].mobile).map((m) => m.pos);
  const traps = d.tiles.flatMap((t, i) => (t === TRAP ? [i] : []));
  return (place, i) => {
    switch (place) {
      case 'anywhere': return true;
      case 'room': return inRoom.has(i);
      case 'corridor': return isOpen(d.tiles[i]) && !inRoom.has(i);
      case 'deadEnd': return nearTip.has(i);
      case 'nearStairs': return depth[i] >= 0 && depth[i] <= NEAR_STAIRS;
      case 'nearGuard': return guards.some((g) => squareDistance(d.size, g, i) <= NEAR_GUARD);
      case 'nearTrap': return traps.some((t) => squareDistance(d.size, t, i) <= 1);
      case 'deep': return depth[i] >= DEEP_FROM * maxDepth;
    }
  };
}

// ── Placement ───────────────────────────────────────────────────────────────

/** Event spots per dungeon *(tune)*. */
export const SPOT_COUNT = 12;
/** No spot within another's 5 × 5. */
export const SPOT_APART = 2;

export interface EventSpot { i: number; kind: number }

/** The seed label of a placement: fixed per dungeon code, or new every raid. */
export const spotsLabel = (code: string, n?: number): string => (n === undefined ? `${code}|events` : `${code}|events|${n}`);

/**
 * Where the spots go: shuffled bare floor tiles (never the stairs, a trap, an item or a monster's starting tile),
 * taken one by one while none is within another's 5 × 5. Its own stream, so the dungeon never changes.
 */
export function spotTiles(d: Dungeon, label: string, count = SPOT_COUNT): number[] {
  const rng = rngFrom(label);
  const taken = new Set(d.monsters.map((m) => m.pos));
  const candidates = shuffle(rng, d.tiles.flatMap((t, i) => (t === FLOOR && !taken.has(i) ? [i] : [])));
  const spots: number[] = [];
  for (const i of candidates) {
    if (spots.length >= count) break;
    if (spots.some((j) => squareDistance(d.size, i, j) <= SPOT_APART)) continue;
    spots.push(i);
  }
  return spots;
}

/**
 * The events of a dungeon: the spots first, then each spot gets a kind that fits its place and is not used yet,
 * from a second stream (a kind with its own place first, so "anywhere" kinds do not take the rarer spots). Adding
 * kinds to the cast never moves the spots. A spot where no unused kind fits stays empty.
 */
export function placeEvents(d: Dungeon, label: string, cast: readonly EventKind[] = CAST, count = SPOT_COUNT): EventSpot[] {
  const rng = rngFrom(`${label}|kinds`);
  const fits = placeTests(d);
  const used = new Set<number>();
  const out: EventSpot[] = [];
  for (const i of spotTiles(d, label, count)) {
    const fitting = cast.filter((k) => !used.has(k.id) && fits(k.fits, i));
    const special = fitting.filter((k) => k.fits !== 'anywhere');
    const options = special.length ? special : fitting;
    const r = rng(); // one draw per spot, so one spot's kind never shifts the next
    if (!options.length) continue;
    const k = options[Math.floor(r * options.length)];
    used.add(k.id);
    out.push({ i, kind: k.id });
  }
  return out;
}

// ── Effects ─────────────────────────────────────────────────────────────────

/**
 * An effect on his stats: −1 gold, +3 gold, +1 torch (if his pack has room), +3 HP (up to max), or 5 turns off a
 * lit torch (it may go out). Returns the change to his gold, or null when there was nothing to change.
 */
export function applyEffect(s: RaidState, e: Effect): { gold: number } | null {
  const n = EFFECT_SIZE[e];
  switch (e) {
    case 'takeGold': {
      if (s.gold <= 0) return null;
      const lost = Math.min(n, s.gold);
      s.gold -= lost;
      return { gold: -lost };
    }
    case 'giveGold':
      s.gold += n;
      return { gold: n };
    case 'giveTorch':
      if (s.torches >= RULES.packMax) return null;
      s.torches = Math.min(RULES.packMax, s.torches + n);
      return { gold: 0 };
    case 'heal':
      if (s.hp >= s.maxHp) return null;
      s.hp = Math.min(s.maxHp, s.hp + n);
      return { gold: 0 };
    case 'drainTorch':
      if (!torchLit(s)) return null;
      s.torchLeft = Math.max(0, s.torchLeft - n);
      return { gold: 0 };
  }
}

// ── On a raid ───────────────────────────────────────────────────────────────

/**
 * An event he met, after action number `turn` (1 = his first). `version` indexes the kind's `versions`, or its
 * `quiet` ones when its effect found nothing to change; `effect` is set when it changed his stats, `gold` by how much
 * his gold changed.
 */
export interface EventMet { spot: number; kind: number; turn: number; version: number; quiet?: boolean; effect?: Effect; gold?: number }

/** What the events of a raid need to know: where they are and which kinds there are. */
export interface EventSetup { spots: EventSpot[]; cast: readonly EventKind[] }

/**
 * Follows a raid and says which events just happened. Call `after(state)` after every `step`. Whether a chance
 * comes off and which version is told come from the story stream given, never the raid's own. An effect changes
 * the state at once, so the model's next input shows the result.
 */
export class EventTracker {
  readonly met: EventMet[] = [];
  private readonly done = new Set<number>();
  private readonly kinds: Map<number, EventKind>;
  private pos: number;
  private seen: Set<number>;

  constructor(readonly setup: EventSetup, private readonly rng: Rng, start: RaidState) {
    this.kinds = new Map(setup.cast.map((k) => [k.id, k]));
    this.pos = start.pos;
    this.seen = seenSet(start);
  }

  kind(id: number): EventKind | undefined {
    return this.kinds.get(id);
  }

  after(s: RaidState): EventMet[] {
    const fresh: EventMet[] = [];
    const seen = seenSet(s);
    if (!s.ended) {
      for (const spot of this.setup.spots) {
        if (this.done.has(spot.i)) continue;
        const k = this.kinds.get(spot.kind);
        if (!k) continue;
        const off = k.trigger === 'step'
          ? s.pos === spot.i && this.pos !== spot.i
          : seen.has(spot.i) && !this.seen.has(spot.i);
        if (!off) continue;
        this.done.add(spot.i);
        // Some events only happen sometimes: one roll when he reaches the spot, once a raid.
        if (k.chance !== undefined && k.chance < 1 && this.rng() >= k.chance) continue;
        const r = this.rng();
        const e: EventMet = { spot: spot.i, kind: k.id, turn: s.turn, version: Math.floor(r * k.versions.length) };
        if (k.effect) {
          const changed = applyEffect(s, k.effect);
          if (changed) {
            e.effect = k.effect;
            if (changed.gold) e.gold = changed.gold;
          } else if (k.quiet?.length) {
            e.quiet = true;
            e.version = Math.floor(r * k.quiet.length);
          }
        }
        this.met.push(e);
        fresh.push(e);
      }
    }
    this.pos = s.pos;
    this.seen = seen;
    return fresh;
  }
}

const seenSet = (s: RaidState): Set<number> => new Set(seenTiles({ ...s.map, pos: s.pos, lit: torchLit(s) }));

/** The saga sentence of an event he met, as it turned out. */
export function metText(e: EventMet, cast: readonly EventKind[] = CAST): string {
  const k = cast.find((c) => c.id === e.kind);
  if (!k) return '';
  const list = e.quiet && k.quiet?.length ? k.quiet : k.versions;
  return list[e.version] ?? list[0];
}

/** His thought lines for an event he met. */
export function metThoughts(e: EventMet, cast: readonly EventKind[] = CAST): readonly string[] {
  const k = cast.find((c) => c.id === e.kind);
  if (!k) return [];
  return e.quiet && k.quietThoughts?.length ? k.quietThoughts : k.thoughts;
}
