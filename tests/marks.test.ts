import { describe, expect, it } from 'vitest';
import { FloorMarks, PRINT_STEPS } from '../src/marks';
import { DOWN, RIGHT, step, WAIT, type Action } from '../src/world';
import { cell, raidFrom } from './maps';

const noRng = () => 0.99;

describe('floor marks', () => {
  function play(rows: string[], actions: Action[]) {
    const s = raidFrom(rows);
    const marks = new FloorMarks(s.pos);
    for (const a of actions) marks.after(step(s, a, noRng), s.pos, s.turn);
    return { s, marks };
  }

  it('leaves a blood pool where a rat is beaten and a slime pool where a slime is', () => {
    const { s, marks } = play(['@r....', '.s....'], [RIGHT]);
    expect(marks.pools).toEqual([{ at: cell(s, 1, 0), kind: 'blood', turn: 1 }]);
    const t = play(['@s....', '......'], [RIGHT, RIGHT, RIGHT]);
    expect(t.marks.pools).toEqual([{ at: cell(t.s, 1, 0), kind: 'slime', turn: 3 }]);
  });

  it(`leaves prints on the ${PRINT_STEPS} steps after he walks through a pool, fainter each step`, () => {
    const { s, marks } = play(['@r......', '........'], [RIGHT, RIGHT, RIGHT, RIGHT, WAIT, DOWN, RIGHT]);
    expect(marks.prints.map((p) => [p.at, p.n, p.dir, p.kind])).toEqual([
      [cell(s, 2, 0), 1, RIGHT, 'blood'],
      [cell(s, 3, 0), 2, RIGHT, 'blood'],
      [cell(s, 3, 1), 3, DOWN, 'blood'],
    ]);
  });

  it('leaves no prints without a pool, and none from a bump into a wall', () => {
    const { marks } = play(['@.#.', '....'], [RIGHT, RIGHT, RIGHT]);
    expect(marks.pools).toEqual([]);
    expect(marks.prints).toEqual([]);
  });
});
