/** Print a dungeon as text: `npm run show -- CODE`. */
import { generateDungeon } from '../src/dungeon';
import { BEDROCK, FLOOR, GOLD, HEAP_FROM, POTION, STAIRS, STRENGTH, TORCH, TRAP, VIGOUR, WALL, CRACKED_HP } from '../src/tiles';

const MONSTER_CHAR = { rat: 'r', goblin: 'g', slime: 's', troll: 'T' } as const;

export function render(code: string): string {
  const d = generateDungeon(code);
  const mon = new Map(d.monsters.map((m) => [m.pos, m.rich ? MONSTER_CHAR[m.kind].toUpperCase() : MONSTER_CHAR[m.kind]]));
  let out = '';
  for (let y = 0; y < d.size; y++) {
    for (let x = 0; x < d.size; x++) {
      const i = y * d.size + x;
      const t = d.tiles[i];
      out += mon.get(i) ?? (
        t === FLOOR ? '.' : t === WALL ? (d.wallHp[i] <= CRACKED_HP ? '%' : '#') : t === BEDROCK ? '█' : t === STAIRS ? '>' :
        t === TRAP ? '^' : t === GOLD ? (d.gold[i] >= HEAP_FROM ? '$' : '¢') : t === POTION ? '!' : t === TORCH ? 'i' :
        t === STRENGTH ? '+' : t === VIGOUR ? 'v' : '?');
    }
    out += '\n';
  }
  return out;
}

export function main(args: string[]) {
  for (const code of args.length ? args : ['ABC123']) console.log(`${code}\n${render(code)}`);
}
