/**
 * Corrected raids against plain lessons: `npm run measure:corrected -- [lessons] [corrected] [test raids]`.
 *
 * For each teacher (medium memory unless --memory), a fresh model takes:
 *   1. `lessons` lessons;
 *   2. twice as many lessons (the same number of raids as 3);
 *   3. `lessons` lessons, then `corrected` corrected raids (he plays, the teacher says what it would do);
 *   4. `lessons + corrected` corrected raids from nothing.
 * Then each raids alone on the test codes (or the test raids of --dungeon CODE), block off.
 *
 * Options: --memory, --hidden N (hidden units, default 48), --seed N (another fresh model and lesson order), --teachers a,b, --dungeon CODE, --temperature T (test boldness), --loop '{json}', --skip 1,4.
 */
import { createAdam, createModel, type Model } from '../src/model';
import { codesFrom, manyRaids, summary, testRaids, type RaidSummary } from '../src/raids';
import { mulberry32 } from '../src/rng';
import { type TeacherName } from '../src/teachers';
import { MEMORY_SIZES, inputSize, type MemoryName } from '../src/tokens';
import { LOOP, lessonLoss, newStats, trainLessons } from '../src/train';

const opt = (args: string[], name: string) => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : undefined; };

const HEAD = 'gold out   left  left/0   k.o. locked  turns  wasted  picked  beaten';
function line(s: RaidSummary): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(5);
  const f = (v: number, d = 1) => v.toFixed(d).padStart(6);
  return `${f(s.goldOut)}   ${pct(s.left)}  ${pct(s.leftNoGold)}  ${pct(s.knockedOut)}  ${pct(s.lockedIn)} ${f(s.turns, 0)}  ${f(s.wasted)}  ${f(s.goldPickedUp)}  ${f(s.beaten)}`;
}

export function main(args: string[]) {
  if (opt(args, '--loop')) Object.assign(LOOP as Record<string, number>, JSON.parse(opt(args, '--loop')!));
  const pos = args.filter((a, k) => !a.startsWith('--') && !args[k - 1]?.startsWith('--'));
  const lessons = Number(pos[0] ?? 1000);
  const corrected = Number(pos[1] ?? 1000);
  const tests = Number(pos[2] ?? 200);
  const temperature = Number(opt(args, '--temperature') ?? LOOP.evalTemperature);
  const memory = (opt(args, '--memory') ?? 'medium') as MemoryName;
  const teachers = (opt(args, '--teachers')?.split(',') ?? ['healer', 'champion', 'warrior']) as TeacherName[];
  const skip = (opt(args, '--skip')?.split(',') ?? []).map(Number);
  const dungeon = opt(args, '--dungeon');
  const codes = codesFrom('measure-training', tests);
  const plan = dungeon ? testRaids(dungeon, tests) : { codes };
  const test = (m: Model) => summary(manyRaids(m, plan, { temperature }));
  console.log(`${memory} memory, ${opt(args, '--hidden') ?? 48} hidden; ${tests} test ${dungeon ? `raids in ${dungeon}` : 'codes'} at boldness ${temperature}; ` +
    `corrected raids at boldness ${LOOP.correctedTemperature}\n`);
  console.log(`${'teacher'.padEnd(10)} ${'training'.padEnd(34)} loss   ${HEAD}`);
  for (const teacher of teachers) {
    const runs: [number, string, [number, boolean][]][] = [
      [1, `${lessons} lessons`, [[lessons, false]]],
      [2, `${2 * lessons} lessons`, [[2 * lessons, false]]],
      [3, `${lessons} lessons + ${corrected} corrected`, [[lessons, false], [corrected, true]]],
      [4, `${lessons + corrected} corrected`, [[lessons + corrected, true]]],
    ];
    for (const [k, label, parts] of runs) {
      if (skip.includes(k)) continue;
      const t0 = Date.now();
      const seed = Number(opt(args, '--seed') ?? 1);
      const m = createModel(inputSize(MEMORY_SIZES[memory]), seed === 1 ? 'measure' : `measure${seed}`, Number(opt(args, '--hidden') ?? 48));
      const adam = createAdam(m);
      const stats = newStats();
      parts.forEach(([count, c], i) => trainLessons(m, adam, teacher, count, stats, mulberry32(seed * 100 + 1 + i), { test: false, dungeon, corrected: c }));
      const loss = lessonLoss(m, teacher, dungeon ? [dungeon] : codes.slice(0, 20)).toFixed(2);
      const s = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`${teacher.padEnd(10)} ${label.padEnd(34)} ${loss}   ${line(test(m))}   ${s} s`);
    }
  }
}
