/**
 * His model and its training for the page: the model, its Adam state and stats, the one training job running in
 * the worker, and the teachers' numbers on his test raids. All training goes through `runJob` in the worker
 * (`runInWorker`); Stop throws the unfinished job away, so he is as he was before it.
 */
import { createModel, type Adam, type Model } from '../model';
import { TEACHERS, type TeacherName } from '../teachers';
import { MEMORY_SIZES, inputSize, type MemoryName } from '../tokens';
import { newStats, testsIn, type Judge, type TeacherTests, type TrainStats } from '../train';
import { runInWorker } from '../workerClient';

export interface Job {
  kind: 'lessons' | 'practice';
  done: number;
  total: number;
  /** The stats as the job's last progress message had them. */
  stats: TrainStats;
  cancel: () => void;
}

/** What a finished practice job did, for the line under its charts. */
export interface PracticeResult {
  judge: Judge;
  scoreBefore: number | null;
  scoreAfter: number;
  goldBefore: number;
  goldAfter: number;
}

const seed = () => (Math.random() * 2 ** 32) >>> 0;

export class Trainer {
  model: Model;
  adam: Adam | undefined;
  stats: TrainStats = newStats();
  memory: MemoryName;
  job: Job | null = null;
  lastPractice: PracticeResult | null = null;
  /** The teachers' numbers by where the test raids are (a code, or `new`). */
  private readonly teacherTests = new Map<string, TeacherTests>();
  private readonly measuring = new Set<string>();
  /** Teachers measured so far while the rest are still being measured. */
  private readonly partial = new Map<string, TeacherTests>();

  constructor(memory: MemoryName, private readonly changed: () => void) {
    this.memory = memory;
    this.model = createModel(inputSize(MEMORY_SIZES[memory]), seed());
  }

  get trained(): boolean { return this.stats.lessons + this.stats.practiceRaids > 0; }
  get busy(): boolean { return this.job !== null; }
  /** The stats to show: the running job's, else his. */
  get shown(): TrainStats { return this.job?.stats ?? this.stats; }

  /** A fresh, untrained model with this memory: the memory fixes the model's size. */
  fresh(memory: MemoryName = this.memory): void {
    this.stop();
    this.memory = memory;
    this.model = createModel(inputSize(MEMORY_SIZES[memory]), seed());
    this.adam = undefined;
    this.stats = newStats();
    this.lastPractice = null;
    this.changed();
  }

  /** A saved or loaded model in his place (Adam's state starts afresh: it is never saved). */
  load(model: Model, memory: MemoryName, stats: TrainStats): void {
    this.stop();
    this.memory = memory;
    this.model = model;
    this.adam = undefined;
    this.stats = stats;
    this.lastPractice = null;
    this.changed();
  }

  /** His main teacher: the one he had most lessons from. */
  mainTeacher(): TeacherName | null {
    let best: TeacherName | null = null;
    for (const t of TEACHERS) if ((this.stats.teacherCounts[t] ?? 0) > (best ? this.stats.teacherCounts[best] ?? 0 : 0)) best = t;
    return best;
  }

  lessons(teacher: TeacherName, count: number, dungeon?: string): void {
    this.start({ kind: 'lessons', model: this.model, stats: this.stats, count, seed: seed(), teacher, adam: this.adam, dungeon });
  }

  practice(judge: Judge, count: number, dungeon?: string): void {
    const where = testsIn(dungeon);
    const startX = this.stats.lessons + this.stats.practiceRaids;
    const scoreBefore = this.stats.practiceScore.filter((p) => p.judge === judge).at(-1)?.y ?? null;
    const from = this.stats.practiceScore.length;
    this.start({ kind: 'practice', model: this.model, stats: this.stats, count, seed: seed(), judge, dungeon }, (stats) => {
      const scores = stats.practiceScore.slice(from);
      const tests = stats.evals.filter((e) => e.where === where);
      // The test at the start: from before the job, or the one the job took first.
      const first = tests.find((e) => e.x === startX);
      this.lastPractice = {
        judge, scoreBefore: scoreBefore ?? scores[0]?.y ?? null, scoreAfter: scores.at(-1)?.y ?? 0,
        goldBefore: first?.goldOut ?? 0, goldAfter: tests.at(-1)?.goldOut ?? 0,
      };
    });
  }

  private start(req: Parameters<typeof runInWorker>[0] & { kind: 'lessons' | 'practice' }, after?: (s: TrainStats) => void): void {
    if (this.job) return;
    if (req.kind === 'practice') this.lastPractice = null;
    const run = runInWorker(req, (p) => {
      if (!this.job || !p.stats) return;
      this.job.done = p.done;
      this.job.stats = p.stats;
      this.changed();
    });
    const job: Job = { kind: req.kind, done: 0, total: req.count, stats: this.stats, cancel: run.cancel };
    this.job = job;
    run.result.then((r) => {
      if (this.job !== job || !('model' in r)) return;
      this.model = r.model;
      if (r.adam) this.adam = r.adam;
      this.stats = r.stats;
      this.job = null;
      after?.(r.stats);
      this.changed();
    }).catch(() => {
      if (this.job === job) this.job = null;
      this.changed();
    });
    this.changed();
  }

  /** Stop the job and keep nothing of it. */
  stop(): void {
    const job = this.job;
    if (!job) return;
    this.job = null;
    job.cancel();
  }

  /** The teachers' numbers on his test raids there, measured in the worker the first time they are asked for. */
  teachers(dungeon?: string): TeacherTests | null {
    const where = testsIn(dungeon);
    const known = this.teacherTests.get(where);
    if (known) return known;
    if (!this.measuring.has(where)) {
      this.measuring.add(where);
      const run = runInWorker({ kind: 'teachers', teachers: TEACHERS, dungeon }, (p) => {
        if (p.teachers) { this.partial.set(where, p.teachers); this.changed(); }
      });
      run.result.then((r) => {
        if ('teachers' in r) this.teacherTests.set(where, r.teachers);
      }).finally(() => { this.measuring.delete(where); this.partial.delete(where); this.changed(); });
    }
    return this.partial.get(where) ?? null;
  }
}

