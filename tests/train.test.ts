import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { createAdam, createModel, decide, sampleIndex, type Model } from '../src/model';
import { Raid, memoryPairs, raid, raidStreams, type RaidRecord, type RaidTurn } from '../src/raid';
import { codesFrom, countRaid, manyRaids, newCounts, summary } from '../src/raids';
import { mulberry32 } from '../src/rng';
import { TEACHERS, teacherRaid } from '../src/teachers';
import { MEMORY_SIZES, encode, inputSize, newMemory, remember } from '../src/tokens';
import {
  LOOP, advantage, beatenReward, judgeRewards, learnFromRaid, lessonExamples, lessonLoss, newStats, rewardToGo, updateBaseline,
  runJob, teacherTests, trainLessons, trainPractice, type WorkerResponse,
} from '../src/train';
import {
  DRINK, LEAVE, LEFT, LIGHT_TORCH, PICK_UP, RIGHT, WAIT, newRaid, step, view, type Action, type StepResult,
} from '../src/world';
import { raidFrom } from './maps';

const model = (pairs: number = MEMORY_SIZES.short, seed = 'test') => createModel(inputSize(pairs), seed);
const clone = (m: Model): Model => ({ ...m, w1: m.w1.slice(), b1: m.b1.slice(), w2: m.w2.slice(), b2: m.b2.slice() });
const trace = (r: RaidRecord) => r.turns.map((t) => [t.action, t.result.did, r.state.pos]);

describe('a raid alone', () => {
  it('reads its memory size from the model', () => {
    for (const pairs of Object.values(MEMORY_SIZES)) expect(memoryPairs(model(pairs))).toBe(pairs);
    expect(() => memoryPairs({ nIn: 1000 })).toThrow();
  });

  it('keeps the random-stream promise: the same streams give the same raid', () => {
    const m = model();
    const a = raid(m, 'STREAM', 3);
    const b = raid(m, 'STREAM', 3);
    expect(trace(b)).toEqual(trace(a));
    expect(b.state).toEqual(a.state);
    expect(b.turns.map((t) => Array.from(t.probs))).toEqual(a.turns.map((t) => Array.from(t.probs)));
    expect(trace(raid(m, 'STREAM', 4))).not.toEqual(trace(a));
  });

  it('samples from code|n|act and moves monsters with code|n|monsters', () => {
    const m = model();
    const d = generateDungeon('STREAM');
    const r = raid(m, d, 2, { temperature: 0.8 });
    // Replay by hand from the two streams.
    const s = newRaid(d);
    const { act, monsters } = raidStreams('STREAM', 2);
    const mem = newMemory(memoryPairs(m));
    const actions: Action[] = [];
    while (!s.ended) {
      const v = view(s);
      const dd = decide(m, encode(s, v, mem), 0.8);
      const a = sampleIndex(dd.sample, act()) as Action;
      actions.push(a);
      step(s, a, monsters);
      remember(mem, v, a);
    }
    expect(actions).toEqual(r.turns.map((t) => t.action));
  });

  it('masks only when the option is on, and then never wastes an action', () => {
    const m = model();
    const off = raid(m, 'MASK', 0);
    expect(off.turns.every((t) => t.allowed === undefined && t.sample === t.probs)).toBe(true);
    expect(off.turns.some((t) => t.result.did === 'nothing')).toBe(true);
    const on = raid(m, 'MASK', 0, { block: true });
    expect(on.turns.every((t) => t.result.did !== 'nothing')).toBe(true);
    for (const t of on.turns) {
      t.allowed!.forEach((ok, a) => { if (!ok) expect(t.sample[a]).toBe(0); });
      expect(t.allowed![WAIT]).toBe(true);
    }
    // One draw from code|n|act a turn, block or not, so the box never shifts the stream.
    const act = raidStreams('MASK', 0).act;
    expect(on.turns.map((t) => sampleIndex(t.sample, act()))).toEqual(on.turns.map((t) => t.action));
  });

  it('plays step by step with next(), the same as run()', () => {
    const m = model();
    const d = generateDungeon('STEPS');
    const r = new Raid(m, d, 1);
    const first = r.input();
    const t = r.next()!;
    expect(t.input).toEqual(first);
    while (r.next());
    expect(r.next()).toBeNull();
    expect(r.turns.map((x) => x.action)).toEqual(raid(m, d, 1).turns.map((x) => x.action));
  });
});

describe('lessons', () => {
  it('pair each turn of the teacher\'s raid with what he saw, memory strip included', () => {
    const d = generateDungeon('LESSON');
    const { examples, state } = lessonExamples(d, 'healer', 0, 3);
    const { turns } = teacherRaid(d, 'healer', 0);
    expect(examples.map((e) => e.action)).toEqual(turns.map((t) => t.action));
    expect(state.turn).toBe(turns.length);
    // The first input has an empty memory; later ones have the pairs.
    expect(examples[0].input).toEqual(encode(newRaid(d), view(newRaid(d)), newMemory(3)));
    expect(examples[5].input.length).toBeGreaterThan(examples[0].input.length);
  });

  it('play the pickaxe dwarf with his own pickaxe', () => {
    for (const code of codesFrom('pickaxe', 20)) {
      const d = generateDungeon(code);
      const own = teacherRaid(d, 'pickaxe', 0);
      const { examples } = lessonExamples(d, 'pickaxe', 0, 1);
      expect(examples.map((e) => e.action)).toEqual(own.turns.map((t) => t.action));
      if (own.turns.some((t) => t.result.did === 'dig')) {
        // Every blow of his own pickaxe breaks a wall.
        expect(own.turns.filter((t) => t.result.did === 'dig').every((t) => t.result.dugThrough)).toBe(true);
        return;
      }
    }
    throw new Error('no pickaxe dwarf dug in 20 codes');
  });

  it('lower the imitation loss on a small run', () => {
    const m = model();
    const codes = codesFrom('loss', 3);
    const before = lessonLoss(m, 'healer', codes);
    const stats = newStats();
    trainLessons(m, createAdam(m), 'healer', 15, stats, mulberry32(1), { test: false });
    expect(lessonLoss(m, 'healer', codes)).toBeLessThan(before * 0.75);
    expect(stats.lessons).toBe(15);
    expect(stats.teacherCounts.healer).toBe(15);
    expect(stats.lessonLoss.length).toBe(1);
    expect(stats.lessonSteps).toBeGreaterThan(15 * 50);
  });

  it('in one dungeon use its raid numbers in turn', () => {
    const a = model();
    const b = clone(a);
    trainLessons(a, createAdam(a), 'thief', 3, newStats(), mulberry32(1), { dungeon: 'ONE', test: false });
    trainLessons(b, createAdam(b), 'thief', 3, newStats(), mulberry32(1), { dungeon: 'ONE', test: false });
    expect(Array.from(b.b2)).toEqual(Array.from(a.b2));
  });
});

/** A fake practice raid: `turns` turns, all on one input, with these results. */
function toyRaid(actions: Action[], results: Partial<StepResult>[], end: { ended: 'left' | 'knockedOut' | 'lockedIn'; gold: number }): RaidRecord {
  const state = newRaid(generateDungeon('TOY'));
  state.ended = end.ended;
  state.gold = end.gold;
  const input = encode(state, view(state), newMemory(1));
  const turns = actions.map((action, k): RaidTurn => ({
    input, probs: new Float32Array(9), sample: new Float32Array(9), view: view(state), action,
    after: { hp: 14, maxHp: 14, gold: 0, potions: 2, torches: 1, torchLeft: 0, timeLeft: 200 },
    result: { action, did: 'walk', goldGained: 0, dugThrough: false, trapDamage: 0, hits: [], monstersTrapped: [], torchOut: false, ended: null, ...results[k] },
  }));
  return { code: 'TOY', n: 0, state, turns };
}

describe('the judges, the baseline and the advantage', () => {
  const beaten = { monster: { kind: 'rat' as const, pos: 0, hp: 0, rich: false }, gold: 1, at: 0 };
  const r = toyRaid([RIGHT, PICK_UP, RIGHT, LEAVE], [{}, { goldGained: 10 }, { beaten }, {}], { ended: 'left', gold: 10 });

  it('gold out pays on the last turn, only if he left', () => {
    expect(judgeRewards('goldOut', r)).toEqual([0, 0, 0, 10 / LOOP.goldScale]);
    const locked = toyRaid([RIGHT, PICK_UP], [{}, { goldGained: 10 }], { ended: 'lockedIn', gold: 10 });
    expect(judgeRewards('goldOut', locked)).toEqual([0, 0]);
    expect(judgeRewards('goldPickedUp', locked)).toEqual([0, 10 / LOOP.goldScale]);
  });

  it('gold picked up pays at the pickup, monsters beaten at the blow', () => {
    expect(judgeRewards('goldPickedUp', r)).toEqual([0, 10 / LOOP.goldScale, 0, 0]);
    expect(judgeRewards('monstersBeaten', r)).toEqual([0, 0, beatenReward('rat'), 0]);
    expect(['rat', 'goblin', 'slime', 'troll'].map((k) => beatenReward(k as 'rat'))).toEqual([0.1, 0.2, 0.30000000000000004, 0.6000000000000001]);
  });

  it('credits each turn with its reward to go, minus the baseline, clipped to ±1', () => {
    expect(rewardToGo([0, 0.2, 0, 0.5])).toEqual([0.7, 0.7, 0.5, 0.5]);
    expect(advantage(0.7, 0.2)).toBeCloseTo(0.5);
    expect(advantage(3, 0.5)).toBe(1);
    expect(advantage(0, 2)).toBe(-1);
  });

  it('keeps a baseline per turn number: set by the first raid to reach it, then moved 5% of the way', () => {
    const b: number[] = [];
    expect(updateBaseline(b, [0.8, 0.5])).toEqual([0.8, 0.5]); // the first raid compares with itself
    expect(b).toEqual([0.8, 0.5]);
    expect(updateBaseline(b, [1.8, 0.5, 0.2])).toEqual([0.8, 0.5, 0.2]); // the values from before this raid
    expect(b[0]).toBeCloseTo(0.8 + LOOP.baselineSmoothing);
    expect(b.slice(1)).toEqual([0.5, 0.2]);
    const stats = newStats();
    learnFromRaid(model(), r, 'goldOut', stats);
    expect(stats.baselines.goldOut).toEqual([0.2, 0.2, 0.2, 0.2].map((v) => expect.closeTo(v)));
    expect(stats.judgeRaids.goldOut).toBe(1);
    expect(stats.practiceRaids).toBe(1);
    expect(stats.practiceSteps).toBe(4);
  });
});

describe('practice', () => {
  const p = (m: Model, r: RaidRecord, a: Action) => decide(m, r.turns[0].input).probs[a];

  it('makes rewarded actions more likely and punished ones less', () => {
    const good = toyRaid([DRINK, DRINK, DRINK], [{}, {}, {}], { ended: 'left', gold: 50 });
    const m = model();
    const before = p(m, good, DRINK);
    const stats = newStats();
    // Score 1 against a baseline of 0: advantage +1 on every turn.
    for (let k = 0; k < 20; k++) { stats.baselines.goldOut = [0, 0, 0]; learnFromRaid(m, good, 'goldOut', stats); }
    expect(p(m, good, DRINK)).toBeGreaterThan(before + 0.1);

    const bad = toyRaid([LEFT, LEFT], [{}, {}], { ended: 'knockedOut', gold: 30 });
    const m2 = model();
    const before2 = p(m2, bad, LEFT);
    const stats2 = newStats();
    for (let k = 0; k < 20; k++) { stats2.baselines.goldOut = [1, 1]; learnFromRaid(m2, bad, 'goldOut', stats2); }
    expect(p(m2, bad, LEFT)).toBeLessThan(before2 - 0.05);
  });

  it('changes nothing when the score matches the baseline', () => {
    const m = model();
    const before = clone(m);
    const r = toyRaid([RIGHT], [{}], { ended: 'left', gold: 0 });
    learnFromRaid(m, r, 'goldOut', newStats()); // first raid: the baseline is its own score
    expect(Array.from(m.b2)).toEqual(Array.from(before.b2));
  });

  it('plays his own raids unblocked and counts them', () => {
    const m = model();
    const stats = newStats();
    const counts = trainPractice(m, 'monstersBeaten', 4, stats, mulberry32(1), { test: false });
    expect(counts.raids).toBe(4);
    expect(stats.practiceRaids).toBe(4);
    expect(stats.practiceScore.length).toBe(1);
    expect(counts.wasted).toBeGreaterThan(0);
  });
});

describe('many raids', () => {
  it('counts a scripted raid', () => {
    const s = raidFrom(['>.c']);
    const noRng = () => { throw new Error('no monsters here'); };
    const script: Action[] = [PICK_UP, LIGHT_TORCH, RIGHT, RIGHT, PICK_UP, WAIT, DRINK, LEFT, LEFT, LEAVE];
    const turns = script.map((a) => ({ action: a, result: step(s, a, noRng) }));
    const c = countRaid(newCounts(), { state: s, turns: turns as unknown as RaidTurn[] });
    expect(c).toEqual({
      raids: 1, goldOut: 3, left: 1, leftNoGold: 0, knockedOut: 0, lockedIn: 0, turns: 10, potions: 1, torches: 1,
      walls: 0, wasted: 1, waits: 1, goldPickedUp: 3, beaten: 0, events: 0, eventEffects: 0, eventGold: 0,
    });
    // Leaving with nothing counts apart.
    const e = raidFrom(['>.']);
    const t2 = [{ action: LEAVE, result: step(e, LEAVE, noRng) }];
    countRaid(c, { state: e, turns: t2 as unknown as RaidTurn[] });
    expect([c.raids, c.left, c.leftNoGold, c.goldOut]).toEqual([2, 1, 1, 3]);
    expect(summary(c).goldOut).toBe(1.5);
    expect(summary(c).left).toBe(0.5);
  });

  it('ends every raid one way, on one dungeon or many', () => {
    const m = model();
    for (const plan of [{ code: 'MANY', count: 5 }, { codes: codesFrom('many', 5) }]) {
      for (const block of [false, true]) {
        const c = manyRaids(m, plan, { block });
        expect(c.raids).toBe(5);
        expect(c.left + c.leftNoGold + c.knockedOut + c.lockedIn).toBe(5);
        if (block) expect(c.wasted).toBe(0);
      }
    }
  });
});

describe('the worker job', () => {
  const run = (req: Parameters<typeof runJob>[0]) => {
    const msgs: WorkerResponse[] = [];
    runJob(req, (m) => msgs.push(m));
    return msgs;
  };

  it('runs lessons with progress, then done with the model, stats and Adam', () => {
    const m = model();
    const msgs = run({ kind: 'lessons', model: m, stats: newStats(), count: LOOP.chunk + 1, seed: 1, teacher: 'dwarf' });
    expect(msgs.map((x) => x.type)).toEqual(['progress', 'progress', 'done']);
    const done = msgs[2] as Extract<WorkerResponse, { type: 'done' }>;
    expect(done.stats.lessons).toBe(LOOP.chunk + 1);
    expect(done.adam!.t).toBeGreaterThan(0);
    expect(done.stats.evals.length).toBe(3); // before the first lesson, after the first chunk and after the last
    expect(done.stats.evals.map((e) => [e.x, e.where, e.phase])).toEqual([[0, 'new', 'lessons'], [LOOP.chunk, 'new', 'lessons'], [LOOP.chunk + 1, 'new', 'lessons']]);
    expect((msgs[0] as Extract<WorkerResponse, { type: 'progress' }>).done).toBe(LOOP.chunk);
  });

  it('runs practice and many raids', () => {
    const practice = run({ kind: 'practice', model: model(), stats: newStats(), count: 2, seed: 1, judge: 'goldOut' });
    expect(practice.map((x) => x.type)).toEqual(['progress', 'done']);
    const raids = run({ kind: 'raids', model: model(), plan: { code: 'W', count: LOOP.chunk + 2 }, temperature: 1, block: true });
    expect(raids.map((x) => x.type)).toEqual(['progress', 'raidsDone']);
    expect((raids[1] as Extract<WorkerResponse, { type: 'raidsDone' }>).counts.raids).toBe(LOOP.chunk + 2);
  });

  it('tests first only where there is no test at that point yet, and tags practice tests and scores', () => {
    const m = model();
    const first = run({ kind: 'lessons', model: m, stats: newStats(), count: 1, seed: 1, teacher: 'healer', dungeon: 'FIRST' });
    const a = (first.at(-1) as Extract<WorkerResponse, { type: 'done' }>).stats;
    expect(a.evals.map((e) => [e.x, e.where])).toEqual([[0, 'FIRST'], [1, 'FIRST']]);
    // Practice in the same dungeon starts where lessons left off: no second test at x = 1.
    const p = run({ kind: 'practice', model: m, stats: a, count: 1, seed: 2, judge: 'goldPickedUp', dungeon: 'FIRST' });
    const b = (p.at(-1) as Extract<WorkerResponse, { type: 'done' }>).stats;
    expect(b.evals.map((e) => [e.x, e.where, e.phase])).toEqual([[0, 'FIRST', 'lessons'], [1, 'FIRST', 'lessons'], [2, 'FIRST', 'practice']]);
    expect(b.practiceScore[0].judge).toBe('goldPickedUp');
    // Somewhere else, he is tested there first.
    const q = run({ kind: 'practice', model: m, stats: b, count: 1, seed: 3, judge: 'goldOut' });
    const c = (q.at(-1) as Extract<WorkerResponse, { type: 'done' }>).stats;
    expect(c.evals.slice(3).map((e) => [e.x, e.where])).toEqual([[2, 'new'], [3, 'new']]);
  });

  it('measures the teachers on his test raids, one progress message per teacher', () => {
    const msgs = run({ kind: 'teachers', teachers: ['thief', 'healer'], dungeon: 'TEACH' });
    expect(msgs.map((x) => x.type)).toEqual(['progress', 'teachersDone']);
    const done = msgs[1] as Extract<WorkerResponse, { type: 'teachersDone' }>;
    expect(Object.keys(done.teachers)).toEqual(['thief', 'healer']);
    expect(done.teachers.healer).toEqual(teacherTests('healer', 'TEACH'));
    expect(done.teachers.healer!.raids).toBe(LOOP.evalRaids);
    // The same raids as his tests: raids 0–19 of the dungeon, played as in the lessons.
    const d = generateDungeon('TEACH');
    const gold = Array.from({ length: LOOP.evalRaids }, (_, n) => {
      const s = teacherRaid(d, 'healer', n).state;
      return s.ended === 'left' ? s.gold : 0;
    }).reduce((x, y) => x + y, 0);
    expect(done.teachers.healer!.goldOut).toBeCloseTo(gold / LOOP.evalRaids);
    expect(run({ kind: 'teachers', teachers: ['wizard' as never] })).toEqual([{ type: 'error', message: 'No teacher called wizard' }]);
    expect(TEACHERS.length).toBe(7);
  });

  it('reports errors as a message', () => {
    const msgs = run({ kind: 'lessons', model: model(), stats: newStats(), count: 1, seed: 1, teacher: 'wizard' as never });
    expect(msgs).toEqual([{ type: 'error', message: 'No teacher called wizard' }]);
    const bad = run({ kind: 'practice', model: { ...model(), nIn: 7 }, stats: newStats(), count: 1, seed: 1, judge: 'goldOut' });
    expect(bad[0].type).toBe('error');
  });

  it('is what worker.ts runs on each message', async () => {
    const posted: WorkerResponse[] = [];
    const g = globalThis as unknown as { self?: unknown };
    const old = g.self;
    const fake: { postMessage: (m: WorkerResponse) => void; onmessage?: (e: { data: unknown }) => void } = {
      postMessage: (m) => posted.push(m),
    };
    g.self = fake;
    try {
      await import('../src/worker');
      fake.onmessage!({ data: { kind: 'raids', model: model(), plan: { codes: ['A'] }, temperature: 1, block: false } });
      expect(posted.map((x) => x.type)).toEqual(['raidsDone']);
    } finally {
      g.self = old;
    }
  });
});
