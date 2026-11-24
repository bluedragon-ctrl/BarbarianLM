/**
 * The tokens: what the model reads. Everything is one-hot, laid out as in the design's context
 *
 *   pinned (43) | [view][action] … oldest to newest (485 each) | view now (475) → next action
 *
 * The pinned stats come in buckets; the view is 25 cells of 19 numbers; each remembered pair is a present flag,
 * a view and the action he took on it. Since every input is 0 or 1, an input is given as the list of the indices
 * that are 1 (`encode`), which is all the model's sparse forward and backward passes need; `dense` turns it into
 * a full vector for tests. No DOM, no randomness.
 */
import { VIEW_KINDS, VIEW_SIZE, type ViewCell } from './sight';
import { ACTIONS, type Action, type RaidState } from './world';

/**
 * Bump when the input or output layout changes (tile kinds, monster flags, pinned tokens, buckets, actions, memory
 * sizes): saved models from an older layout no longer fit.
 */
export const SAVE_VERSION = 3;

// ── Buckets ─────────────────────────────────────────────────────────────────

/** The bucket of `x` given the lowest value of each bucket after the first. */
function bucket(x: number, from: readonly number[]): number {
  let b = 0;
  while (b < from.length && x >= from[b]) b++;
  return b;
}

/** HP: 1–3, 4–6, 7–10, 11–15, 16+ (0 never reaches the model: the trip has ended). */
export const hpBucket = (hp: number): number => bucket(hp, [4, 7, 11, 16]);
/** Max HP: up to 14 (the start), 15–19 (after vigour), 20+. */
export const maxHpBucket = (maxHp: number): number => bucket(maxHp, [15, 20]);
/** Attack: 2, 3, 4+. */
export const attackBucket = (attack: number): number => bucket(attack, [3, 4]);
/** Potions, torches: 0, 1, 2, 3. */
export const packBucket = (n: number): number => bucket(n, [1, 2, 3]);
/** The torch: off, burning low (1–3 lit views to come, this one included), lit (4+). */
export const torchBucket = (torchLeft: number): number => bucket(torchLeft, [1, 4]);
/** Gold: 0, 1–5, 6–15, 16–30, 31+. */
export const goldBucket = (gold: number): number => bucket(gold, [1, 6, 16, 31]);
/** Time left: under 20, 20–49, 50–99, 100–149, 150+. */
export const timeBucket = (timeLeft: number): number => bucket(timeLeft, [20, 50, 100, 150]);

// ── Stairs compass ──────────────────────────────────────────────────────────

/** The compass directions, clockwise from up (north), then "here" on the stairs. */
export const COMPASS_NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'here'] as const;
export const HERE = 8;
/** Walking distance to the stairs: near below this, far up to the next, very far from it. */
export const COMPASS_FAR_FROM = 10;
export const COMPASS_VERY_FAR_FROM = 20;

/**
 * Which way the stairs lie from `from`: the nearest of the 8 compass directions to the straight line from his
 * tile to the stairs, by angle (sectors of 45°). Whole-tile offsets never fall exactly between two sectors, since
 * the boundaries are at tan 22.5° = √2 − 1, so there are no ties. Worked in whole numbers: the stairs are
 * straight along the major axis when (minor + major)² < 2 · major².
 */
export function stairsDirection(size: number, from: number, stairs: number): number {
  const dx = (stairs % size) - (from % size);
  const dy = Math.floor(stairs / size) - Math.floor(from / size);
  if (dx === 0 && dy === 0) return HERE;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const major = Math.max(ax, ay);
  const straight = (ax + ay) ** 2 < 2 * major ** 2;
  if (straight && ay > ax) return dy < 0 ? 0 : 4;
  if (straight) return dx > 0 ? 2 : 6;
  if (dy < 0) return dx > 0 ? 1 : 7;
  return dx > 0 ? 3 : 5;
}

/** Near / far / very far, from the walking distance to the stairs. */
export const distanceBucket = (steps: number): number => bucket(steps, [COMPASS_FAR_FROM, COMPASS_VERY_FAR_FROM]);

// ── Layout ──────────────────────────────────────────────────────────────────

/** Sizes of the pinned groups, in order. */
export const PINNED_GROUPS = [
  ['hp', 5], ['maxHp', 3], ['attack', 3], ['potions', 4], ['torches', 4], ['torch', 3], ['gold', 5], ['time', 5],
  ['compass', 12],
] as const;
export type PinnedGroup = typeof PINNED_GROUPS[number][0];
/** Where each pinned group starts. */
export const PINNED_AT = {} as Record<PinnedGroup, number>;
export const PINNED_SIZE = PINNED_GROUPS.reduce((at, [name, n]) => ((PINNED_AT[name] = at), at + n), 0);
/** Within the compass: 9 directions (8 and here), then near, far, very far. */
export const COMPASS_DISTANCE_AT = PINNED_AT.compass + 9;

/** One view cell: one-hot over the 17 view kinds, then wounded, then rich. */
export const CELL_SIZE = VIEW_KINDS + 2;
export const WOUNDED_AT = VIEW_KINDS;
export const RICH_AT = VIEW_KINDS + 1;
export const VIEW_CELLS = VIEW_SIZE * VIEW_SIZE;
export const VIEW_INPUTS = VIEW_CELLS * CELL_SIZE;
/** A remembered pair: present flag, the view, the action taken on it. */
export const PAIR_SIZE = 1 + VIEW_INPUTS + ACTIONS;

/** Memory sizes: remembered (view, action) pairs, fixed before training. */
export const MEMORY_SIZES = { short: 1, medium: 3, long: 6 } as const;
export type MemoryName = keyof typeof MEMORY_SIZES;

/** Inputs to the model for a memory of `pairs`. */
export const inputSize = (pairs: number): number => PINNED_SIZE + pairs * PAIR_SIZE + VIEW_INPUTS;
/** Where remembered pair slot `k` starts (0 is the oldest). */
export const pairAt = (k: number): number => PINNED_SIZE + k * PAIR_SIZE;
/** Where the view now starts. */
export const viewNowAt = (pairs: number): number => PINNED_SIZE + pairs * PAIR_SIZE;

// ── Encoding ────────────────────────────────────────────────────────────────

/**
 * The active pinned inputs, in increasing order: 9 numbers (the compass has no distance on the stairs) or 10.
 * The distance comes from `s.stairsDist`, which `step` keeps up to date.
 */
export function pinnedIndices(s: RaidState): number[] {
  const at = PINNED_AT;
  const out = [
    at.hp + hpBucket(s.hp),
    at.maxHp + maxHpBucket(s.maxHp),
    at.attack + attackBucket(s.attack),
    at.potions + packBucket(s.potions),
    at.torches + packBucket(s.torches),
    at.torch + torchBucket(s.torchLeft),
    at.gold + goldBucket(s.gold),
    at.time + timeBucket(s.timeLeft),
  ];
  const dir = stairsDirection(s.map.size, s.pos, s.map.stairs);
  out.push(at.compass + dir);
  if (dir !== HERE) out.push(COMPASS_DISTANCE_AT + distanceBucket(s.stairsDist[s.pos]));
  return out;
}

/** The active inputs of a view, from `offset`, in increasing order. */
export function viewIndices(view: readonly ViewCell[], offset = 0): number[] {
  if (view.length !== VIEW_CELLS) throw new Error(`A view has ${VIEW_CELLS} cells, not ${view.length}`);
  const out: number[] = [];
  view.forEach((c, k) => {
    const at = offset + k * CELL_SIZE;
    out.push(at + c.kind);
    if (c.wounded) out.push(at + WOUNDED_AT);
    if (c.rich) out.push(at + RICH_AT);
  });
  return out;
}

/** A remembered pair: the view he saw (as its active indices from 0) and the action he took on it. */
export interface Pair { view: number[]; action: Action }

/** His memory strip: at most `size` pairs, oldest first. */
export interface Memory { size: number; pairs: Pair[] }

export const newMemory = (size: number): Memory => ({ size, pairs: [] });

/** After an action: remember the view it was taken on; the oldest pair drops out when the strip is full. */
export function remember(m: Memory, view: readonly ViewCell[], action: Action): void {
  m.pairs.push({ view: viewIndices(view), action });
  if (m.pairs.length > m.size) m.pairs.shift();
}

/**
 * The model's input now: the active indices, in increasing order. The newest pair sits in the last slot, next to
 * the view now, so a slot always means the same number of turns ago; slots not yet filled (at the start of a
 * raid) are all zero, present flag included.
 */
export function encode(s: RaidState, view: readonly ViewCell[], m: Memory): number[] {
  const out = pinnedIndices(s);
  const empty = m.size - m.pairs.length;
  m.pairs.forEach((p, k) => {
    const at = pairAt(empty + k);
    out.push(at);
    for (const i of p.view) out.push(at + 1 + i);
    out.push(at + 1 + VIEW_INPUTS + p.action);
  });
  out.push(...viewIndices(view, viewNowAt(m.size)));
  return out;
}

/** The full 0/1 input vector from its active indices. */
export function dense(indices: readonly number[], size: number): Float32Array {
  const x = new Float32Array(size);
  for (const i of indices) x[i] = 1;
  return x;
}

// ── In words ────────────────────────────────────────────────────────────────

const dash = (a: number, b: number) => `${a}–${b}`;
/** Each pinned input in words, in input order: what the memory strip shows for the pinned tokens. */
export const PINNED_LABELS: readonly string[] = [
  ...['1–3', '4–6', '7–10', '11–15', '16+'].map((v) => `HP ${v}`),
  ...['up to 14', '15–19', '20+'].map((v) => `Max HP ${v}`),
  ...['2', '3', '4+'].map((v) => `Attack ${v}`),
  ...['0', '1', '2', '3'].map((v) => `Potions ${v}`),
  ...['0', '1', '2', '3'].map((v) => `Torches ${v}`),
  ...['off', 'burning low', 'lit'].map((v) => `Torch ${v}`),
  ...['0', '1–5', '6–15', '16–30', '31+'].map((v) => `Gold ${v}`),
  ...['under 20', dash(20, 49), dash(50, 99), dash(100, 149), '150+'].map((v) => `Time ${v}`),
  ...COMPASS_NAMES.map((v) => (v === 'here' ? 'Stairs here' : `Stairs ${v}`)),
  'near', 'far', 'very far',
];

/**
 * The pinned tokens he reads now, in words ("HP 7–10", "Stairs north-east, far"): one per group, the compass
 * direction and distance together. Made from `pinnedIndices`, so it is exactly what the model reads.
 */
export function pinnedWords(s: RaidState): string[] {
  const words = pinnedIndices(s).map((i) => PINNED_LABELS[i]);
  if (words.length > PINNED_GROUPS.length) words.splice(-2, 2, `${words.at(-2)}, ${words.at(-1)}`);
  return words;
}
