/**
 * Print a dungeon as text: `npm run dungeon -- CODE` (a generated code, or a map code from the editor in quotes).
 * With `--map`, also print each dungeon's map code, to open it in the editor.
 */
import { dungeonFromCode, mapCode } from '../src/mapCode';
import { BEDROCK, FLOOR, GOLD, HEAP_FROM, POTION, STAIRS, STRENGTH, TORCH, TRAP, VIGOUR, WALL, CRACKED_HP } from '../src/tiles';

const MONSTER_CHAR = { rat: 'r', goblin: 'g', slime: 's', troll: 'T' } as const;

export function render(code: string): string {
  const d = dungeonFromCode(code);
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
  const map = args.includes('--map');
  const codes = args.filter((a) => a !== '--map');
  for (const code of codes.length ? codes : ['ABC123']) {
    console.log(`${code}\n${render(code)}${map ? `${mapCode(dungeonFromCode(code))}\n` : ''}`);
  }
}
