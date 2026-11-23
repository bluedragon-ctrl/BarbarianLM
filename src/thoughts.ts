/**
 * His thoughts on a raid alone, in a speech bubble: a line or two after some actions. As in Karkulka, a thought is
 * made up after the action is already picked, from what he saw, what happened and how sure he was, so it never
 * changes what he does ("Troll to the north. Too big. Not today." and then he walks north). He speaks in compass
 * words: up the screen is north. The lines live in `data/events.json`; the randomness is the `code|n|thoughts`
 * stream, never the raid's. No DOM.
 */
import { DATA, metThoughts, type EventKind, type EventMet, type ThoughtLines } from './events';
import type { RaidTurn } from './raid';
import type { Rng } from './rng';
import { MONSTER_VIEW_KIND, VIEW_SIZE } from './sight';
import { GOLD, MONSTER_KINDS, POTION, SHOWN, STRENGTH, TORCH, VIGOUR, type MonsterKind } from './tiles';
import { LEFT, type Action } from './world';

/** How sure he sounds, from the probability of the action he took. */
export const SURE_FROM = 0.75;
export const LIKELY_FROM = 0.4;
/** At most one thought every this many actions, except hits, beaten monsters, events and the end. */
export const THOUGHT_GAP = 2;
/** Actions an event's thought may wait for its turn (behind a hit, say) before it is forgotten. */
export const EVENT_WAIT = 3;
/** Actions before he talks about the same kind of monster, or gold, again. */
export const SEEN_GAP = 6;
/** Chatter (only how sure he is) after this many quiet actions, sometimes. */
export const CHATTER_GAP = 6;
/** "Need a potion…" at or below this HP; he says it again only after healing above `LOW_HP_AGAIN`. */
export const LOW_HP = 4;
export const LOW_HP_AGAIN = 7;
/** "Sun's going down" at or below this many turns left, once. */
export const LATE_TIME = 20;

/** The word for each action in his thoughts. */
export const ACTION_WORDS = ['north', 'east', 'south', 'west', 'pick it up', 'drink', 'light the torch', 'leave', 'wait'] as const;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Where a view offset lies from him, in compass words: "to the north", "to the south-west". */
export function placeWord(dx: number, dy: number): string {
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
  return ns || ew ? `to the ${ns && ew ? `${ns}-${ew}` : ns || ew}` : 'right here';
}

/** The offset of view cell `k` from him. */
const offset = (k: number): [number, number] => [(k % VIEW_SIZE) - (VIEW_SIZE >> 1), Math.floor(k / VIEW_SIZE) - (VIEW_SIZE >> 1)];
const DIR_X = [0, 1, 0, -1];
const DIR_Y = [-1, 0, 1, 0];

/** How sure he was of an action: the probability he sampled it with. */
export function sureness(p: number): 'sure' | 'likely' | 'unsure' {
  return p >= SURE_FROM ? 'sure' : p >= LIKELY_FROM ? 'likely' : 'unsure';
}

/**
 * His thoughts over a raid. Call `after(turn)` once per turn, in order; it returns one or two lines, or null to stay
 * quiet. First match wins: the end, a hit taken, a monster beaten, an event, then (at most every 2 actions) an item
 * picked up, a monster in sight, gold in sight, a wall dug through, the torch, a potion, low HP, little time, a
 * wasted action, and now and then just how sure he was.
 */
export class Thoughts {
  private t = 0;
  private lastAt = -100;
  private readonly lastSaid = new Map<string, number>();
  private lowSaid = false;
  private lateSaid = false;
  private readonly lastPick = new Map<readonly string[], number>();
  private waiting: { lines: readonly string[]; t: number }[] = [];

  constructor(private readonly rng: Rng, readonly lines: ThoughtLines = DATA.thoughts, private readonly cast?: readonly EventKind[]) {}

  after(turn: RaidTurn): string[] | null {
    this.t++;
    for (const e of turn.events ?? []) this.waiting.push({ lines: this.eventLines(e), t: this.t });
    const out = this.think(turn);
    if (out) this.lastAt = this.t;
    return out;
  }

  private eventLines(e: EventMet): readonly string[] {
    return this.cast ? metThoughts(e, this.cast) : metThoughts(e);
  }

  private think(turn: RaidTurn): string[] | null {
    const L = this.lines;
    const r = turn.result;
    const t = this.t;
    const a = turn.action;
    const p = turn.sample[a] ?? 0;
    const decision = () => this.decision(a, p);
    const chance = (x: number) => this.rng() < x;

    if (r.ended) {
      const end = r.ended === 'left' ? (turn.after.gold > 0 ? 'left' : 'leftNoGold') : r.ended;
      return [this.say(L.endings[end])];
    }
    if (r.hits.length) {
      const worst = r.hits.reduce((x, y) => (y.damage > x.damage ? y : x));
      return [this.say(L.hit[worst.kind])];
    }
    if (r.trapDamage) return [this.say(L.trap)];
    if (r.beaten) return [this.say(L.beaten[r.beaten.monster.kind])];

    this.waiting = this.waiting.filter((e) => t - e.t <= EVENT_WAIT);
    if (this.waiting.length) return [this.say(this.waiting.shift()!.lines)];

    if (t - this.lastAt < THOUGHT_GAP) return null;

    if (r.picked !== undefined) {
      const kind = r.picked === GOLD ? 'gold' : r.picked === POTION ? 'potion' : r.picked === TORCH ? 'torch'
        : r.picked === STRENGTH ? 'strength' : r.picked === VIGOUR ? 'vigour' : null;
      if (kind) return [this.say(L.picked[kind])];
    }

    // What he saw when he picked this action, preferring what lies the way he went.
    const monster = this.nearest(turn, a, (kind) => MONSTER_KINDS.findIndex((m) => MONSTER_VIEW_KIND(m) === kind) >= 0);
    if (monster && this.fresh('monster', t)) {
      const kind = MONSTER_KINDS.find((m) => MONSTER_VIEW_KIND(m) === turn.view[monster.k].kind) as MonsterKind;
      this.lastSaid.set('monster', t);
      return [this.say(L.monster[kind], placeWord(monster.dx, monster.dy)), decision()];
    }
    const gold = this.nearest(turn, a, (kind) => kind === SHOWN.smallGold || kind === SHOWN.heap, true);
    if (gold && this.fresh('gold', t) && chance(0.6)) {
      this.lastSaid.set('gold', t);
      const heap = turn.view[gold.k].kind === SHOWN.heap;
      return [this.say(heap ? L.heap : L.gold, placeWord(gold.dx, gold.dy)), decision()];
    }

    if (r.dugThrough) return [this.say(L.dug)];
    if (r.did === 'light') return [this.say(L.light)];
    if (r.torchOut) return [this.say(L.torchOut)];
    if (r.did === 'drink') return [this.say(L.drink)];

    const hp = turn.after.hp;
    if (hp > LOW_HP_AGAIN) this.lowSaid = false;
    if (hp <= LOW_HP && !this.lowSaid) {
      this.lowSaid = true;
      return [this.say(L.lowHp)];
    }
    if (turn.after.timeLeft <= LATE_TIME && !this.lateSaid) {
      this.lateSaid = true;
      return [this.say(L.lateTime)];
    }

    if (r.did === 'nothing' && chance(0.6)) {
      const key = a <= LEFT ? 'bump' : (['pickUp', 'drink', 'light', 'leave'] as const)[a - 4];
      if (key) return [this.say(L.wasted[key])];
    }

    if (t - this.lastAt >= CHATTER_GAP && chance(0.25)) return [decision()];
    return null;
  }

  /** "East, I think.": the action in words, as sure as he was. */
  decision(a: Action, p: number): string {
    const word = ACTION_WORDS[a];
    return this.say(this.lines[sureness(p)]).replace('{A}', cap(word)).replace('{a}', word);
  }

  private fresh(key: string, t: number): boolean {
    return t - (this.lastSaid.get(key) ?? -100) >= SEEN_GAP;
  }

  /** The cell of his view (not his own) that matches, in the direction of his move first, else the nearest. */
  private nearest(turn: RaidTurn, a: Action, match: (kind: number) => boolean, ownTile = false): { k: number; dx: number; dy: number } | null {
    let best: { k: number; dx: number; dy: number; score: number } | null = null;
    for (let k = 0; k < turn.view.length; k++) {
      if (!match(turn.view[k].kind)) continue;
      const [dx, dy] = offset(k);
      if (!ownTile && dx === 0 && dy === 0) continue;
      const ahead = a <= LEFT && ((DIR_X[a] !== 0 && Math.sign(dx) === DIR_X[a]) || (DIR_Y[a] !== 0 && Math.sign(dy) === DIR_Y[a]));
      const score = Math.max(Math.abs(dx), Math.abs(dy)) - (ahead ? 10 : 0);
      if (!best || score < best.score) best = { k, dx, dy, score };
    }
    return best;
  }

  /** A random line, never the same as the last one from that list; `{dir}` is filled in. */
  private say(lines: readonly string[], dir = ''): string {
    const last = this.lastPick.get(lines) ?? -1;
    let k = Math.floor(this.rng() * lines.length);
    if (k === last && lines.length > 1) k = (k + 1) % lines.length;
    this.lastPick.set(lines, k);
    return lines[k].replace('{dir}', dir);
  }
}

/** All his thoughts over a finished raid, turn by turn (null where he stayed quiet). */
export function thinkAll(turns: readonly RaidTurn[], rng: Rng, cast?: readonly EventKind[]): (string[] | null)[] {
  const th = new Thoughts(rng, DATA.thoughts, cast);
  return turns.map((turn) => th.after(turn));
}
