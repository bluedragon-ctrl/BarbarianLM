/**
 * Marks on the floor for the board: a faint pool where a monster is beaten (blood, or slime from a slime), and
 * footprints for the next few steps after he walks through one. Only the board draws them: they are never in his
 * view, so they change nothing he does. No DOM.
 */
import type { MonsterKind } from './tiles';
import type { StepResult } from './world';

export type PoolKind = 'blood' | 'slime';

export interface Pool { at: number; kind: PoolKind; turn: number }

export interface Print {
  at: number;
  kind: PoolKind;
  /** The way he was walking: 0 up, 1 right, 2 down, 3 left. */
  dir: number;
  /** 1 for the first step out of the pool, up to `PRINT_STEPS` for the faintest. */
  n: number;
  turn: number;
}

/** How many steps after a pool leave prints. */
export const PRINT_STEPS = 3;

export const poolKind = (kind: MonsterKind): PoolKind => (kind === 'slime' ? 'slime' : 'blood');

/** The floor marks of one raid. Call `after` with each step's result and where he stands now. */
export class FloorMarks {
  readonly pools: Pool[] = [];
  readonly prints: Print[] = [];
  /** The pool he last walked through and the prints it has left to give. */
  private wet: { kind: PoolKind; left: number } | null = null;

  constructor(private pos: number) {}

  after(r: StepResult, pos: number, turn: number): void {
    if (r.beaten) {
      const kind = poolKind(r.beaten.monster.kind);
      const at = r.beaten.monster.pos;
      const old = this.pools.find((p) => p.at === at);
      if (old) Object.assign(old, { kind, turn });
      else this.pools.push({ at, kind, turn });
    }
    if (r.did === 'walk' && pos !== this.pos) {
      const pool = this.pools.find((p) => p.at === pos);
      if (pool) this.wet = { kind: pool.kind, left: PRINT_STEPS };
      else if (this.wet) {
        const n = PRINT_STEPS - this.wet.left + 1;
        const old = this.prints.findIndex((p) => p.at === pos);
        if (old >= 0) this.prints.splice(old, 1);
        this.prints.push({ at: pos, kind: this.wet.kind, dir: r.action, n, turn });
        this.wet = --this.wet.left > 0 ? this.wet : null;
      }
    }
    this.pos = pos;
  }
}
