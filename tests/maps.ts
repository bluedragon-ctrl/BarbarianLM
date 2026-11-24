/** Build small dungeons and raids from text, for the rules tests. */
import type { Dungeon } from '../src/dungeon';
import {
  BEDROCK, CRACKED_HP, FLOOR, GOLD, MONSTER_STATS, POTION, STAIRS, STRENGTH, TORCH, TRAP, VIGOUR, WALL, WALL_HP,
  type Monster, type MonsterKind, type Tile,
} from '../src/tiles';
import { newRaid, type RaidState } from '../src/world';

const TILE_OF: Record<string, [Tile, number?]> = {
  'B': [BEDROCK], '#': [WALL, WALL_HP], '%': [WALL, CRACKED_HP], '.': [FLOOR], '>': [STAIRS], '^': [TRAP],
  'c': [GOLD, 3], '$': [GOLD, 10], '!': [POTION], 'i': [TORCH], '+': [STRENGTH], 'v': [VIGOUR],
};
const MONSTER_OF: Record<string, MonsterKind> = { r: 'rat', g: 'goblin', s: 'slime', t: 'troll', d: 'dragon' };

/**
 * A map from rows of text, padded with bedrock to a square. `@` is him (on floor, or on the stairs if the map has
 * none); r, g, s, t, d are monsters on floor, in reading order. Every map gets a bedrock ring around it.
 */
export function dungeonFrom(rows: string[], code = 'TEST'): { dungeon: Dungeon; start: number } {
  const inner = rows.map((r) => r.replace(/ /g, ''));
  const size = Math.max(inner.length, ...inner.map((r) => r.length)) + 2;
  const tiles: Tile[] = new Array<Tile>(size * size).fill(BEDROCK);
  const wallHp = new Array<number>(size * size).fill(0);
  const gold = new Array<number>(size * size).fill(0);
  const monsters: Monster[] = [];
  let start = -1;
  let stairs = -1;
  inner.forEach((row, y) => [...row].forEach((ch, x) => {
    const i = (y + 1) * size + x + 1;
    if (ch === '@') { start = i; tiles[i] = FLOOR; return; }
    const kind = MONSTER_OF[ch];
    if (kind) { tiles[i] = FLOOR; monsters.push({ kind, pos: i, hp: MONSTER_STATS[kind].hp, rich: false }); return; }
    const [t, n] = TILE_OF[ch] ?? (() => { throw new Error(`unknown map char ${ch}`); })();
    tiles[i] = t;
    if (t === WALL) wallHp[i] = n!;
    if (t === GOLD) gold[i] = n!;
    if (t === STAIRS) stairs = i;
  }));
  if (stairs < 0) { stairs = start; tiles[start] = STAIRS; }
  if (start < 0) start = stairs;
  return { dungeon: { code, size, tiles, wallHp, gold, stairs, rooms: [], monsters }, start };
}

/**
 * A raid on a map from text, starting at `@`. His stats are fixed at 12 HP and 1 potion, so the rules tests do not
 * follow the tuning of the starting numbers (`RULES`); the start itself is tested on a real dungeon.
 */
export function raidFrom(rows: string[]): RaidState {
  const { dungeon, start } = dungeonFrom(rows);
  const s = newRaid(dungeon);
  s.pos = start;
  s.hp = s.maxHp = 12;
  s.potions = 1;
  return s;
}

/** Tile index of inner-map cell (x, y), counting from 0 inside the bedrock ring. */
export const cell = (s: { map: { size: number } } | { size: number }, x: number, y: number): number => {
  const size = 'map' in s ? s.map.size : s.size;
  return (y + 1) * size + x + 1;
};
