/** Numbers over many dungeon codes: `npm run measure:dungeons -- [count]`. */
import { depths, digSaving, generateDungeon, roomTiles, sideNeighbours } from '../src/dungeon';
import { rngFrom, randomCode } from '../src/rng';
import { CRACKED_HP, GOLD, MONSTER_KINDS, POTION, STRENGTH, TORCH, TRAP, VIGOUR, WALL, isOpen, monsterGold } from '../src/tiles';

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const fmt = (x: number) => (Math.round(x * 10) / 10).toString();
const range = (xs: number[]) => `${fmt(mean(xs))} (${Math.min(...xs)}–${Math.max(...xs)})`;

export function measure(count: number) {
  const rng = rngFrom('measure');
  const rows: Record<string, number[]> = {};
  const add = (k: string, v: number) => (rows[k] ??= []).push(v);
  for (let n = 0; n < count; n++) {
    const d = generateDungeon(randomCode(rng));
    const depth = depths(d);
    const maxDepth = Math.max(...depth);
    const open = d.tiles.map((_, i) => i).filter((i) => isOpen(d.tiles[i]));
    const inRoom = new Set(d.rooms.flatMap((r) => roomTiles(d.size, r)));
    add('rooms', d.rooms.length);
    add('open tiles', open.length);
    add('corridor tiles', open.filter((i) => !inRoom.has(i)).length);
    add('dead ends', open.filter((i) => sideNeighbours(d.size, i).filter((j) => isOpen(d.tiles[j])).length === 1).length);
    add('deepest tile', maxDepth);
    const tileGold = open.reduce((s, i) => s + (d.tiles[i] === GOLD ? d.gold[i] : 0), 0);
    const monGold = d.monsters.reduce((s, m) => s + monsterGold(m), 0);
    add('gold on floor', tileGold);
    add('gold on monsters', monGold);
    add('gold total', tileGold + monGold);
    const third = (i: number) => Math.min(2, Math.floor((depth[i] / maxDepth) * 3));
    const byThird = [0, 0, 0];
    for (const i of open) if (d.tiles[i] === GOLD) byThird[third(i)] += d.gold[i];
    for (const m of d.monsters) byThird[third(m.pos)] += monsterGold(m);
    byThird.forEach((g, k) => add(`gold, ${['near', 'middle', 'far'][k]} third`, g));
    for (const kind of MONSTER_KINDS) add(`${kind}s`, d.monsters.filter((m) => m.kind === kind).length);
    add('rich monsters', d.monsters.filter((m) => m.rich).length);
    add('nearest monster (steps)', Math.min(...d.monsters.map((m) => depth[m.pos])));
    for (const [name, t] of [['potions', POTION], ['torches', TORCH], ['strength', STRENGTH], ['vigour', VIGOUR], ['traps', TRAP]] as const) {
      add(name, open.filter((i) => d.tiles[i] === t).length);
    }
    const cracked = d.tiles.map((_, i) => i).filter((i) => d.tiles[i] === WALL && d.wallHp[i] <= CRACKED_HP);
    add('cracked walls', cracked.length);
    for (const c of cracked) add('steps a cracked wall saves', digSaving(d, c));
    add('walls saving 8+ steps', d.tiles.map((_, i) => i).filter((i) => digSaving(d, i) >= 8).length);
  }
  return rows;
}

export function main(args: string[]) {
  const count = Number(args[0] ?? 1000);
  const rows = measure(count);
  console.log(`${count} dungeons: mean (min–max)\n`);
  for (const [k, v] of Object.entries(rows)) console.log(`${k.padEnd(28)} ${range(v)}`);
  const share = (k: string, f: (x: number) => boolean) => `${Math.round((rows[k].filter(f).length / count) * 100)}%`;
  console.log(`\nno cracked wall: ${share('cracked walls', (x) => x === 0)}; fewer than 7 rooms: ${share('rooms', (x) => x < 7)}`);
}
