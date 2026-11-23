import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { randomCode, rngFrom } from '../src/rng';
import { DARK, MONSTER_VIEW_KIND, VIEW_KINDS } from '../src/sight';
import { GOLD, MONSTER_STATS, SHOWN, WALL } from '../src/tiles';
import {
  CELL_SIZE, COMPASS_DISTANCE_AT, HERE, MEMORY_SIZES, PAIR_SIZE, PINNED_AT, PINNED_GROUPS, PINNED_SIZE, RICH_AT,
  SAVE_VERSION, VIEW_INPUTS, WOUNDED_AT, attackBucket, dense, distanceBucket, encode, goldBucket, hpBucket,
  inputSize, maxHpBucket, newMemory, packBucket, pairAt, pinnedIndices, remember, stairsDirection, stairsDistances,
  timeBucket, torchBucket, viewIndices, viewNowAt,
} from '../src/tokens';
import { ACTIONS, DOWN, LEFT, PICK_UP, RIGHT, RULES, UP, newRaid, step, view, type Action } from '../src/world';
import { cell, raidFrom } from './maps';

/** `f` gives bucket b for every value in `ranges[b]` (inclusive). */
function expectBuckets(f: (x: number) => number, ranges: [number, number][]) {
  ranges.forEach(([lo, hi], b) => {
    expect(f(lo), `${lo}`).toBe(b);
    expect(f(hi), `${hi}`).toBe(b);
  });
}

describe('sizes', () => {
  it('pinned 43, view 475, pair 484', () => {
    expect(PINNED_SIZE).toBe(43);
    expect(PINNED_GROUPS.map(([, n]) => n)).toEqual([5, 3, 3, 4, 4, 3, 5, 4, 12]);
    expect(VIEW_KINDS).toBe(17);
    expect(CELL_SIZE).toBe(19);
    expect(VIEW_INPUTS).toBe(475);
    expect(PAIR_SIZE).toBe(484);
    expect(ACTIONS).toBe(8);
  });

  it('inputs 1,002 / 1,970 / 3,422 for short, medium and long memory', () => {
    expect(MEMORY_SIZES).toEqual({ short: 1, medium: 3, long: 6 });
    expect(inputSize(MEMORY_SIZES.short)).toBe(1002);
    expect(inputSize(MEMORY_SIZES.medium)).toBe(1970);
    expect(inputSize(MEMORY_SIZES.long)).toBe(3422);
  });

  it('the save version goes with this layout: bump it when a size changes', () => {
    const layout = [PINNED_SIZE, VIEW_INPUTS, PAIR_SIZE, ACTIONS, ...Object.values(MEMORY_SIZES)];
    expect({ SAVE_VERSION, layout }).toEqual({ SAVE_VERSION: 1, layout: [43, 475, 484, 8, 1, 3, 6] });
  });
});

describe('buckets, every edge', () => {
  it('HP: 1–3, 4–6, 7–10, 11–15, 16+', () => expectBuckets(hpBucket, [[1, 3], [4, 6], [7, 10], [11, 15], [16, 99]]));
  it('max HP: up to 12, 13–19, 20+', () => expectBuckets(maxHpBucket, [[1, 12], [13, 19], [20, 99]]));
  it('attack: 2, 3, 4+', () => expectBuckets(attackBucket, [[2, 2], [3, 3], [4, 20]]));
  it('potions and torches: 0, 1, 2, 3', () => expectBuckets(packBucket, [[0, 0], [1, 1], [2, 2], [3, 3]]));
  it('torch: off, low 1–3, lit 4+', () => expectBuckets(torchBucket, [[0, 0], [1, 3], [4, RULES.torchTurns]]));
  it('gold: 0, 1–5, 6–15, 16–30, 31+', () => expectBuckets(goldBucket, [[0, 0], [1, 5], [6, 15], [16, 30], [31, 999]]));
  it('time left: < 20, 20–49, 50–99, 100+', () => expectBuckets(timeBucket, [[0, 19], [20, 49], [50, 99], [100, RULES.timeLimit]]));
  it('stairs distance: near < 10, far 10–19, very far 20+', () => expectBuckets(distanceBucket, [[1, 9], [10, 19], [20, 99]]));

  it('a fresh raid starts at HP 11–15, max ≤ 12, attack 2, 1 potion, 1 torch, off, no gold, 100+ time', () => {
    const s = newRaid(generateDungeon('TOKENS'));
    const p = pinnedIndices(s);
    expect(p.slice(0, 8)).toEqual([
      PINNED_AT.hp + 3, PINNED_AT.maxHp, PINNED_AT.attack, PINNED_AT.potions + 1, PINNED_AT.torches + 1,
      PINNED_AT.torch, PINNED_AT.gold, PINNED_AT.time + 3,
    ]);
    expect(p.slice(8)).toEqual([PINNED_AT.compass + HERE]); // on the stairs: no distance
  });

  it('the torch reads lit for 12 views, then low for the last 3, then off', () => {
    const s = raidFrom(['@....']);
    s.torches = 1;
    const seen: number[] = [];
    step(s, 6 as Action, rngFrom('m')); // light torch
    while (s.torchLeft > 0) {
      seen.push(torchBucket(s.torchLeft));
      step(s, PICK_UP, rngFrom('m')); // nothing to pick up: just a turn
    }
    seen.push(torchBucket(s.torchLeft));
    expect(seen).toEqual([...new Array(12).fill(2), 1, 1, 1, 0]);
  });
});

describe('stairs compass', () => {
  const SIZE = 21;
  const C = 10 * SIZE + 10; // the stairs in the middle
  const dirFrom = (dx: number, dy: number) => stairsDirection(SIZE, (10 - dy) * SIZE + 10 - dx, C);

  it('points the 8 ways, clockwise from north, and "here" on the stairs', () => {
    // The stairs at offset (dx, dy) from him; y grows down the screen (south).
    expect(dirFrom(0, -5)).toBe(0); // north
    expect(dirFrom(3, -3)).toBe(1); // north-east
    expect(dirFrom(5, 0)).toBe(2); // east
    expect(dirFrom(3, 3)).toBe(3); // south-east
    expect(dirFrom(0, 5)).toBe(4); // south
    expect(dirFrom(-3, 3)).toBe(5); // south-west
    expect(dirFrom(-5, 0)).toBe(6); // west
    expect(dirFrom(-3, -3)).toBe(7); // north-west
    expect(dirFrom(0, 0)).toBe(HERE);
  });

  it('uses 45° sectors: within 22.5° of an axis is straight along it', () => {
    expect(dirFrom(1, -2)).toBe(1); // 26.6° off north: north-east
    expect(dirFrom(1, -3)).toBe(0); // 18.4°: north
    expect(dirFrom(2, -5)).toBe(0); // 21.8°: north
    expect(dirFrom(5, 2)).toBe(2); // east
    expect(dirFrom(5, 3)).toBe(3); // 31°: south-east
    expect(dirFrom(-1, 1)).toBe(5);
  });

  it('matches the angle everywhere on a grid', () => {
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        if (!dx && !dy) continue;
        const bearing = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = north, clockwise
        expect(dirFrom(dx, dy), `${dx},${dy}`).toBe(Math.round(((bearing + 360) % 360) / 45) % 8);
      }
    }
  });

  it('near / far / very far by walking distance, with edges at 9|10 and 19|20 steps', () => {
    // A corridor 22 long, the stairs at its west end.
    const s = raidFrom(['>......................']);
    const dist = stairsDistances(s);
    const distanceOf = (x: number) => {
      s.pos = cell(s, x, 0);
      const p = pinnedIndices(s, dist);
      expect(p[8]).toBe(PINNED_AT.compass + 6); // the stairs lie west
      return p[9] - COMPASS_DISTANCE_AT;
    };
    expect([1, 9, 10, 19, 20, 22].map(distanceOf)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('counts walking steps round walls, and dug walls as floor', () => {
    const s = raidFrom([
      '>#.',
      '.#.',
      '.#.',
      '...',
    ]);
    s.pos = cell(s, 2, 0);
    expect(stairsDistances(s)[s.pos]).toBe(8);
    s.map.tiles[cell(s, 1, 0)] = 0; // dug through
    expect(stairsDistances(s)[s.pos]).toBe(2);
  });
});

describe('view encoding', () => {
  it('gives each cell its kind, plus the wounded and rich flags', () => {
    const s = raidFrom(['.g.', '.@.', '...']);
    const g = s.monsters[0];
    g.hp = MONSTER_STATS.goblin.hp / 2;
    g.rich = true;
    const idx = viewIndices(view(s));
    const up = 7 * CELL_SIZE; // row 1, column 2 of the 5 × 5
    expect(idx.filter((i) => i >= up && i < up + CELL_SIZE)).toEqual([up + MONSTER_VIEW_KIND('goblin'), up + WOUNDED_AT, up + RICH_AT]);
    expect(idx[0]).toBe(DARK); // top-left corner: out of the light
    expect(idx.filter((i) => i % CELL_SIZE < VIEW_KINDS)).toHaveLength(25);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('a monster on an item shows the monster, never the item', () => {
    const s = raidFrom(['.@r']);
    const r = s.monsters[0];
    s.map.tiles[r.pos] = GOLD;
    s.map.gold[r.pos] = 10;
    const at = 13 * CELL_SIZE; // the cell east of him
    const cellIdx = viewIndices(view(s)).filter((i) => i >= at && i < at + CELL_SIZE);
    expect(cellIdx).toEqual([at + MONSTER_VIEW_KIND('rat')]);
    s.monsters = [];
    expect(viewIndices(view(s)).filter((i) => i >= at && i < at + CELL_SIZE)).toEqual([at + SHOWN.heap]);
  });

  it('is one-hot: a dense vector holds 25 kinds plus the flags', () => {
    const s = raidFrom(['#.', '@.']);
    s.map.wallHp[cell(s, 0, 0)] = 3;
    const x = dense(viewIndices(view(s)), VIEW_INPUTS);
    expect(x.reduce((a, b) => a + b, 0)).toBe(25);
    expect(x[7 * CELL_SIZE + SHOWN.cracked]).toBe(1); // north of him
    expect(s.map.tiles[cell(s, 0, 0)]).toBe(WALL);
  });
});

describe('memory', () => {
  const ACTS: Action[] = [RIGHT, DOWN, LEFT, UP, RIGHT, DOWN, LEFT, UP];

  function play(size: number, turns: number) {
    const s = raidFrom(['@...', '....', '....']);
    const m = newMemory(size);
    const views = [];
    const rng = rngFrom('mem');
    for (let t = 0; t < turns; t++) {
      const v = view(s);
      views.push(v);
      remember(m, v, ACTS[t]);
      step(s, ACTS[t], rng);
    }
    return { s, m, views };
  }

  it('starts empty: every slot is zero, present flag off', () => {
    const s = raidFrom(['@..']);
    const m = newMemory(MEMORY_SIZES.medium);
    const idx = encode(s, view(s), m);
    expect(idx.some((i) => i >= PINNED_SIZE && i < viewNowAt(3))).toBe(false);
    expect(idx.filter((i) => i >= viewNowAt(3))).toEqual(viewIndices(view(s), viewNowAt(3)));
  });

  it('fills from the newest slot, next to the view now', () => {
    const { s, m, views } = play(3, 2);
    const x = dense(encode(s, view(s), m), inputSize(3));
    expect(x[pairAt(0)]).toBe(0); // the oldest slot is still absent
    expect(x.subarray(pairAt(0), pairAt(1)).every((v) => v === 0)).toBe(true);
    expect(x[pairAt(1)]).toBe(1);
    expect(x[pairAt(2)]).toBe(1);
    const slot = (k: number) => [...x.subarray(pairAt(k) + 1, pairAt(k + 1))].flatMap((v, i) => (v ? [i] : []));
    expect(slot(1)).toEqual([...viewIndices(views[0]), VIEW_INPUTS + ACTS[0]]);
    expect(slot(2)).toEqual([...viewIndices(views[1]), VIEW_INPUTS + ACTS[1]]);
  });

  it('scrolls once full: the oldest pair drops out', () => {
    const { s, m, views } = play(3, 5);
    expect(m.pairs.map((p) => p.action)).toEqual(ACTS.slice(2, 5));
    const idx = encode(s, view(s), m);
    for (let k = 0; k < 3; k++) {
      const inSlot = idx.filter((i) => i >= pairAt(k) && i < pairAt(k + 1)).map((i) => i - pairAt(k));
      expect(inSlot).toEqual([0, ...viewIndices(views[2 + k], 1), 1 + VIEW_INPUTS + ACTS[2 + k]]);
    }
  });

  it('short memory holds just the last pair', () => {
    const { s, m } = play(1, 4);
    expect(m.pairs.map((p) => p.action)).toEqual([ACTS[3]]);
    expect(encode(s, view(s), m).at(-1)).toBeLessThan(inputSize(1));
  });

  it('encodes in increasing order, within size, about 100 active inputs, over random dungeons', () => {
    const rng = rngFrom('tokens');
    for (let n = 0; n < 30; n++) {
      const s = newRaid(generateDungeon(randomCode(rng)));
      const m = newMemory(MEMORY_SIZES.medium);
      const monsterRng = rngFrom(`${s.code}|1|monsters`);
      while (!s.ended && s.turn < 60) {
        const v = view(s);
        const idx = encode(s, v, m);
        for (let k = 1; k < idx.length; k++) expect(idx[k]).toBeGreaterThan(idx[k - 1]);
        expect(idx.at(-1)).toBeLessThan(inputSize(3));
        expect(idx.length).toBeLessThan(140);
        const a = (Math.floor(rng() * 5)) as Action; // moves and pick up
        remember(m, v, a);
        step(s, a, monsterRng);
      }
    }
  });
});
