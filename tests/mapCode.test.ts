import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { randomCode, rngFrom } from '../src/rng';
import {
  LIMITS, MAP_CODE_MAX, checkMap, cleanCode, codeLabel, copyDungeon, dungeonFromCode, emptyDungeon, mapCode, paint,
  readMapCode, roomsOf,
} from '../src/mapCode';
import { CRACKED_HP, FLOOR, GOLD, STAIRS, WALL, WALL_HP } from '../src/tiles';
import { allowedActions, newRaid, step } from '../src/world';
import { createModel } from '../src/model';
import { manyRaids } from '../src/raids';
import { TeacherRaid } from '../src/teachers';
import { MEMORY_SIZES, inputSize } from '../src/tokens';

const codes = (count: number) => { const r = rngFrom('mapCode test'); return Array.from({ length: count }, () => randomCode(r)); };
const byPos = <T extends { pos: number }>(ms: T[]) => ms.slice().sort((a, b) => a.pos - b.pos);

describe('map codes', () => {
  it('give back every generated dungeon, monsters in reading order', () => {
    const lengths: number[] = [];
    for (const code of codes(300)) {
      const d = generateDungeon(code);
      const m = mapCode(d);
      lengths.push(m.length);
      const back = readMapCode(m);
      expect(back.code).toBe(m);
      expect(back.tiles).toEqual(d.tiles);
      expect(back.wallHp).toEqual(d.wallHp);
      expect(back.gold).toEqual(d.gold);
      expect(back.stairs).toBe(d.stairs);
      expect(back.monsters).toEqual(byPos(d.monsters));
      expect(mapCode(back)).toBe(m);
      expect(checkMap(d).problems).toEqual([]);
    }
    lengths.sort((a, b) => a - b);
    // Measured: 165, 197 and 240 characters over these 300 codes.
    console.log('map code length: min', lengths[0], 'median', lengths[lengths.length >> 1], 'max', lengths[lengths.length - 1]);
    expect(lengths[lengths.length - 1]).toBeLessThan(MAP_CODE_MAX);
  });

  it('refuse broken or cut codes, and maps that cannot be raided', () => {
    const m = mapCode(generateDungeon('BCDEFG'));
    expect(() => readMapCode(m.slice(0, -3))).toThrow(/broken/);
    expect(() => readMapCode(m + 'A')).toThrow(/broken/);
    expect(() => readMapCode(m.replace(/.$/, '*'))).toThrow(/broken/);
    expect(() => readMapCode('~9' + m.slice(2))).toThrow(/another version/);
    expect(() => readMapCode(mapCode(emptyDungeon()))).toThrow(/no stairs/);
  });

  it('are kept apart from generated codes', () => {
    expect(dungeonFromCode('BCDEFG')).toEqual(generateDungeon('BCDEFG'));
    const m = mapCode(generateDungeon('BCDEFG'));
    expect(dungeonFromCode(m).code).toBe(m);
    expect(cleanCode(' bcd-efg ')).toBe('BCDEFG');
    expect(cleanCode(` ${m.slice(0, 50)}\n${m.slice(50)} `)).toBe(m);
    expect(codeLabel('BCDEFG')).toBe('BCDEFG');
    expect(codeLabel(m)).toMatch(/^✎[A-Z2-9]{4}$/);
    expect(codeLabel(m)).toBe(codeLabel(m));
  });

  it('make dungeons he can raid', () => {
    const d = dungeonFromCode(mapCode(generateDungeon('K7QMPR')));
    const s = newRaid(d);
    expect(s.pos).toBe(d.stairs);
    expect(allowedActions(s).some(Boolean)).toBe(true);
    const rng = rngFrom('walk');
    for (let t = 0; t < 30 && !s.ended; t++) step(s, ([0, 1, 2, 3] as const)[t % 4], rng);
    expect(s.turn).toBeGreaterThan(0);
  });

  it('work for the teachers and for many raids, as the worker runs them', () => {
    const m = mapCode(generateDungeon('K7QMPR'));
    const t = new TeacherRaid(dungeonFromCode(m), 'healer', 0);
    while (t.next());
    expect(t.state.ended).not.toBeNull();
    const counts = manyRaids(createModel(inputSize(MEMORY_SIZES.short), 'x'), { code: m, count: 3 });
    expect(counts.raids).toBe(3);
  });
});

describe('painting', () => {
  it('keeps the edge and the one stairs', () => {
    const d = emptyDungeon();
    expect(paint(d, 0, 'floor')).toMatch(/bedrock/);
    expect(paint(d, 21, 'stairs')).toBeNull();
    expect(paint(d, 42, 'stairs')).toBeNull();
    expect(d.stairs).toBe(42);
    expect(d.tiles[21]).toBe(FLOOR);
    expect(d.tiles.filter((t) => t === STAIRS)).toHaveLength(1);
    expect(paint(d, 42, 'wall')).toMatch(/stairs/);
    expect(paint(d, 42, 'rat')).toMatch(/stairs/);
  });

  it('puts monsters on floor in reading order, and walls clear what was there', () => {
    const d = emptyDungeon();
    paint(d, 21, 'stairs');
    paint(d, 63, 'gold', { gold: 7 });
    paint(d, 63, 'troll', { rich: true });
    paint(d, 50, 'rat');
    expect(d.tiles[63]).toBe(FLOOR);
    expect(d.gold[63]).toBe(0);
    expect(d.wallHp[63]).toBe(0);
    expect(d.monsters.map((m) => [m.kind, m.pos, m.rich])).toEqual([['rat', 50, false], ['troll', 63, true]]);
    paint(d, 50, 'cracked');
    expect(d.tiles[50]).toBe(WALL);
    expect(d.wallHp[50]).toBe(CRACKED_HP);
    expect(d.monsters).toHaveLength(1);
    paint(d, 50, 'wall');
    expect(d.wallHp[50]).toBe(WALL_HP);
    const back = readMapCode(mapCode(d));
    expect(back.monsters).toEqual(d.monsters);
  });

  it('holds to the limits', () => {
    const d = emptyDungeon();
    paint(d, 21, 'stairs');
    const cells = Array.from({ length: 18 * 18 }, (_, k) => (1 + Math.floor(k / 18)) * 20 + 1 + (k % 18)).filter((i) => i !== 21);
    cells.slice(0, LIMITS.monsters).forEach((i) => expect(paint(d, i, 'rat')).toBeNull());
    expect(paint(d, cells[LIMITS.monsters], 'goblin')).toMatch(/16 monsters/);
    // A monster painted over a monster takes its place.
    expect(paint(d, cells[0], 'goblin')).toBeNull();
    expect(paint(d, cells[100], 'gold', { gold: 31 })).toMatch(/1 to 30/);
    expect(paint(d, cells[100], 'gold', { gold: 0 })).toMatch(/1 to 30/);
    cells.slice(100, 100 + LIMITS.items).forEach((i) => expect(paint(d, i, 'potion')).toBeNull());
    expect(paint(d, cells[150], 'potion')).toMatch(/8 potions/);
    // Painting the same kind over one already counted is fine.
    expect(paint(d, cells[100], 'potion')).toBeNull();
    expect(checkMap(d).problems).toEqual([]);
  });
});

describe('checks', () => {
  it('say what breaks a raid, and warn about what is merely odd', () => {
    const d = emptyDungeon();
    expect(checkMap(d).problems).toEqual(['No stairs: he needs a way in and out.']);
    paint(d, 21, 'stairs');
    paint(d, 22, 'floor');
    paint(d, 23, 'rat');
    paint(d, 103, 'gold', { gold: 5 });
    const c = checkMap(d);
    expect(c.problems).toEqual([]);
    expect(c.warnings).toEqual([
      '5 gold lies behind stone: only digging reaches it.',
      'A monster stands within 5 steps of the stairs. Generated dungeons never do that.',
    ]);
    const two = copyDungeon(d);
    two.tiles[30] = STAIRS;
    expect(checkMap(two).problems).toEqual(['More than one stairs.']);
    const pile = copyDungeon(d);
    pile.tiles[30] = GOLD;
    expect(checkMap(pile).problems).toEqual(['A gold pile with no gold.']);
    const empty = emptyDungeon();
    paint(empty, 21, 'stairs');
    expect(checkMap(empty).warnings).toEqual(['No gold anywhere: nothing to carry out.']);
  });

  it('find rooms in hand-made maps for the events', () => {
    const d = emptyDungeon();
    paint(d, 21, 'stairs');
    for (const i of [22, 41, 42, 43, 44, 45]) paint(d, i, 'floor');
    // 21, 22, 41, 42 make a 2 × 2 block; 43–45 are a corridor.
    expect(roomsOf(d).map((r) => r.y * 20 + r.x)).toEqual([21, 22, 41, 42]);
  });
});
