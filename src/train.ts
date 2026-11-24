/**
 * Training: lessons (imitation of a teacher, like pretraining on example text) and practice (policy gradient on
 * his own raids, scored by a judge, like fine-tuning with a reward). The worker and any main-thread path use these
 * same functions. Lessons and practice never block actions and never have events. No DOM.
 */
import type { Dungeon } from './dungeon';
import { dungeonFromCode } from './mapCode';
import { adamStep, clearGrads, createAdam, imitationGrad, policyGrad, sgdStep, zeroGrads, type Adam, type Model, type Grads } from './model';
import { Raid, memoryPairs, raid, type EventOptions, type RaidRecord } from './raid';
import { codesFrom, countRaid, manyRaids, newCounts, raidsOf, summary, type RaidCounts, type RaidPlan, type RaidSummary } from './raids';
import { mulberry32, randomCode, shuffle, type Rng } from './rng';
import { MONSTER_STATS, type MonsterKind } from './tiles';
import { TEACHERS, teacherRaid, type TeacherName } from './teachers';
import { encode, newMemory, remember } from './tokens';
import { view, type Action, type RaidState } from './world';

/** The training loop's numbers *(tune)*; the optimisers' own are `TRAINING` in `model.ts`. */
export const LOOP = {
  /** Lesson examples (turns) per Adam step. */
  lessonBatch: 32,
  /** Practice raids are played at this boldness, the same as the gradient's (on-policy): at 0.7 they drifted. */
  practiceTemperature: 1,
  /** Gold is divided by this to make a reward: a good raid (about 45 gold) scores about 0.9. */
  goldScale: 50,
  /** The monsters-beaten judge's reward per point of the beaten monster's full HP: tougher monsters pay more. */
  beatenRewardPerHp: 0.05,
  /** The baseline follows the raid scores, this share of the way each raid. */
  baselineSmoothing: 0.05,
  /** The advantage (reward to go minus the baseline) is clipped to ±this. */
  advantageClip: 1,
  /** Practice raids per SGD step (on the mean gradient over all their turns). */
  practiceBatch: 1,
  /** Raids between progress messages and test points. */
  chunk: 25,
  /** At most about this many test points per job. */
  evalPoints: 20,
  /** Test raids per test point, and their boldness. */
  evalRaids: 20,
  evalTemperature: 0.5,
} as const;

// ── Judges ──────────────────────────────────────────────────────────────────

/** Who scores practice: gold carried out (the real score), gold picked up (reward hacking), monsters beaten. */
export const JUDGES = ['goldOut', 'goldPickedUp', 'monstersBeaten'] as const;
export type Judge = typeof JUDGES[number];
export const JUDGE_LABELS: Record<Judge, string> = {
  goldOut: 'Gold carried out',
  goldPickedUp: 'Gold picked up',
  monstersBeaten: 'Monsters beaten',
};

/** What the monsters-beaten judge pays for one monster: rat 0.1, goblin 0.2, slime 0.3, troll 0.6. */
export const beatenReward = (kind: MonsterKind): number => LOOP.beatenRewardPerHp * MONSTER_STATS[kind].hp;

/**
 * The judge's reward for each turn of a raid. Gold out pays on the last turn, and only if he left; gold picked up
 * pays at each pickup, kept or not; monsters beaten pays at each monster he beats, more for tougher ones.
 */
export function judgeRewards(judge: Judge, r: Pick<RaidRecord, 'state' | 'turns'>): number[] {
  const out = r.turns.map(({ result: x }) => {
    if (judge === 'goldPickedUp') return x.goldGained / LOOP.goldScale;
    if (judge === 'monstersBeaten') return x.beaten ? beatenReward(x.beaten.monster.kind) : 0;
    return 0;
  });
  if (judge === 'goldOut' && out.length && r.state.ended === 'left') out[out.length - 1] = r.state.gold / LOOP.goldScale;
  return out;
}

/** Reward to go: each turn gets the rewards from that turn to the end of the raid. */
export function rewardToGo(rewards: readonly number[]): number[] {
  const out = rewards.slice();
  for (let t = out.length - 2; t >= 0; t--) out[t] += out[t + 1];
  return out;
}

/** Advantage of a turn: its reward to go minus the baseline, clipped to ±1. */
export const advantage = (toGo: number, baseline: number): number =>
  Math.max(-LOOP.advantageClip, Math.min(LOOP.advantageClip, toGo - baseline));

/**
 * The baseline: for each turn number, a running average of the reward to go at that turn, over the judge's raids
 * that reached it. So a turn is compared with what usually still comes from that point of a raid, not with a whole
 * raid's score (which would make every late turn look bad when the judge pays along the way). The first raid to
 * reach a turn sets it; then it moves `baselineSmoothing` of the way each raid. Updates `baseline` in place and
 * returns the values from before this raid.
 */
export function updateBaseline(baseline: number[], toGo: readonly number[]): number[] {
  const before = toGo.map((v, t) => baseline[t] ?? v);
  toGo.forEach((v, t) => { baseline[t] = t < baseline.length ? baseline[t] + LOOP.baselineSmoothing * (v - baseline[t]) : v; });
  return before;
}

// ── Stats ───────────────────────────────────────────────────────────────────

export interface Point { x: number; y: number }
/**
 * A round of test raids: x is the raids trained on so far (lessons and practice), `where` the dungeon code the test
 * raids were in (or `new` for the 20 fixed codes), `phase` the kind of job that ran them.
 */
export interface EvalPoint extends RaidSummary { x: number; where: string; phase: 'lessons' | 'practice' }
/** The judge's mean score over a chunk of practice; x is the practice raids so far. */
export interface ScorePoint extends Point { judge: Judge }

/** Everything training keeps for the charts; a plain object, so it passes to and from the worker. */
export interface TrainStats {
  lessons: number;
  lessonSteps: number;
  practiceRaids: number;
  practiceSteps: number;
  teacherCounts: Partial<Record<TeacherName, number>>;
  judgeRaids: Partial<Record<Judge, number>>;
  /** Each judge's baseline by turn number (a judge's scores mean nothing to another). */
  baselines: Partial<Record<Judge, number[]>>;
  /** Mean imitation loss per chunk of lessons. */
  lessonLoss: Point[];
  /** Mean judge score per chunk of practice. */
  practiceScore: ScorePoint[];
  evals: EvalPoint[];
}

export const newStats = (): TrainStats => ({
  lessons: 0, lessonSteps: 0, practiceRaids: 0, practiceSteps: 0, teacherCounts: {}, judgeRaids: {}, baselines: {},
  lessonLoss: [], practiceScore: [], evals: [],
});

const raidsSoFar = (s: TrainStats) => s.lessons + s.practiceRaids;

// ── Where training raids happen ─────────────────────────────────────────────

/**
 * Training raids happen in one dungeon (raid numbers counting up) or, with no code, each in a new dungeon from the
 * job's random stream (so he learns raiding, not one map).
 */
function nextDungeon(code: string | undefined, rng: Rng, cache: Map<string, Dungeon>, n: number): [Dungeon, number] {
  const c = code ?? randomCode(rng);
  let d = cache.get(c);
  if (!d) {
    d = dungeonFromCode(c);
    if (code) cache.set(c, d);
  }
  return [d, code ? n : 0];
}

/** The test raids: 20 fixed codes, or raids 0–19 of the one training dungeon. */
export const evalPlan = (code?: string): RaidPlan =>
  code ? { code, count: LOOP.evalRaids } : { codes: codesFrom('eval', LOOP.evalRaids) };

/** Where test raids happen, as `EvalPoint.where` names it. */
export const testsIn = (code?: string): string => code ?? 'new';

export function evaluate(model: Model, x: number, code?: string, phase: EvalPoint['phase'] = 'lessons'): EvalPoint {
  return { x, where: testsIn(code), phase, ...summary(manyRaids(model, evalPlan(code), { temperature: LOOP.evalTemperature })) };
}

/**
 * A teacher's numbers on the same test raids as his (`evalPlan`), to show next to his: the teacher plays each raid
 * as in its lessons (the pickaxe dwarf with his own pickaxe). Teachers have no randomness, so this is fixed for a
 * teacher and a dungeon code.
 */
export function teacherTests(teacher: TeacherName, code?: string): RaidSummary {
  const c = newCounts();
  for (const [d, n] of raidsOf(evalPlan(code))) countRaid(c, teacherRaid(d, teacher, n));
  return summary(c);
}

/** Test before a job starts, unless there already is a test at this point in this place (the chart's first bar). */
export function testFirst(model: Model, stats: TrainStats, code: string | undefined, phase: EvalPoint['phase']): void {
  const x = raidsSoFar(stats);
  if (!stats.evals.some((e) => e.x === x && e.where === testsIn(code))) stats.evals.push(evaluate(model, x, code, phase));
}

/** Test after this raid of a job? About `evalPoints` times a job, always after the last. */
const testAfter = (i: number, count: number) => {
  const every = Math.max(LOOP.chunk, Math.ceil(count / LOOP.evalPoints / LOOP.chunk) * LOOP.chunk);
  return (i + 1) % every === 0 || i === count - 1;
};

export interface ChunkInfo { done: number }

// ── Lessons ─────────────────────────────────────────────────────────────────

export interface Example { input: number[]; action: Action }

/**
 * One lesson: the teacher plays raid `n` of the dungeon through the same `step` (the pickaxe dwarf with his own
 * pickaxe), and each turn's input, memory strip included, is paired with the teacher's action.
 */
export function lessonExamples(d: Dungeon, teacher: TeacherName, n: number, pairs: number): { examples: Example[]; state: RaidState } {
  const memory = newMemory(pairs);
  const examples: Example[] = [];
  const { state } = teacherRaid(d, teacher, n, {
    beforeStep: (s, action) => {
      const v = view(s);
      examples.push({ input: encode(s, v, memory), action });
      remember(memory, v, action);
    },
  });
  return { examples, state };
}

/** A lesson job's working state: the optimiser and the gradients of a batch not yet full. */
export interface LessonState { adam: Adam; grads: Grads; inBatch: number }

export const newLessonState = (model: Model, adam = createAdam(model)): LessonState => ({ adam, grads: zeroGrads(model), inBatch: 0 });

/** Learn from one lesson's examples, in shuffled order, an Adam step every `lessonBatch`. Returns the summed loss. */
export function learnFromLesson(model: Model, ls: LessonState, examples: Example[], rng: Rng): number {
  let loss = 0;
  for (const e of shuffle(rng, examples.slice())) {
    loss += imitationGrad(model, ls.grads, e.input, e.action);
    if (++ls.inBatch === LOOP.lessonBatch) flushLessons(model, ls);
  }
  return loss;
}

/** The Adam step for a batch that is not full (at the end of a job). */
export function flushLessons(model: Model, ls: LessonState): void {
  if (ls.inBatch) adamStep(model, ls.adam, ls.grads, undefined, 1 / ls.inBatch);
  else clearGrads(ls.grads, model.nH);
  ls.inBatch = 0;
}

export function trainLessons(
  model: Model, adam: Adam, teacher: TeacherName, count: number, stats: TrainStats, rng: Rng,
  o: { dungeon?: string; onChunk?: (info: ChunkInfo) => void; test?: boolean } = {},
): void {
  const pairs = memoryPairs(model);
  const ls = newLessonState(model, adam);
  const cache = new Map<string, Dungeon>();
  let lossSum = 0;
  let lossN = 0;
  for (let i = 0; i < count; i++) {
    const [d, n] = nextDungeon(o.dungeon, rng, cache, raidsSoFar(stats));
    const { examples } = lessonExamples(d, teacher, n, pairs);
    lossSum += learnFromLesson(model, ls, examples, rng);
    lossN += examples.length;
    stats.lessons++;
    stats.lessonSteps += examples.length;
    stats.teacherCounts[teacher] = (stats.teacherCounts[teacher] ?? 0) + 1;
    if ((i + 1) % LOOP.chunk === 0 || i === count - 1) {
      if (i === count - 1) flushLessons(model, ls);
      stats.lessonLoss.push({ x: stats.lessons, y: lossSum / Math.max(1, lossN) });
      lossSum = lossN = 0;
      if (o.test !== false && testAfter(i, count)) stats.evals.push(evaluate(model, raidsSoFar(stats), o.dungeon, 'lessons'));
      o.onChunk?.({ done: i + 1 });
    }
  }
}

/** Mean imitation loss on a teacher's raids, without learning (for tests and measuring). */
export function lessonLoss(model: Model, teacher: TeacherName, codes: readonly string[]): number {
  const pairs = memoryPairs(model);
  const g = zeroGrads(model);
  let loss = 0;
  let n = 0;
  for (const code of codes) {
    for (const e of lessonExamples(dungeonFromCode(code), teacher, 0, pairs).examples) {
      loss += imitationGrad(model, g, e.input, e.action);
      n++;
    }
    clearGrads(g, model.nH);
  }
  return loss / Math.max(1, n);
}

// ── Practice ────────────────────────────────────────────────────────────────

/** Practice's working state: the gradients of the raids since the last SGD step. */
export interface PracticeState { grads: Grads; raids: number; turns: number }

export const newPracticeState = (model: Model): PracticeState => ({ grads: zeroGrads(model), raids: 0, turns: 0 });

/** The SGD step on the mean gradient over every turn of the batch's raids. */
export function flushPractice(model: Model, ps: PracticeState): void {
  if (ps.turns) sgdStep(model, ps.grads, undefined, 1 / ps.turns);
  else clearGrads(ps.grads, model.nH);
  ps.raids = ps.turns = 0;
}

/** A practice raid: his own, at the practice boldness, never blocked. */
export const practiceRaid = (model: Model, d: Dungeon, n: number): RaidRecord =>
  new Raid(model, d, n, { temperature: LOOP.practiceTemperature }).run();

/**
 * Learn from one finished practice raid: the judge scores each turn, each action is credited with its reward to
 * go minus the judge's baseline for that turn (clipped to ±1), and one SGD step takes the raid's mean gradient. The model has not
 * changed during the raid, so the gradient is the one of the raid's own choices. Returns the raid's score.
 */
export function learnFromRaid(model: Model, r: RaidRecord, judge: Judge, stats: TrainStats, ps?: PracticeState): number {
  const toGo = rewardToGo(judgeRewards(judge, r));
  const score = toGo.length ? toGo[0] : 0;
  const baseline = updateBaseline(stats.baselines[judge] ??= [], toGo);
  const own = ps ?? newPracticeState(model);
  r.turns.forEach((t, k) => policyGrad(model, own.grads, t.input, t.action, advantage(toGo[k], baseline[k])));
  own.raids++;
  own.turns += r.turns.length;
  if (!ps || own.raids >= LOOP.practiceBatch) flushPractice(model, own);
  stats.practiceRaids++;
  stats.practiceSteps += r.turns.length;
  stats.judgeRaids[judge] = (stats.judgeRaids[judge] ?? 0) + 1;
  return score;
}

export function trainPractice(
  model: Model, judge: Judge, count: number, stats: TrainStats, rng: Rng,
  o: { dungeon?: string; onChunk?: (info: ChunkInfo) => void; test?: boolean } = {},
): RaidCounts {
  const cache = new Map<string, Dungeon>();
  const counts = newCounts();
  const ps = newPracticeState(model);
  let scoreSum = 0;
  let scoreN = 0;
  for (let i = 0; i < count; i++) {
    const [d, n] = nextDungeon(o.dungeon, rng, cache, raidsSoFar(stats));
    const r = practiceRaid(model, d, n);
    countRaid(counts, r);
    scoreSum += learnFromRaid(model, r, judge, stats, ps);
    if (i === count - 1) flushPractice(model, ps);
    scoreN++;
    if ((i + 1) % LOOP.chunk === 0 || i === count - 1) {
      stats.practiceScore.push({ x: stats.practiceRaids, y: scoreSum / scoreN, judge });
      scoreSum = scoreN = 0;
      if (o.test !== false && testAfter(i, count)) stats.evals.push(evaluate(model, raidsSoFar(stats), o.dungeon, 'practice'));
      o.onChunk?.({ done: i + 1 });
    }
  }
  return counts;
}

// ── Jobs (what the worker runs) ─────────────────────────────────────────────

interface JobCommon { model: Model; stats: TrainStats; count: number; seed: number; dungeon?: string }
export type WorkerRequest =
  | (JobCommon & { kind: 'lessons'; teacher: TeacherName; adam?: Adam })
  | (JobCommon & { kind: 'practice'; judge: Judge })
  /**
   * Many raids: his raids of the plan, and with `teacher` that teacher's raids of the same dungeons and raid numbers
   * (as in its lessons: no events), raid by raid, so the progress has both.
   */
  | { kind: 'raids'; model: Model; plan: RaidPlan; temperature: number; block: boolean; events?: boolean | EventOptions; teacher?: TeacherName }
  /** The teachers' numbers on the test raids (in `dungeon`, or the fixed codes). */
  | { kind: 'teachers'; teachers: readonly TeacherName[]; dungeon?: string };

export type TeacherTests = Partial<Record<TeacherName, RaidSummary>>;

export type WorkerResponse =
  | { type: 'progress'; done: number; total: number; stats?: TrainStats; counts?: RaidCounts; teacherCounts?: RaidCounts; teachers?: TeacherTests }
  | { type: 'done'; model: Model; stats: TrainStats; adam?: Adam }
  | { type: 'raidsDone'; counts: RaidCounts; teacherCounts?: RaidCounts }
  | { type: 'teachersDone'; teachers: TeacherTests }
  | { type: 'error'; message: string };

/**
 * Run one job and post its messages: progress after every chunk (after every teacher for `teachers`), then `done`
 * (or `raidsDone`, `teachersDone`), or `error`. A training job tests first if there is no test at its starting point
 * yet, so its chart starts from where he was. The worker is this function on `self.onmessage`; tests call it directly.
 */
export function runJob(req: WorkerRequest, post: (msg: WorkerResponse) => void): void {
  try {
    if (req.kind === 'raids') {
      if (req.teacher && !TEACHERS.includes(req.teacher)) throw new Error(`No teacher called ${req.teacher}`);
      const total = 'code' in req.plan ? req.plan.count : req.plan.codes.length;
      const options = { temperature: req.temperature, block: req.block, events: req.events };
      const counts = newCounts();
      const teacher = req.teacher ? newCounts() : undefined;
      for (const [d, n] of raidsOf(req.plan)) {
        countRaid(counts, raid(req.model, d, n, options));
        if (teacher) countRaid(teacher, teacherRaid(d, req.teacher!, n));
        if (counts.raids % LOOP.chunk === 0 && counts.raids < total) {
          post({ type: 'progress', done: counts.raids, total, counts: { ...counts }, teacherCounts: teacher && { ...teacher } });
        }
      }
      post({ type: 'raidsDone', counts, teacherCounts: teacher });
      return;
    }
    if (req.kind === 'teachers') {
      const out: TeacherTests = {};
      req.teachers.forEach((name, k) => {
        if (!TEACHERS.includes(name)) throw new Error(`No teacher called ${name}`);
        out[name] = teacherTests(name, req.dungeon);
        if (k < req.teachers.length - 1) post({ type: 'progress', done: k + 1, total: req.teachers.length, teachers: { ...out } });
      });
      post({ type: 'teachersDone', teachers: out });
      return;
    }
    if (req.kind === 'lessons' && !TEACHERS.includes(req.teacher)) throw new Error(`No teacher called ${req.teacher}`);
    if (req.kind === 'practice' && !JUDGES.includes(req.judge)) throw new Error(`No judge called ${req.judge}`);
    const { model, stats, count, dungeon } = req;
    const rng = mulberry32(req.seed);
    const onChunk = (info: ChunkInfo) => post({ type: 'progress', done: info.done, total: count, stats });
    testFirst(model, stats, dungeon, req.kind);
    if (req.kind === 'lessons') {
      const adam = req.adam ?? createAdam(model);
      trainLessons(model, adam, req.teacher, count, stats, rng, { dungeon, onChunk });
      post({ type: 'done', model, stats, adam });
    } else {
      trainPractice(model, req.judge, count, stats, rng, { dungeon, onChunk });
      post({ type: 'done', model, stats });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}
