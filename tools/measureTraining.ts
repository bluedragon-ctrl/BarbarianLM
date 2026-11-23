/**
 * What training does, over many dungeon codes: `npm run measure:training -- [lessons] [practice] [test raids]`.
 *
 * 1. Lessons: a fresh model takes `lessons` lessons (each in a new dungeon) from each teacher at each memory size,
 *    then raids alone on the test codes, with "Block impossible actions" off and on.
 * 2. Practice: a model taught by the healer (medium memory) practises `practice` raids with each judge.
 *
 * Options: --memory short|medium|long (only that size), --teachers a,b (only those), --skip-lessons,
 * --skip-practice, --temperature T (test raids' boldness, default the training tests'), --dungeon CODE (all in one
 * dungeon), --practice-from NAME (the teacher whose lessons practice starts from, default the healer),
 * --judges a,b (only those), --rules '{json}' (other game numbers), --training '{json}' and --loop '{json}' (other training numbers).
 */
import { RULES } from '../src/world';
import { createModel, type Model } from '../src/model';
import { codesFrom, manyRaids, summary, type RaidSummary } from '../src/raids';
import { mulberry32 } from '../src/rng';
import { TEACHERS, type TeacherName } from '../src/teachers';
import { MEMORY_SIZES, inputSize, type MemoryName } from '../src/tokens';
import { JUDGES, LOOP, lessonLoss, newStats, trainLessons, trainPractice } from '../src/train';
import { TRAINING, createAdam } from '../src/model';

const opt = (args: string[], name: string) => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : undefined; };
const clone = (m: Model): Model => ({ ...m, w1: m.w1.slice(), b1: m.b1.slice(), w2: m.w2.slice(), b2: m.b2.slice() });

const HEAD = 'gold out   left  left/0   k.o. locked  turns potions torches  walls wasted  waits  picked  beaten';
function line(s: RaidSummary): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(5);
  const f = (v: number, d = 1) => v.toFixed(d).padStart(6);
  return `${f(s.goldOut)}   ${pct(s.left)}  ${pct(s.leftNoGold)}  ${pct(s.knockedOut)}  ${pct(s.lockedIn)} ${f(s.turns, 0)}  ` +
    `${f(s.potions, 2)}  ${f(s.torches, 2)} ${f(s.walls)} ${f(s.wasted)} ${f(s.waits)}  ${f(s.goldPickedUp)}  ${f(s.beaten)}`;
}

export function main(args: string[]) {
  // Try other training numbers: --training '{"sgdLearningRate":0.2}', --loop '{"practiceTemperature":1}'.
  if (opt(args, '--training')) Object.assign(TRAINING as Record<string, number>, JSON.parse(opt(args, '--training')!));
  if (opt(args, '--loop')) Object.assign(LOOP as Record<string, number>, JSON.parse(opt(args, '--loop')!));
  // ... and game numbers: --rules '{"timeLimit":150}'.
  if (opt(args, '--rules')) Object.assign(RULES as Record<string, number>, JSON.parse(opt(args, '--rules')!));
  const pos = args.filter((a, k) => !a.startsWith('--') && !args[k - 1]?.startsWith('--'));
  const lessons = Number(pos[0] ?? 300);
  const practice = Number(pos[1] ?? 1000);
  const tests = Number(pos[2] ?? 200);
  const temperature = Number(opt(args, '--temperature') ?? LOOP.evalTemperature);
  const mem = opt(args, '--memory') as MemoryName | undefined;
  const memories = mem ? [mem] : (Object.keys(MEMORY_SIZES) as MemoryName[]);
  const teachers = (opt(args, '--teachers')?.split(',') ?? TEACHERS) as TeacherName[];
  // --dungeon CODE: lessons, practice and tests all in that one dungeon (tests are its raids 0, 1, 2…).
  const dungeon = opt(args, '--dungeon');
  const codes = codesFrom('measure-training', tests);
  const plan = dungeon ? { code: dungeon, count: tests } : { codes };
  const test = (m: Model, block = false) => summary(manyRaids(m, plan, { temperature, block }));
  console.log(`${lessons} lessons, ${practice} practice raids; ${tests} test ${dungeon ? `raids in ${dungeon}` : 'codes'} at boldness ${temperature}\n`);

  if (!args.includes('--skip-lessons')) {
    console.log(`after lessons      memory  loss  block  ${HEAD}`);
    const before = createModel(inputSize(MEMORY_SIZES.medium), 'measure');
    console.log(`${'(untrained)'.padEnd(18)} medium    —     off  ${line(test(before))}`);
    for (const memory of memories) {
      for (const teacher of teachers) {
        const t0 = Date.now();
        const m = createModel(inputSize(MEMORY_SIZES[memory]), 'measure');
        trainLessons(m, createAdam(m), teacher, lessons, newStats(), mulberry32(1), { test: false, dungeon });
        const loss = lessonLoss(m, teacher, dungeon ? [dungeon] : codes.slice(0, 20)).toFixed(2);
        for (const block of [false, true]) {
          console.log(`${teacher.padEnd(18)} ${memory.padEnd(7)} ${loss}  ${block ? ' on' : 'off'}  ${line(test(m, block))}`);
        }
        if (args.includes('--time')) console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
    }
    console.log();
  }

  if (!args.includes('--skip-practice')) {
    const base = createModel(inputSize(MEMORY_SIZES.medium), 'measure');
    // --practice-from NAME: practice starts from this teacher's lessons (default the healer's).
    const from = (opt(args, '--practice-from') ?? 'healer') as TeacherName;
    trainLessons(base, createAdam(base), from, lessons, newStats(), mulberry32(1), { test: false, dungeon });
    console.log(`${`practice (${from}'s lessons, medium)`.padEnd(41)}  ${HEAD}`);
    console.log(`${'before'.padEnd(40)}  ${line(test(base))}`);
    const judges = (opt(args, '--judges')?.split(',') ?? JUDGES) as typeof JUDGES[number][];
    for (const judge of judges) {
      const m = clone(base);
      const stats = newStats();
      const marks = [practice / 4, practice / 2, practice].map(Math.round);
      let done = 0;
      for (const upTo of marks) {
        trainPractice(m, judge, upTo - done, stats, mulberry32(2 + done), { test: false, dungeon });
        done = upTo;
        console.log(`${`${judge} after ${done}`.padEnd(40)}  ${line(test(m))}`);
      }
    }
  }
}
