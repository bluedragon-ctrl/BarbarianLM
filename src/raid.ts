/**
 * A raid alone: the model plays, one sampled action at a time, the way a language model writes one sampled token
 * at a time. Each turn: encode what he sees (pinned stats, memory strip, view now), the forward pass, the
 * probabilities at the boldness (temperature), masked when "Block impossible actions" is on, one draw from the
 * `code|n|act` stream, then `step` with the `code|n|monsters` stream. The record of every turn is kept for
 * practice and the UI. No DOM.
 */
import { generateDungeon, type Dungeon } from './dungeon';
import { decide, sampleIndex, type Model } from './model';
import { rngFrom } from './rng';
import { PAIR_SIZE, encode, inputSize, newMemory, remember, PINNED_SIZE, VIEW_INPUTS, type Memory } from './tokens';
import { allowedActions, newRaid, step, view, type Action, type RaidState, type StepResult } from './world';

/** How a raid is played. */
export interface RaidOptions {
  /** The boldness dial: sampling temperature (default 1). */
  temperature?: number;
  /** "Block impossible actions" (default off). Lessons and practice never block. */
  block?: boolean;
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
  action: Action;
  result: StepResult;
}

export interface RaidRecord {
  code: string;
  n: number;
  state: RaidState;
  turns: RaidTurn[];
}

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

/**
 * A raid played step by step (for the UI's raid alone): `next()` takes one turn and returns it, or null once the
 * trip has ended. `run` below plays it to the end.
 */
export class Raid {
  readonly state: RaidState;
  readonly memory: Memory;
  readonly turns: RaidTurn[] = [];
  private readonly streams: ReturnType<typeof raidStreams>;

  constructor(readonly model: Model, readonly dungeon: Dungeon, readonly n = 0, readonly options: RaidOptions = {}) {
    this.state = newRaid(dungeon);
    this.memory = newMemory(memoryPairs(model));
    this.streams = raidStreams(dungeon.code, n);
  }

  /** What the model reads now. */
  input(): number[] {
    return encode(this.state, view(this.state), this.memory);
  }

  next(): RaidTurn | null {
    const s = this.state;
    if (s.ended) return null;
    const v = view(s);
    const input = encode(s, v, this.memory);
    const allowed = this.options.block ? allowedActions(s) : undefined;
    const d = decide(this.model, input, this.options.temperature ?? 1, allowed);
    // One draw every turn, block or not, so the option never shifts the stream.
    const action = sampleIndex(d.sample, this.streams.act()) as Action;
    const result = step(s, action, this.streams.monsters);
    remember(this.memory, v, action);
    const turn: RaidTurn = { input, probs: d.probs, sample: d.sample, allowed, action, result };
    this.turns.push(turn);
    return turn;
  }

  run(): RaidRecord {
    while (this.next());
    return { code: this.dungeon.code, n: this.n, state: this.state, turns: this.turns };
  }
}

/** Raid `n` of a dungeon (a code or a generated dungeon), played to the end. */
export function raid(model: Model, dungeon: Dungeon | string, n = 0, options: RaidOptions = {}): RaidRecord {
  const d = typeof dungeon === 'string' ? generateDungeon(dungeon) : dungeon;
  return new Raid(model, d, n, options).run();
}
