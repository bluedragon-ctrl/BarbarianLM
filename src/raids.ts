/**
 * Many raids: the model raids alone many times and the counts are added up. "Left with no gold" is counted apart
 * from "left": a player that takes Leave on the first turn would otherwise look safe. No DOM.
 */
import { generateDungeon, type Dungeon } from './dungeon';
import type { Model } from './model';
import { raid, type RaidOptions, type RaidRecord } from './raid';
import { randomCode, rngFrom } from './rng';

/** The totals over many raids; `summary` turns them into averages and shares. */
export interface RaidCounts {
  raids: number;
  goldOut: number;
  /** Left by the stairs with gold. */
  left: number;
  /** Left by the stairs with none. */
  leftNoGold: number;
  knockedOut: number;
  lockedIn: number;
  turns: number;
  potions: number;
  torches: number;
  /** Walls dug through. */
  walls: number;
  /** Actions that did nothing (the ones "Block impossible actions" blocks). */
  wasted: number;
  waits: number;
  /** For the judges: gold picked up (kept or not) and monsters beaten. */
  goldPickedUp: number;
  beaten: number;
}

export const newCounts = (): RaidCounts => ({
  raids: 0, goldOut: 0, left: 0, leftNoGold: 0, knockedOut: 0, lockedIn: 0, turns: 0, potions: 0, torches: 0,
  walls: 0, wasted: 0, waits: 0, goldPickedUp: 0, beaten: 0,
});

/** Add one finished raid to the counts. */
export function countRaid(c: RaidCounts, r: Pick<RaidRecord, 'state' | 'turns'>): RaidCounts {
  const s = r.state;
  c.raids++;
  if (s.ended === 'left') {
    c.goldOut += s.gold;
    if (s.gold > 0) c.left++;
    else c.leftNoGold++;
  } else if (s.ended === 'knockedOut') c.knockedOut++;
  else if (s.ended === 'lockedIn') c.lockedIn++;
  c.turns += r.turns.length;
  for (const { result: x } of r.turns) {
    if (x.did === 'drink') c.potions++;
    if (x.did === 'light') c.torches++;
    if (x.did === 'nothing') c.wasted++;
    if (x.did === 'wait') c.waits++;
    if (x.dugThrough) c.walls++;
    if (x.beaten) c.beaten++;
    c.goldPickedUp += x.goldGained;
  }
  return c;
}

/** Averages per raid and shares of raids. */
export interface RaidSummary {
  raids: number;
  goldOut: number;
  left: number;
  leftNoGold: number;
  knockedOut: number;
  lockedIn: number;
  turns: number;
  potions: number;
  torches: number;
  walls: number;
  wasted: number;
  waits: number;
  goldPickedUp: number;
  beaten: number;
}

export function summary(c: RaidCounts): RaidSummary {
  const n = Math.max(1, c.raids);
  const out = { raids: c.raids } as RaidSummary;
  for (const k of Object.keys(c) as (keyof RaidCounts)[]) if (k !== 'raids') out[k] = c[k] / n;
  return out;
}

/** Which raids to play: raid numbers 0, 1, 2… of one dungeon, or raid 0 of many codes. */
export type RaidPlan = { code: string; count: number } | { codes: readonly string[] };

/** `count` dungeon codes, the same for the same seed. */
export const codesFrom = (seed: string, count: number): string[] => {
  const rng = rngFrom(`codes|${seed}`);
  return Array.from({ length: count }, () => randomCode(rng));
};

/** The (dungeon, raid number) pairs of a plan; a dungeon is generated once. */
export function* raidsOf(plan: RaidPlan): Generator<[Dungeon, number]> {
  if ('code' in plan) {
    const d = generateDungeon(plan.code);
    for (let n = 0; n < plan.count; n++) yield [d, n];
  } else {
    for (const code of plan.codes) yield [generateDungeon(code), 0];
  }
}

/** Many raids: play them all and count. `onRaid` sees each finished raid (for progress or the UI). */
export function manyRaids(
  model: Model, plan: RaidPlan, options: RaidOptions = {}, onRaid?: (r: RaidRecord, c: RaidCounts) => void,
): RaidCounts {
  const c = newCounts();
  for (const [d, n] of raidsOf(plan)) {
    const r = raid(model, d, n, options);
    countRaid(c, r);
    onRaid?.(r, c);
  }
  return c;
}
