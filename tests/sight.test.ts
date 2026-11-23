import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { randInt, randomCode, rngFrom } from '../src/rng';
import { DARK, MONSTER_VIEW_KIND, VIEW_KINDS, lineClear, seenTiles, sees, squareDistance } from '../src/sight';
import { FLOOR, SHOWN, WALL } from '../src/tiles';
import { RULES, newRaid, view } from '../src/world';
import { cell, raidFrom } from './maps';

/** The design's 5 × 5 table: whether outer cell (dx, dy) is seen, given which cells are open. */
function tableSays(dx: number, dy: number, open: (x: number, y: number) => boolean): boolean {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (ax <= 1 && ay <= 1) return true; // his tile and his 8 neighbours
  if (ay === 0) return open(sx, 0); // (±2, 0)
  if (ax === 0) return open(0, sy); // (0, ±2)
  if (ax === 2 && ay === 2) return open(sx, sy); // corners: the diagonal cell
  if (ax === 2) return open(sx, 0) || open(sx, sy); // (±2, ±1): either cell next to the line
  return open(0, sy) || open(sx, sy); // (±1, ±2)
}

const EMPTY_5 = ['.....', '.....', '..@..', '.....', '.....'];

describe('sight', () => {
  it('matches the 5 × 5 table cell by cell, over many wall layouts', () => {
    const rng = rngFrom('sight table');
    for (let trial = 0; trial < 3000; trial++) {
      const s = raidFrom(EMPTY_5);
      s.torchLeft = RULES.torchTurns;
      const walls = new Set<string>();
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if ((dx || dy) && randInt(rng, 2)) {
            walls.add(`${dx},${dy}`);
            s.map.tiles[cell(s, 2 + dx, 2 + dy)] = WALL;
          }
        }
      }
      const v = view(s);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const seen = v[(dy + 2) * 5 + dx + 2].kind !== DARK;
          expect(seen, `cell (${dx}, ${dy}), walls ${[...walls].join(' ')}`).toBe(tableSays(dx, dy, (x, y) => !walls.has(`${x},${y}`)));
        }
      }
    }
  });

  it('sees the wall that blocks the way', () => {
    const s = raidFrom(['.....', '.....', '..@#.', '.....', '.....']);
    s.torchLeft = RULES.torchTurns;
    const v = view(s);
    expect(v[2 * 5 + 3].kind).toBe(SHOWN.stone);
    expect(v[2 * 5 + 4].kind).toBe(DARK);
  });

  it('shows 3 × 3 unlit and 5 × 5 lit, his own tile included', () => {
    const s = raidFrom(EMPTY_5);
    const dark = view(s);
    expect(dark.length).toBe(25);
    dark.forEach((c, k) => {
      const inner = Math.abs((k % 5) - 2) <= 1 && Math.abs(Math.floor(k / 5) - 2) <= 1;
      expect(c.kind === DARK).toBe(!inner);
    });
    expect(dark[12].kind).toBe(SHOWN.stairs);
    s.torchLeft = 1;
    expect(view(s).every((c) => c.kind !== DARK)).toBe(true);
  });

  it('is not blocked by monsters, and a monster hides what it stands on', () => {
    const s = raidFrom(['.....', '.....', '..@g.', '.....', '.....']);
    s.torchLeft = RULES.torchTurns;
    s.map.tiles[s.monsters[0].pos] = 6; // a potion under the goblin
    s.monsters[0].hp = 2;
    s.monsters[0].rich = true;
    const v = view(s);
    expect(v[2 * 5 + 3]).toEqual({ kind: MONSTER_VIEW_KIND('goblin'), wounded: true, rich: true });
    expect(v[2 * 5 + 4].kind).toBe(SHOWN.floor);
    expect(VIEW_KINDS).toBe(17);
  });

  it('is the same both ways round, over random dungeons', () => {
    const rng = rngFrom('sight symmetry');
    const odd: string[] = [];
    let checked = 0;
    for (let k = 0; k < 30; k++) {
      const d = generateDungeon(randomCode(rng));
      const map = { size: d.size, tiles: d.tiles.slice() };
      // Dig out some walls so there are odd shapes too.
      for (let n = 0; n < 40; n++) {
        const i = randInt(rng, map.tiles.length);
        if (map.tiles[i] === WALL) map.tiles[i] = FLOOR;
      }
      for (let a = 0; a < map.tiles.length; a++) {
        for (let b = a + 1; b < map.tiles.length; b++) {
          if (squareDistance(map.size, a, b) > 5) continue;
          checked++;
          if (lineClear(map, a, b) !== lineClear(map, b, a)) odd.push(`${d.code}: ${a} ${b}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(100000);
    expect(odd).toEqual([]);
  });

  it('uses range as a square', () => {
    const s = raidFrom(['.......', '.......', '.......', '...@...', '.......', '.......', '.......']);
    expect(sees(s.map, s.pos, cell(s, 6, 6), 3)).toBe(true);
    expect(sees(s.map, s.pos, cell(s, 6, 6), 2)).toBe(false);
  });
});

describe('seen tiles', () => {
  it('are exactly the cells of his view that are not dark', () => {
    const rng = rngFrom('seen-tiles');
    for (let n = 0; n < 20; n++) {
      const d = generateDungeon(randomCode(rng));
      const open = d.tiles.map((_, i) => i).filter((i) => d.tiles[i] !== 2);
      const pos = open[randInt(rng, open.length)];
      for (const lit of [false, true]) {
        const v = view({ ...newRaid(d), pos, torchLeft: lit ? 5 : 0 });
        const size = d.size;
        const fromView = v.flatMap((c, k) => (c.kind === DARK ? [] : [pos + (Math.floor(k / 5) - 2) * size + (k % 5) - 2]));
        expect(seenTiles({ ...d, pos, lit })).toEqual(fromView);
      }
    }
  });
});
