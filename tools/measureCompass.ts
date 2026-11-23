/** Stairs-compass numbers over many dungeon codes: `npm run measure:compass -- [count]`. */
import { depths, generateDungeon } from '../src/dungeon';
import { rngFrom, randomCode } from '../src/rng';
import { squareDistance } from '../src/sight';
import { isOpen } from '../src/tiles';
import { COMPASS_FAR_FROM, COMPASS_VERY_FAR_FROM, stairsDirection } from '../src/tokens';

const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`;

export function main(args: string[]) {
  const count = Number(args[0] ?? 1000);
  const rng = rngFrom('measure');
  const walk: number[] = [];
  const straight: number[] = [];
  const dirs = new Array<number>(9).fill(0);
  for (let n = 0; n < count; n++) {
    const d = generateDungeon(randomCode(rng));
    const depth = depths(d);
    for (let i = 0; i < d.tiles.length; i++) {
      if (!isOpen(d.tiles[i]) || depth[i] < 0) continue;
      walk.push(depth[i]);
      straight.push(squareDistance(d.size, i, d.stairs));
      dirs[stairsDirection(d.size, i, d.stairs)]++;
    }
  }
  const total = walk.length;
  const quantile = (xs: number[], q: number) => xs.slice().sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))];
  console.log(`${count} dungeons, ${total} open tiles: distance from the tile to the stairs\n`);
  for (const [name, xs] of [['walking', walk], ['straight-line (square)', straight]] as const) {
    console.log(`${name.padEnd(24)} mean ${(xs.reduce((s, x) => s + x, 0) / total).toFixed(1)}, ` +
      `thirds at ${quantile(xs, 1 / 3)} / ${quantile(xs, 2 / 3)}, max ${quantile(xs, 1)}`);
  }
  const near = walk.filter((x) => x < COMPASS_FAR_FROM).length;
  const veryFar = walk.filter((x) => x >= COMPASS_VERY_FAR_FROM).length;
  console.log(`\nwalking buckets: here or near (< ${COMPASS_FAR_FROM}) ${pct(near, total)}, ` +
    `far ${pct(total - near - veryFar, total)}, very far (${COMPASS_VERY_FAR_FROM}+) ${pct(veryFar, total)}`);
  const ratio = walk.map((w, k) => (straight[k] ? w / straight[k] : 1));
  console.log(`walking / straight-line: mean ${(ratio.reduce((s, x) => s + x, 0) / total).toFixed(2)}, ` +
    `2× or more on ${pct(ratio.filter((r) => r >= 2).length, total)} of tiles, 3× or more on ${pct(ratio.filter((r) => r >= 3).length, total)}`);
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'here'];
  console.log(`directions: ${names.map((nm, k) => `${nm} ${pct(dirs[k], total)}`).join(', ')}`);
}
