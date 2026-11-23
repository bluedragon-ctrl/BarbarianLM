import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { NOTICE_RANGE, NOTICE_RANGE_LIT, TRAP_STEPS, chaserMayEnter, monsterMayEnter, notices } from '../src/monsters';
import { rngFrom, type Rng } from '../src/rng';
import { BEDROCK, FLOOR, GOLD, POTION, STAIRS, TORCH, TRAP, WALL, type Tile } from '../src/tiles';
import { ACTIONS, DRINK, RULES, allowedActions, newRaid, step, type Action } from '../src/world';
import { cell, raidFrom } from './maps';

const noRng: Rng = () => { throw new Error('the monster stream was used'); };
/** A stream that always draws the same choice: 0 up, 1 right, 2 down, 3 left, 4 stay. */
const always = (choice: number): Rng & { draws: number } => {
  const r = Object.assign(() => { r.draws++; return (choice + 0.5) / 5; }, { draws: 0 });
  return r;
};
const wait = DRINK; // with no potions: a wasted turn that changes nothing
const at = (s: ReturnType<typeof raidFrom>, k = 0) => s.monsters[k].pos;

describe('monsters', () => {
  it('hit only from a side, never a diagonal', () => {
    const s = raidFrom(['.r.', '.@.', 's..']);
    s.potions = 0;
    s.monsters[0].kind = 'goblin';
    const r = step(s, wait, noRng);
    expect(r.hits).toEqual([{ kind: 'goblin', damage: 2 }]);
    expect(s.hp).toBe(10);
  });

  it('immobile ones only hit, and never move', () => {
    const s = raidFrom(['@..s']);
    s.potions = 0;
    s.torchLeft = 10;
    for (let k = 0; k < 3; k++) step(s, wait, noRng);
    expect(at(s)).toBe(cell(s, 3, 0));
    const t = raidFrom(['@s']);
    t.potions = 0;
    expect(step(t, wait, noRng).hits).toEqual([{ kind: 'slime', damage: 3 }]);
    expect(at(t)).toBe(cell(t, 1, 0));
  });

  it('notice him within a square of 3, or 5 while his torch is lit', () => {
    const s = raidFrom(['@.....', '......', '......', '......', '......', '.....r']);
    s.potions = 0;
    const rat = s.monsters[0];
    for (const [x, y, dark, lit] of [[3, 3, true, true], [4, 3, false, true], [5, 5, false, true], [3, 0, true, true]] as const) {
      rat.pos = cell(s, x, y);
      s.torchLeft = 0;
      expect(notices(s, rat), `(${x}, ${y}) dark`).toBe(dark);
      s.torchLeft = 5;
      expect(notices(s, rat), `(${x}, ${y}) lit`).toBe(lit);
    }
    expect([NOTICE_RANGE, NOTICE_RANGE_LIT]).toEqual([3, 5]);
  });

  it('do not notice him through a wall; monsters do not block', () => {
    const s = raidFrom(['@#r', '...', '...']);
    expect(notices(s, s.monsters[0])).toBe(false);
    const t = raidFrom(['@gr', '...', '...']);
    expect(notices(t, t.monsters[1])).toBe(true);
  });

  it('a noticing one steps towards him by a shortest path, ties up, right, down, left', () => {
    // A wall where up would go (off the line of sight): left is the shortest way left.
    const s = raidFrom(['@..', '..#', '..r']);
    s.potions = 0;
    expect(notices(s, s.monsters[0])).toBe(true);
    step(s, wait, noRng);
    expect(at(s)).toBe(cell(s, 1, 2));
    step(s, wait, noRng);
    expect(at(s)).toBe(cell(s, 1, 1));
    // Open floor, him up-left of the rat: up and left are both shortest, up goes first.
    const t = raidFrom(['@..', '...', '..r']);
    t.potions = 0;
    step(t, wait, noRng);
    expect(at(t)).toBe(cell(t, 2, 1));
  });

  it('chasing, cross a spike trap and take its damage when that is shortest; a trap counts as 2 steps', () => {
    expect(TRAP_STEPS).toBe(2);
    // A goblin in a corridor with a trap between them: it steps on, takes 2 and comes on.
    const s = raidFrom(['@.^g']);
    s.potions = 0;
    const r = step(s, wait, noRng);
    expect(at(s)).toBe(cell(s, 2, 0));
    expect(s.monsters[0].hp).toBe(2);
    expect(r.monstersTrapped).toEqual([{ monster: { kind: 'goblin', pos: cell(s, 2, 0), hp: 2, rich: false }, damage: 2, beaten: false }]);
    step(s, wait, noRng);
    expect([at(s), s.monsters[0].hp]).toEqual([cell(s, 1, 0), 2]); // stepping off a trap does not hurt
    // A trap that beats it: it is gone, and leaves no gold.
    const t = raidFrom(['@.^r']);
    t.potions = 0;
    const tr = step(t, wait, noRng);
    expect(tr.monstersTrapped[0].beaten).toBe(true);
    expect(t.monsters).toEqual([]);
    expect(t.map.gold.every((g) => g === 0)).toBe(true);
    expect(t.map.tiles[cell(t, 2, 0)]).toBe(TRAP);
  });

  it('chasing, go round a trap when another way is just as short, whatever the direction order says', () => {
    // Up (through the trap) and left are both 3 steps on foot; the trap makes up 4, so it goes left.
    const s = raidFrom(['@..', '..^', '..g']);
    s.potions = 0;
    step(s, wait, noRng);
    expect(at(s)).toBe(cell(s, 1, 2));
    expect(s.monsters[0].hp).toBe(4);
  });

  it('wandering, never step onto traps, stairs, walls, him or another monster', () => {
    expect(([FLOOR, GOLD, POTION, TORCH] as Tile[]).every(monsterMayEnter)).toBe(true);
    expect(([TRAP, STAIRS, WALL, BEDROCK] as Tile[]).some(monsterMayEnter)).toBe(false);
    expect(([STAIRS, WALL, BEDROCK] as Tile[]).some(chaserMayEnter)).toBe(false);
    // Wandering into the stairs, a wall or another monster: it stays.
    for (const [rows, dir] of [[['#', 'r', '.', '.', '.', '@'], 0], [['^', 'r', '.', '.', '.', '@'], 0], [['>r...@'], 3], [['rs...@'], 1]] as const) {
      const w = raidFrom(rows as unknown as string[]);
      w.potions = 0;
      const before = w.monsters.map((m) => m.pos);
      step(w, wait, always(dir));
      expect(w.monsters.map((m) => m.pos), JSON.stringify(rows)).toEqual(before);
    }
  });

  it('step onto items and walk on to bare floor without picking anything up', () => {
    const s = raidFrom(['@...r!.']);
    s.potions = 0;
    step(s, wait, always(1));
    expect(at(s)).toBe(cell(s, 5, 0));
    expect(s.map.tiles[at(s)]).toBe(POTION);
  });

  it('wander with one draw each from the monster stream: up, right, down, left or stay', () => {
    const s = raidFrom(['.......', '.......', '...g...', '.......', '.......', '.......', '@......']);
    s.potions = 0;
    const g = s.monsters[0];
    const from = g.pos;
    const moves = [cell(s, 3, 1), cell(s, 4, 2), cell(s, 3, 3), cell(s, 2, 2), from];
    for (let choice = 0; choice < 5; choice++) {
      g.pos = from;
      const rng = always(choice);
      step(s, wait, rng);
      expect([g.pos, rng.draws]).toEqual([moves[choice], 1]);
    }
  });

  it('act in their fixed order: the first one takes the tile both want', () => {
    const t = raidFrom(['.#.', 'g.g', '#@#']);
    t.potions = 0;
    step(t, wait, noRng);
    // Only (1, 1) is next to him: the first goblin steps there, the second waits.
    expect([at(t, 0), at(t, 1)]).toEqual([cell(t, 1, 1), cell(t, 2, 1)]);
  });

  it('take their wander randomness only from the stream passed in, so the same streams give the same raid', () => {
    const run = (monsterLabel: string) => {
      const s = newRaid(generateDungeon('WANDER'));
      const act = rngFrom('WANDER|1|act');
      const mon = rngFrom(monsterLabel);
      const trace: number[] = [];
      while (!s.ended) {
        const allowed = allowedActions(s);
        let a: Action;
        do a = Math.floor(act() * ACTIONS) as Action; while (!allowed[a]);
        step(s, a, mon);
        trace.push(...s.monsters.map((m) => m.pos));
      }
      return trace;
    };
    expect(run('WANDER|1|monsters')).toEqual(run('WANDER|1|monsters'));
    expect(run('WANDER|1|monsters')).not.toEqual(run('WANDER|2|monsters'));
    expect(RULES.timeLimit).toBe(150);
  });
});
