import { describe, expect, it } from 'vitest';
import { generateDungeon, newTreasure, raidDungeon, walkingDistances } from '../src/dungeon';
import { baseCode, cleanCode, codeLabel, dungeonFromCode, isTreasureCode, mapCode, treasureCode } from '../src/mapCode';
import { createModel } from '../src/model';
import { Raid } from '../src/raid';
import { codesFrom } from '../src/raids';
import { TeacherRaid } from '../src/teachers';
import { FLOOR, GOLD, POTION, STRENGTH, TORCH, TRAP, VIGOUR, WALL, isOpen } from '../src/tiles';
import { MEMORY_SIZES, inputSize } from '../src/tokens';

const CONTENTS = new Set<number>([FLOOR, GOLD, POTION, TORCH, STRENGTH, VIGOUR, TRAP]);
/** The walls and stairs: what new treasure never changes. */
const walls = (d: ReturnType<typeof generateDungeon>) => d.tiles.map((t, i) => (CONTENTS.has(t) ? 'open' : `${t}|${d.wallHp[i]}`));

describe('new treasure every raid', () => {
  it('keeps the walls, cracked walls and stairs, and places the contents afresh for each raid', () => {
    for (const code of codesFrom('treasure', 20)) {
      const d = generateDungeon(code);
      const a = newTreasure(d, 1);
      const b = newTreasure(d, 2);
      expect(walls(a)).toEqual(walls(d));
      expect(a.stairs).toBe(d.stairs);
      expect(a.rooms).toEqual(d.rooms);
      expect(newTreasure(d, 1)).toEqual(a);
      expect(a.tiles).not.toEqual(b.tiles);
      // By the generator's own rules: no monster near the stairs, everything reachable, the same kinds of things.
      const far = walkingDistances(a, a.stairs);
      for (const m of a.monsters) expect(far[m.pos]).toBeGreaterThanOrEqual(5);
      a.tiles.forEach((t, i) => { if (isOpen(t)) expect(far[i]).toBeGreaterThanOrEqual(0); });
      expect(a.tiles.filter((t) => t === STRENGTH).length).toBe(d.tiles.filter((t) => t === STRENGTH).length);
      expect(a.monsters.some((m) => m.kind === 'troll' || m.kind === 'dragon')).toBe(true);
    }
  });

  it('leaves the generated dungeon itself alone', () => {
    const d = generateDungeon('KEEP');
    const before = JSON.stringify(d);
    newTreasure(d, 3);
    expect(JSON.stringify(d)).toBe(before);
    expect(raidDungeon(d, 3)).toBe(d);
  });

  it('is marked in the code, never typed, and never for a hand-made dungeon', () => {
    expect(treasureCode('QWERTY')).toBe('QWERTY*');
    expect(treasureCode('QWERTY*')).toBe('QWERTY*');
    expect(baseCode('QWERTY*')).toBe('QWERTY');
    expect(isTreasureCode('QWERTY*')).toBe(true);
    expect(cleanCode('QWERTY*')).toBe('QWERTY');
    expect(codeLabel('QWERTY*')).toBe('QWERTY✦');
    const map = mapCode(generateDungeon('HAND'));
    expect(treasureCode(map)).toBe(map);
    const d = dungeonFromCode('QWERTY*');
    expect(d.treasure).toBe(true);
    expect(d.code).toBe('QWERTY*');
    expect(d.tiles).toEqual(generateDungeon('QWERTY').tiles);
  });

  it('gives his raids and the teachers\' raids of a number the same treasure, a new one for the next', () => {
    const d = dungeonFromCode('QWERTY*');
    const m = createModel(inputSize(MEMORY_SIZES.short), 'treasure');
    const his = new Raid(m, d, 4);
    const teacher = new TeacherRaid(d, 'healer', 4);
    expect(his.state.map.tiles).toEqual(teacher.state.map.tiles);
    expect(his.state.monsters).toEqual(teacher.state.monsters);
    expect(his.state.map.tiles).toEqual(newTreasure(d, 4).tiles);
    expect(new Raid(m, d, 5).state.map.tiles).not.toEqual(his.state.map.tiles);
    // Only the contents differ from the plain dungeon.
    expect(walls({ ...newTreasure(d, 4) })).toEqual(walls(generateDungeon('QWERTY')));
    expect(his.state.map.tiles.filter((t) => t === WALL).length).toBe(generateDungeon('QWERTY').tiles.filter((t) => t === WALL).length);
  });
});

describe('test raids with new treasure', () => {
  it('are numbered past any training raid; with fixed treasure they start at 0', async () => {
    const { evalPlan } = await import('../src/train');
    const { TEST_RAIDS_FROM } = await import('../src/raids');
    expect(evalPlan('QWERTY*')).toMatchObject({ code: 'QWERTY*', from: TEST_RAIDS_FROM });
    expect(evalPlan('QWERTY')).toEqual({ code: 'QWERTY', count: 20 });
  });
});
