import { describe, expect, it } from 'vitest';
import {
  HIDDEN, N_OUT, TRAINING, accumulate, adamStep, createAdam, createModel, decide, forward, gradNorm, imitationGrad,
  mask, modelFromJSON, modelToJSON, parameterCount, policyGrad, sampleIndex, sgdStep, softmax, zeroGrads,
  type Model,
} from '../src/model';
import { generateDungeon } from '../src/dungeon';
import { rngFrom } from '../src/rng';
import { MEMORY_SIZES, SAVE_VERSION, dense, encode, inputSize, newMemory, remember } from '../src/tokens';
import { ACTIONS, allowedActions, newRaid, step, view, type Action } from '../src/world';

/** The network the plain way: a full input vector times the full first layer. */
function denseForward(m: Model, x: Float32Array) {
  const h = new Float64Array(m.nH);
  for (let j = 0; j < m.nH; j++) {
    let s = m.b1[j];
    for (let i = 0; i < m.nIn; i++) s += x[i] * m.w1[i * m.nH + j];
    h[j] = Math.tanh(s);
  }
  const logits = new Float64Array(N_OUT);
  for (let o = 0; o < N_OUT; o++) {
    let s = m.b2[o];
    for (let j = 0; j < m.nH; j++) s += m.w2[o * m.nH + j] * h[j];
    logits[o] = s;
  }
  return { h, logits };
}

/** Same as softmax, in doubles: for finite differences. */
function logProb(m: Model, active: number[], a: number): number {
  const { logits } = denseForward(m, dense(active, m.nIn));
  const max = Math.max(...logits);
  let sum = 0;
  for (const l of logits) sum += Math.exp(l - max);
  return logits[a] - max - Math.log(sum);
}

/** Bigger starting weights than the game's, so every part of the gradient is well away from zero. */
function smallModel(seed = 1): Model {
  const m = createModel(12, seed, 5);
  const rng = rngFrom(`test|${seed}`);
  for (const k of ['w1', 'b1', 'w2', 'b2'] as const) for (let i = 0; i < m[k].length; i++) m[k][i] = rng() * 2 - 1;
  return m;
}

/** Compare the analytic gradient in `g` with central differences of `loss` for every parameter. */
function checkGradient(m: Model, loss: () => number, g: ReturnType<typeof zeroGrads>) {
  const eps = 1e-2;
  let checked = 0;
  for (const k of ['w1', 'b1', 'w2', 'b2'] as const) {
    for (let i = 0; i < m[k].length; i++) {
      const keep = m[k][i];
      m[k][i] = keep + eps;
      const up = loss();
      m[k][i] = keep - eps;
      const down = loss();
      m[k][i] = keep;
      const numeric = (up - down) / (2 * eps);
      expect(g[k][i], `${k}[${i}]`).toBeCloseTo(numeric, 3);
      checked++;
    }
  }
  return checked;
}

describe('sizes and start', () => {
  it('parameter counts: 48,681 / 95,241 / 165,081', () => {
    const counts = Object.values(MEMORY_SIZES).map((pairs) => parameterCount(createModel(inputSize(pairs), 0)));
    expect(counts).toEqual([48681, 95241, 165081]);
    const m = createModel(inputSize(MEMORY_SIZES.medium), 0);
    expect(m.w1.length + m.b1.length + m.w2.length + m.b2.length).toBe(95241);
    expect(m.nH).toBe(HIDDEN);
    expect(N_OUT).toBe(ACTIONS);
  });

  it('the same seed gives the same network, another seed another one', () => {
    const a = createModel(100, 'x');
    expect(createModel(100, 'x')).toEqual(a);
    expect(createModel(100, 'y').w1).not.toEqual(a.w1);
    expect(a.b1.every((v) => v === 0)).toBe(true);
  });

  it('starts with near-even probabilities on a real input', () => {
    const d = generateDungeon('START');
    const s = newRaid(d);
    const m = createModel(inputSize(3), 'start');
    const p = softmax(forward(m, encode(s, view(s), newMemory(3))).logits);
    for (const v of p) expect(v).toBeGreaterThan(0.05);
  });
});

describe('forward', () => {
  it('the sparse forward equals the dense one on real inputs', () => {
    const pairs = MEMORY_SIZES.medium;
    const m = createModel(inputSize(pairs), 'dense');
    const s = newRaid(generateDungeon('SPARSE'));
    const mem = newMemory(pairs);
    const rng = rngFrom('walk');
    for (let t = 0; t < 10 && !s.ended; t++) {
      const active = encode(s, view(s), mem);
      const fw = forward(m, active);
      const ref = denseForward(m, dense(active, m.nIn));
      for (let j = 0; j < m.nH; j++) expect(fw.h[j]).toBeCloseTo(ref.h[j], 5);
      for (let o = 0; o < N_OUT; o++) expect(fw.logits[o]).toBeCloseTo(ref.logits[o], 5);
      const a = Math.floor(rng() * 4) as Action;
      remember(mem, view(s), a);
      step(s, a, rng);
    }
  });

  it('rejects an input outside the network', () => {
    expect(() => forward(createModel(10, 0, 4), [10])).toThrow();
  });
});

describe('softmax, temperature, masking', () => {
  const logits = [1, 3, 0.5, -1, 2.9, 0, 0, -2];

  it('sums to 1 and keeps the order', () => {
    const p = softmax(logits);
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    expect(p[1]).toBeGreaterThan(p[4]);
    expect(p[4]).toBeGreaterThan(p[0]);
  });

  it('low temperature is nearly argmax, high nearly even', () => {
    expect(softmax(logits, 0.01)[1]).toBeGreaterThan(0.99);
    expect(softmax(logits, 0)[1]).toBeGreaterThan(0.99);
    for (const v of softmax(logits, 1000)) expect(v).toBeCloseTo(1 / 8, 2);
    // Higher temperature: the top action loses probability
    expect(softmax(logits, 2)[1]).toBeLessThan(softmax(logits, 1)[1]);
  });

  it('masking zeroes blocked actions and renormalises the rest, keeping the unmasked bars', () => {
    const allowed = [true, false, true, true, false, true, true, false];
    const p = softmax(logits);
    const q = mask(p, allowed);
    q.forEach((v, i) => (allowed[i] ? expect(v).toBeCloseTo(p[i] / (1 - p[1] - p[4] - p[7]), 6) : expect(v).toBe(0)));
    expect(q.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    expect(mask(p, new Array(8).fill(false))).toEqual(p);

    const m = createModel(20, 'mask', 6);
    const dec = decide(m, [1, 5, 9], 1.5, allowed);
    expect(dec.probs).toEqual(softmax(dec.logits, 1.5));
    expect(dec.sample).toEqual(mask(dec.probs, allowed));
    const free = decide(m, [1, 5, 9], 1.5);
    expect(free.sample).toEqual(free.probs);
  });

  it('masking with the real allowed actions never samples a blocked one', () => {
    const s = newRaid(generateDungeon('MASKED'));
    const allowed = allowedActions(s);
    const m = createModel(inputSize(1), 'masked');
    const dec = decide(m, encode(s, view(s), newMemory(1)), 3, allowed);
    const rng = rngFrom('sample');
    for (let k = 0; k < 500; k++) expect(allowed[sampleIndex(dec.sample, rng())]).toBe(true);
  });

  it('sampling follows the probabilities and skips zeros', () => {
    expect(sampleIndex([0.25, 0, 0.75], 0.1)).toBe(0);
    expect(sampleIndex([0.25, 0, 0.75], 0.25)).toBe(2);
    expect(sampleIndex([0.25, 0, 0.75, 0], 0.9999999)).toBe(2);
  });
});

describe('gradients against finite differences', () => {
  const active = [0, 3, 4, 9];

  it('imitation: −log p(teacher action)', () => {
    const m = smallModel(1);
    for (const target of [0, 5]) {
      const g = zeroGrads(m);
      const loss = imitationGrad(m, g, active, target);
      expect(loss).toBeCloseTo(-logProb(m, active, target), 4);
      expect(checkGradient(m, () => -logProb(m, active, target), g)).toBe(parameterCount(m));
    }
  });

  it('policy gradient: −advantage · log p(sampled action)', () => {
    const m = smallModel(2);
    for (const [action, adv] of [[2, 0.7], [6, -0.4]] as const) {
      const g = zeroGrads(m);
      const loss = policyGrad(m, g, active, action, adv);
      expect(loss).toBeCloseTo(-adv * logProb(m, active, action), 4);
      checkGradient(m, () => -adv * logProb(m, active, action), g);
    }
  });

  it('a batch adds up, and only the active rows are touched', () => {
    const m = smallModel(3);
    const g = zeroGrads(m);
    imitationGrad(m, g, [0, 3], 1);
    imitationGrad(m, g, [3, 7], 4);
    expect(g.rows.sort((a, b) => a - b)).toEqual([0, 3, 7]);
    checkGradient(m, () => -logProb(m, [0, 3], 1) - logProb(m, [3, 7], 4), g);
    for (let i = 0; i < m.nIn; i++) {
      if (g.rows.includes(i)) continue;
      for (let j = 0; j < m.nH; j++) expect(g.w1[i * m.nH + j]).toBe(0);
    }
  });
});

describe('optimisers', () => {
  it('Adam clears the gradient and leaves untouched rows alone', () => {
    const m = smallModel(4);
    const before = Float32Array.from(m.w1);
    const g = zeroGrads(m);
    const opt = createAdam(m);
    imitationGrad(m, g, [2, 5], 3);
    adamStep(m, opt, g, 0.01);
    expect(g.rows).toEqual([]);
    expect(g.w1.every((v) => v === 0) && g.b2.every((v) => v === 0)).toBe(true);
    for (let i = 0; i < m.nIn; i++) {
      for (let j = 0; j < m.nH; j++) {
        const moved = Math.abs(m.w1[i * m.nH + j] - before[i * m.nH + j]);
        // Adam's first step moves each weight by the learning rate
        if (i === 2 || i === 5) expect(moved).toBeCloseTo(0.01, 4);
        else expect(moved).toBe(0);
      }
    }
  });

  it('lazy Adam: a row seen for the first time late still gets a first step of the learning rate', () => {
    const m = smallModel(5);
    const g = zeroGrads(m);
    const opt = createAdam(m);
    for (let t = 0; t < 50; t++) {
      imitationGrad(m, g, [0], t % 8);
      adamStep(m, opt, g, 0.01);
    }
    const before = Float32Array.from(m.w1.subarray(11 * m.nH, 12 * m.nH));
    imitationGrad(m, g, [11], 2);
    adamStep(m, opt, g, 0.01);
    for (let j = 0; j < m.nH; j++) expect(Math.abs(m.w1[11 * m.nH + j] - before[j])).toBeCloseTo(0.01, 4);
    expect(opt.rowSteps[0]).toBe(50);
    expect(opt.rowSteps[11]).toBe(1);
    expect(opt.t).toBe(51);
  });

  it('SGD moves against the gradient, shortened to the clip length', () => {
    const m = smallModel(6);
    const copy = modelFromJSON(modelToJSON(m));
    const g = zeroGrads(m);
    policyGrad(m, g, [1, 2], 3, 5);
    const norm = gradNorm(g, m.nH);
    expect(norm).toBeGreaterThan(1);
    const want = { w1: Float32Array.from(g.w1), b2: Float32Array.from(g.b2) };
    sgdStep(m, g, 0.1, 1, 1);
    expect(g.rows).toEqual([]);
    const k = 0.1 / norm;
    for (let i = 0; i < m.w1.length; i++) expect(m.w1[i]).toBeCloseTo(copy.w1[i] - k * want.w1[i], 6);
    for (let o = 0; o < N_OUT; o++) expect(m.b2[o]).toBeCloseTo(copy.b2[o] - k * want.b2[o], 6);
  });

  it('policy gradient: a good outcome makes the action likelier, a bad one less likely', () => {
    for (const [adv, sign] of [[1, 1], [-1, -1]] as const) {
      const m = createModel(30, 'pg', 8);
      const g = zeroGrads(m);
      const input = [3, 10, 20];
      const before = softmax(forward(m, input).logits)[5];
      for (let t = 0; t < 20; t++) {
        policyGrad(m, g, input, 5, adv);
        sgdStep(m, g);
      }
      const after = softmax(forward(m, input).logits)[5];
      expect(Math.sign(after - before)).toBe(sign);
    }
  });
});

describe('learning', () => {
  /** Eight patterns of 4 active inputs out of 40, overlapping, each with its own action. */
  const rng = rngFrom('toy');
  const patterns = Array.from({ length: 8 }, () => {
    const s = new Set<number>([0]); // one input always on, like the pinned tokens
    while (s.size < 4) s.add(1 + Math.floor(rng() * 39));
    return [...s].sort((a, b) => a - b);
  });

  const accuracy = (m: Model) =>
    patterns.filter((p, a) => {
      const q = softmax(forward(m, p).logits);
      return q.indexOf(Math.max(...q)) === a;
    }).length / patterns.length;

  it('lessons with Adam learn a toy mapping to 100%', () => {
    const m = createModel(40, 'toy');
    const opt = createAdam(m);
    const g = zeroGrads(m);
    const loss0 = patterns.reduce((s, p, a) => s - logProb(m, p, a), 0) / 8;
    for (let epoch = 0; epoch < 150; epoch++) {
      patterns.forEach((p, a) => imitationGrad(m, g, p, a));
      adamStep(m, opt, g, TRAINING.adamLearningRate, 1 / patterns.length);
    }
    const loss = patterns.reduce((s, p, a) => s - logProb(m, p, a), 0) / 8;
    expect(accuracy(m)).toBe(1);
    expect(loss).toBeLessThan(0.1 * loss0);
    patterns.forEach((p, a) => expect(softmax(forward(m, p).logits)[a]).toBeGreaterThan(0.9));
  });

  it('lessons with SGD learn it too', () => {
    const m = createModel(40, 'toy-sgd');
    const g = zeroGrads(m);
    for (let epoch = 0; epoch < 400; epoch++) {
      patterns.forEach((p, a) => imitationGrad(m, g, p, a));
      sgdStep(m, g, 0.5, 1 / patterns.length, Infinity);
    }
    expect(accuracy(m)).toBe(1);
  });

  it('practice alone (policy gradient with reward 1 for the right action) learns it', () => {
    const m = createModel(40, 'toy-pg');
    const g = zeroGrads(m);
    const pick = rngFrom('toy-pg-sample');
    let baseline = 0;
    for (let epoch = 0; epoch < 1500; epoch++) {
      let rewards = 0;
      patterns.forEach((p, want) => {
        const a = sampleIndex(softmax(forward(m, p).logits), pick());
        const r = a === want ? 1 : 0;
        rewards += r;
        policyGrad(m, g, p, a, r - baseline);
      });
      baseline += 0.05 * (rewards / 8 - baseline);
      sgdStep(m, g, TRAINING.sgdLearningRate * 4, 1 / patterns.length);
    }
    expect(accuracy(m)).toBe(1);
  });
});

describe('saving', () => {
  it('round trip through JSON is exact', () => {
    const m = createModel(inputSize(1), 'save');
    const g = zeroGrads(m);
    imitationGrad(m, g, [0, 50, 700], 3);
    adamStep(m, createAdam(m), g);
    const j = JSON.parse(JSON.stringify(modelToJSON(m)));
    expect(j.version).toBe(SAVE_VERSION);
    expect(j.nIn).toBe(inputSize(1));
    expect(j.nH).toBe(HIDDEN);
    const back = modelFromJSON(j, inputSize(1));
    expect(back).toEqual(m);
    expect(forward(back, [0, 50, 700]).logits).toEqual(forward(m, [0, 50, 700]).logits);
  });

  it('rejects another version, another size or broken arrays', () => {
    const j = modelToJSON(createModel(30, 'bad', 4));
    expect(() => modelFromJSON({ ...j, version: SAVE_VERSION + 1 })).toThrow(/version/);
    expect(() => modelFromJSON(j, 31)).toThrow(/inputs/);
    expect(() => modelFromJSON({ ...j, nOut: N_OUT - 1 })).toThrow(/actions/);
    expect(() => modelFromJSON({ ...j, nH: 5 })).toThrow(/sizes/);
    expect(() => modelFromJSON({ ...j, w2: j.w2.slice(1) })).toThrow(/sizes/);
    expect(modelFromJSON(j, 30).nIn).toBe(30);
  });
});

describe('accumulate', () => {
  it('a zero gradient changes nothing', () => {
    const m = smallModel(7);
    const g = zeroGrads(m);
    accumulate(m, g, forward(m, [1]), new Float32Array(N_OUT));
    expect(gradNorm(g, m.nH)).toBe(0);
  });
});
