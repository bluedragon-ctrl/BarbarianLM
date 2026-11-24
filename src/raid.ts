/**
 * A raid alone: the model plays, one sampled action at a time, the way a language model writes one sampled token
 * at a time. Each turn: encode what he sees (pinned stats, memory strip, view now), the forward pass, the
 * probabilities at the boldness (temperature), masked when "Block impossible actions" is on, one draw from the
 * `code|n|act` stream, then `step` with the `code|n|monsters` stream. With events on, the hidden dungeon events
 * follow (`events.ts`, from their own streams). The record of every turn is kept for practice, thoughts, the saga
 * and the UI. No DOM.
 */
import { raidDungeon, type Dungeon } from './dungeon';
import { dungeonFromCode } from './mapCode';
import { CAST, EventTracker, placeEvents, spotsLabel, type EventKind, type EventMet, type EventSpot } from './events';
import { decide, mask, sampleIndex, type Model } from './model';
import { rngFrom } from './rng';
import type { ViewCell } from './sight';
import { PAIR_SIZE, encode, inputSize, newMemory, remember, PINNED_SIZE, VIEW_INPUTS, type Memory } from './tokens';
import { allowedActions, newRaid, step, view, type Action, type RaidState, type StepResult } from './world';

/** How a raid is played. */
export interface RaidOptions {
  /** The boldness dial: sampling temperature (default 1). */
  temperature?: number;
  /** "Block impossible actions" (default off). Lessons and practice never block. */
  block?: boolean;
  /** Hidden dungeon events (default off). Lessons and practice never have them. */
  events?: boolean | EventOptions;
  /**
   * A replay (the hall of fame): the actions taken and their unmasked probabilities, turn by turn, played back
   * instead of the model's draws. The streams are the same, so the dungeon, the monsters and the events answer as
   * they did the first time.
   */
  script?: RaidScript;
  /**
   * Training only: who acts this turn. Given the state and his own draw, returns the action taken (a teacher may
   * take over). His draw is made either way, so the act stream never shifts.
   */
  steer?: (s: RaidState, drawn: Action) => Action;
}

/** A raid's actions and the probabilities they were drawn from, for playing it back without its model. */
export interface RaidScript {
  /** The remembered pairs of the model that played it. */
  memory: number;
  actions: readonly Action[];
  probs: readonly ArrayLike<number>[];
}

export interface EventOptions {
  /** New spots every raid (the default) or the same ones for every raid of a dungeon code. */
  newSpots?: boolean;
  /** The cast to place (default: the data file's); tests change it. */
  cast?: readonly EventKind[];
}

/** His stats after a turn, for thoughts and the UI. */
export interface TurnStats {
  hp: number; maxHp: number; gold: number; potions: number; torches: number; torchLeft: number; timeLeft: number;
}

/** One turn of a raid. */
export interface RaidTurn {
  /** The model's active inputs on this turn. */
  input: number[];
  /** Probabilities at the temperature, unmasked: what the action bars show. */
  probs: Float32Array;
  /** What he sampled from: `probs`, masked when the block option is on. */
  sample: Float32Array;
  /** Which actions would do something; set only when the block option is on. */
  allowed?: boolean[];
  /** What he saw when he picked the action. */
  view: ViewCell[];
  action: Action;
  result: StepResult;
  /** Events that happened after the action (with events on); their effects are already in `after`. */
  events?: EventMet[];
  /** His stats once the turn and its events were over. */
  after: TurnStats;
}

export interface RaidRecord {
  code: string;
  n: number;
  state: RaidState;
  turns: RaidTurn[];
  /** With events on: the spots placed, the cast and the events met in order. */
  events?: RaidEvents;
}

export interface RaidEvents { spots: EventSpot[]; cast: readonly EventKind[]; met: EventMet[] }

/** The remembered pairs a model was built for, from its input size. */
export function memoryPairs(model: Pick<Model, 'nIn'>): number {
  const pairs = (model.nIn - PINNED_SIZE - VIEW_INPUTS) / PAIR_SIZE;
  if (!Number.isInteger(pairs) || pairs < 0 || inputSize(pairs) !== model.nIn) {
    throw new Error(`A model with ${model.nIn} inputs fits no memory size`);
  }
  return pairs;
}

/** The two random streams of raid `n` in a dungeon (see `docs/plan.md`). */
export const raidStreams = (code: string, n: number | string) => ({
  act: rngFrom(`${code}|${n}|act`),
  monsters: rngFrom(`${code}|${n}|monsters`),
});

/** The story streams of raid `n`, apart from the raid's own: event chances and versions, and his thoughts. */
export const storyStreams = (code: string, n: number | string) => ({
  events: rngFrom(`${code}|${n}|story`),
  thoughts: rngFrom(`${code}|${n}|thoughts`),
});

/** The saga's stream for the `telling`-th telling of raid `n` ("Sing it again" counts up). */
export const sagaStream = (code: string, n: number | string, telling = 0) => rngFrom(`${code}|${n}|saga|${telling}`);

const statsOf = (s: RaidState): TurnStats => ({
  hp: s.hp, maxHp: s.maxHp, gold: s.gold, potions: s.potions, torches: s.torches, torchLeft: s.torchLeft, timeLeft: s.timeLeft,
});

/**
 * A raid played step by step (for the UI's raid alone): `next()` takes one turn and returns it, or null once the
 * trip has ended. `run` below plays it to the end.
 */
export class Raid {
  readonly state: RaidState;
  readonly memory: Memory;
  readonly turns: RaidTurn[] = [];
  /** The hidden events, with events on. */
  readonly events?: EventTracker;
  private readonly streams: ReturnType<typeof raidStreams>;

  /** `model` is null only for a replay (`options.script`). */
  constructor(readonly model: Model | null, readonly dungeon: Dungeon, readonly n = 0, readonly options: RaidOptions = {}) {
    if (!model && !options.script) throw new Error('A raid needs a model or a script');
    // With new treasure every raid, this raid's own contents (the same walls).
    const here = raidDungeon(dungeon, n);
    this.state = newRaid(here);
    this.memory = newMemory(options.script ? options.script.memory : memoryPairs(model!));
    this.streams = raidStreams(dungeon.code, n);
    if (options.events) {
      const o = options.events === true ? {} : options.events;
      const cast = o.cast ?? CAST;
      const spots = placeEvents(here, spotsLabel(dungeon.code, o.newSpots === false ? undefined : n), cast);
      this.events = new EventTracker({ spots, cast }, storyStreams(dungeon.code, n).events, this.state);
    }
  }

  /** What the model reads now. */
  input(): number[] {
    return encode(this.state, view(this.state), this.memory);
  }

  /**
   * The coming turn's probabilities, without drawing anything: what the action bars show before he acts. The
   * boldness and the block option are read from `options` each turn, so the dial can move between turns.
   */
  peek(): { probs: Float32Array; sample: Float32Array; allowed?: boolean[] } | null {
    if (this.state.ended) return null;
    const allowed = this.options.block ? allowedActions(this.state) : undefined;
    const d = this.decide(this.input(), allowed);
    if (!d) return null;
    return { probs: d.probs, sample: d.sample, allowed };
  }

  /** The probabilities for the coming turn: the model's, or the script's in a replay (null once it runs out). */
  private decide(input: number[], allowed?: boolean[]): { probs: Float32Array; sample: Float32Array } | null {
    const sc = this.options.script;
    if (!sc) return decide(this.model!, input, this.options.temperature ?? 1, allowed);
    const p = sc.probs[this.turns.length];
    if (!p || this.turns.length >= sc.actions.length) return null;
    const probs = Float32Array.from(p);
    return { probs, sample: allowed ? mask(probs, allowed) : probs };
  }

  next(): RaidTurn | null {
    const s = this.state;
    if (s.ended) return null;
    const v = view(s);
    const input = encode(s, v, this.memory);
    const allowed = this.options.block ? allowedActions(s) : undefined;
    const d = this.decide(input, allowed);
    if (!d) return null;
    // One draw every turn, block or not, so the option never shifts the stream.
    const drawn = sampleIndex(d.sample, this.streams.act()) as Action;
    const action = this.options.script ? this.options.script.actions[this.turns.length] : this.options.steer ? this.options.steer(s, drawn) : drawn;
    const result = step(s, action, this.streams.monsters);
    remember(this.memory, v, action);
    const met = this.events?.after(s);
    const turn: RaidTurn = { input, probs: d.probs, sample: d.sample, allowed, view: v, action, result, after: statsOf(s) };
    if (met?.length) turn.events = met;
    this.turns.push(turn);
    return turn;
  }

  run(): RaidRecord {
    while (this.next());
    return this.record();
  }

  /** The record so far. */
  record(): RaidRecord {
    const r: RaidRecord = { code: this.dungeon.code, n: this.n, state: this.state, turns: this.turns };
    if (this.events) r.events = { spots: this.events.setup.spots, cast: this.events.setup.cast, met: this.events.met };
    return r;
  }
}

/** Raid `n` of a dungeon (a code or a generated dungeon), played to the end. */
export function raid(model: Model, dungeon: Dungeon | string, n = 0, options: RaidOptions = {}): RaidRecord {
  const d = typeof dungeon === 'string' ? dungeonFromCode(dungeon) : dungeon;
  return new Raid(model, d, n, options).run();
}
