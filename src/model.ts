/**
 * The model: a tiny hand-written neural network, no ML library. Tokens in, 9 action probabilities out.
 *
 *   active inputs (0/1) → 48 tanh units → 9 logits → softmax (with temperature: the boldness dial)
 *
 * Adapted from Karkulka's `model.ts`. Every input is 0 or 1 and only about 1 in 17 is 1, so an input is the list of
 * its active indices (`encode` in `tokens.ts`). The first layer is stored one row of 48 weights per input, so the
 * forward pass is the sum of the active rows, and the backward pass touches only those rows: the cost follows the
 * number of active inputs, not the input size.
 *
 * Training: imitation (cross-entropy against a teacher's action) and policy gradient (advantage-weighted
 * log-probability of the sampled action). Gradients add up in a `Grads` over a batch, then one Adam or SGD step
 * applies them and clears what was touched. No DOM, no worker code: the training worker and any main-thread path
 * use these same functions.
 */
import { rngFrom } from './rng';
import { SAVE_VERSION } from './tokens';
import { ACTIONS } from './world';

/** Hidden units. */
export const HIDDEN = 48;
/** Outputs: one logit per action. */
export const N_OUT = ACTIONS;
/** First-layer weights start uniform in ±this. About 116 inputs are active (medium memory), so a hidden unit's
 * input starts with a spread of about 0.6: in tanh's steep middle, where it learns fastest. */
export const W1_INIT = 0.1;

/** Training defaults (Karkulka's): Adam for lessons, SGD with a clipped gradient for practice. */
export const TRAINING = {
  adamLearningRate: 0.01,
  adamBeta1: 0.9,
  adamBeta2: 0.999,
  adamEpsilon: 1e-8,
  sgdLearningRate: 0.05,
  /** SGD scales the whole (batch-averaged) gradient down to this length when it is longer. */
  sgdClip: 1,
} as const;

export interface Model {
  nIn: number;
  nH: number;
  /** nIn × nH: row i holds input i's weight to every hidden unit. */
  w1: Float32Array;
  b1: Float32Array;
  /** N_OUT × nH. */
  w2: Float32Array;
  b2: Float32Array;
}

/**
 * A fresh network, the same for the same seed: weights from the `model|<seed>` stream, biases 0. `w1` is uniform
 * in ±W1_INIT; `w2` is uniform in ±½·√(6 / (nH + 9)) (half Glorot, as in Karkulka), so the first probabilities
 * are near even.
 */
export function createModel(nIn: number, seed: string | number, nH = HIDDEN): Model {
  const rng = rngFrom(`model|${seed}`);
  const init = (n: number, scale: number) => Float32Array.from({ length: n }, () => (rng() * 2 - 1) * scale);
  return {
    nIn,
    nH,
    w1: init(nIn * nH, W1_INIT),
    b1: new Float32Array(nH),
    w2: init(N_OUT * nH, 0.5 * Math.sqrt(6 / (nH + N_OUT))),
    b2: new Float32Array(N_OUT),
  };
}

/** nIn·nH + nH + 9·nH + 9: 48,633 / 95,193 / 165,033 for the short / medium / long memory. */
export const parameterCount = (m: Pick<Model, 'nIn' | 'nH'>): number => m.nIn * m.nH + m.nH + N_OUT * m.nH + N_OUT;

// ── Forward ─────────────────────────────────────────────────────────────────

export interface Forward {
  /** The active inputs. */
  active: readonly number[];
  /** Hidden unit values (after tanh). */
  h: Float32Array;
  logits: Float32Array;
}

/** The network on a sparse input: hidden = tanh(b1 + the sum of the active inputs' rows). */
export function forward(model: Model, active: readonly number[]): Forward {
  const { nIn, nH, w1, b1, w2, b2 } = model;
  const pre = Float32Array.from(b1);
  for (const i of active) {
    if (i < 0 || i >= nIn) throw new Error(`Input ${i} is outside 0–${nIn - 1}`);
    const row = i * nH;
    for (let j = 0; j < nH; j++) pre[j] += w1[row + j];
  }
  const h = pre.map(Math.tanh);
  const logits = new Float32Array(N_OUT);
  for (let o = 0; o < N_OUT; o++) {
    let s = b2[o];
    const row = o * nH;
    for (let j = 0; j < nH; j++) s += w2[row + j] * h[j];
    logits[o] = s;
  }
  return { active, h, logits };
}

/** Lowest temperature used: below it softmax is argmax in all but name. */
export const MIN_TEMPERATURE = 1e-3;

/** Softmax with temperature: low → nearly always the top action, high → nearly even. */
export function softmax(logits: ArrayLike<number>, temperature = 1): Float32Array {
  const t = Math.max(temperature, MIN_TEMPERATURE);
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i] / t);
  const out = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += (out[i] = Math.exp(logits[i] / t - max));
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

/**
 * "Block impossible actions": blocked actions get 0 and the rest are scaled back up to sum to 1. If nothing is
 * allowed (never in a real raid: some way is always open) the probabilities are returned as they are.
 */
export function mask(probs: ArrayLike<number>, allowed: readonly boolean[]): Float32Array {
  const out = Float32Array.from(probs, (p, i) => (allowed[i] ? p : 0));
  let sum = 0;
  for (const p of out) sum += p;
  if (sum <= 0) return Float32Array.from(probs);
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

export interface Decision extends Forward {
  /** At the temperature, unmasked: what the action bars show. */
  probs: Float32Array;
  /** What he samples from: `probs`, masked when `allowed` was given. */
  sample: Float32Array;
}

/** One decision: the forward pass, the probabilities at a temperature, and masked ones when `allowed` is given. */
export function decide(model: Model, active: readonly number[], temperature = 1, allowed?: readonly boolean[]): Decision {
  const fw = forward(model, active);
  const probs = softmax(fw.logits, temperature);
  return { ...fw, probs, sample: allowed ? mask(probs, allowed) : probs };
}

/** Index drawn from probabilities with one random number in [0, 1). */
export function sampleIndex(probs: ArrayLike<number>, r: number): number {
  let acc = 0;
  let last = 0;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] <= 0) continue;
    acc += probs[i];
    last = i;
    if (r < acc) return i;
  }
  return last;
}

// ── Gradients ───────────────────────────────────────────────────────────────

/**
 * Gradients added up over a batch. `w1` is full size, but only the rows in `rows` are ever non-zero, and the
 * optimiser steps visit and clear only those.
 */
export interface Grads {
  w1: Float32Array;
  b1: Float32Array;
  w2: Float32Array;
  b2: Float32Array;
  /** First-layer rows touched since the last step, each once. */
  rows: number[];
  /** 1 for a row in `rows`. */
  touched: Uint8Array;
}

export const zeroGrads = (m: Model): Grads => ({
  w1: new Float32Array(m.w1.length),
  b1: new Float32Array(m.b1.length),
  w2: new Float32Array(m.w2.length),
  b2: new Float32Array(m.b2.length),
  rows: [],
  touched: new Uint8Array(m.nIn),
});

/** Add one example's gradient, given d(loss)/d(logits). Only the active inputs' rows of w1 are touched. */
export function accumulate(model: Model, g: Grads, fw: Pick<Forward, 'active' | 'h'>, dlogits: ArrayLike<number>): void {
  const { nH, w2 } = model;
  const dpre = new Float32Array(nH);
  for (let o = 0; o < N_OUT; o++) {
    const d = dlogits[o];
    if (d === 0) continue;
    g.b2[o] += d;
    const row = o * nH;
    for (let j = 0; j < nH; j++) {
      g.w2[row + j] += d * fw.h[j];
      dpre[j] += d * w2[row + j];
    }
  }
  for (let j = 0; j < nH; j++) {
    dpre[j] *= 1 - fw.h[j] * fw.h[j];
    g.b1[j] += dpre[j];
  }
  // Every active input is 1, so its row's gradient is dpre itself.
  for (const i of fw.active) {
    if (!g.touched[i]) {
      g.touched[i] = 1;
      g.rows.push(i);
    }
    const row = i * nH;
    for (let j = 0; j < nH; j++) g.w1[row + j] += dpre[j];
  }
}

/**
 * Imitation (lessons): loss = −log p(teacher's action), at temperature 1. Adds its gradient (p − one-hot) and
 * returns the loss.
 */
export function imitationGrad(model: Model, g: Grads, active: readonly number[], target: number): number {
  const fw = forward(model, active);
  const p = softmax(fw.logits);
  const loss = -Math.log(Math.max(p[target], 1e-12));
  p[target] -= 1;
  accumulate(model, g, fw, p);
  return loss;
}

/**
 * Policy gradient (practice): loss = −advantage · log p(sampled action), at temperature 1 (the sampling
 * temperature only changes which actions get tried). A positive advantage makes the action more likely, a negative
 * one less. Adds its gradient advantage · (p − one-hot) and returns the loss. Clipping the advantage and keeping a
 * baseline belong to the training loop.
 */
export function policyGrad(model: Model, g: Grads, active: readonly number[], action: number, advantage: number): number {
  const fw = forward(model, active);
  const p = softmax(fw.logits);
  const loss = -advantage * Math.log(Math.max(p[action], 1e-12));
  p[action] -= 1;
  for (let o = 0; o < N_OUT; o++) p[o] *= advantage;
  accumulate(model, g, fw, p);
  return loss;
}

/** Clear the gradients: only the touched rows of w1. */
export function clearGrads(g: Grads, nH: number): void {
  for (const i of g.rows) {
    g.w1.fill(0, i * nH, (i + 1) * nH);
    g.touched[i] = 0;
  }
  g.rows.length = 0;
  g.b1.fill(0);
  g.w2.fill(0);
  g.b2.fill(0);
}

/** Length of the gradient times `scale`; untouched rows are zero and skipped. */
export function gradNorm(g: Grads, nH: number, scale = 1): number {
  let s = 0;
  for (const i of g.rows) for (let k = i * nH; k < (i + 1) * nH; k++) s += g.w1[k] * g.w1[k];
  for (const a of [g.b1, g.w2, g.b2]) for (const v of a) s += v * v;
  return Math.sqrt(s) * Math.abs(scale);
}

// ── Optimisers ──────────────────────────────────────────────────────────────

/**
 * Adam's state. `m` and `v` are full size (two more copies of the weights: 760 KB at the medium memory), but a
 * step updates only the first-layer rows with a gradient ("lazy" Adam): a row not touched keeps its moments, and
 * is bias-corrected by its own count of updates (`rowSteps`), so a row seen for the first time late in training
 * gets the same careful first step as one seen at the start. The biases and the second layer are touched by every
 * example and use the global count `t`.
 */
export interface Adam {
  m: Omit<Grads, 'rows' | 'touched'>;
  v: Omit<Grads, 'rows' | 'touched'>;
  t: number;
  rowSteps: Uint32Array;
}

export function createAdam(model: Model): Adam {
  const z = () => ({
    w1: new Float32Array(model.w1.length),
    b1: new Float32Array(model.b1.length),
    w2: new Float32Array(model.w2.length),
    b2: new Float32Array(model.b2.length),
  });
  return { m: z(), v: z(), t: 0, rowSteps: new Uint32Array(model.nIn) };
}

/** Adam on elements [from, to) of p with bias corrections c1, c2. */
function adamRange(
  p: Float32Array, g: Float32Array, m: Float32Array, v: Float32Array, from: number, to: number,
  lr: number, scale: number, c1: number, c2: number,
): void {
  const { adamBeta1: b1, adamBeta2: b2, adamEpsilon: eps } = TRAINING;
  for (let k = from; k < to; k++) {
    const gk = g[k] * scale;
    m[k] = b1 * m[k] + (1 - b1) * gk;
    v[k] = b2 * v[k] + (1 - b2) * gk * gk;
    p[k] -= (lr * (m[k] / c1)) / (Math.sqrt(v[k] / c2) + eps);
  }
}

/** One Adam step with the batch's gradient times `scale` (1 / batch size for the mean), then clear `g`. */
export function adamStep(model: Model, opt: Adam, g: Grads, lr: number = TRAINING.adamLearningRate, scale = 1): void {
  const { adamBeta1: b1, adamBeta2: b2 } = TRAINING;
  const nH = model.nH;
  opt.t++;
  const c1 = 1 - b1 ** opt.t;
  const c2 = 1 - b2 ** opt.t;
  for (const k of ['b1', 'w2', 'b2'] as const) {
    adamRange(model[k], g[k], opt.m[k], opt.v[k], 0, model[k].length, lr, scale, c1, c2);
  }
  for (const i of g.rows) {
    const n = ++opt.rowSteps[i];
    adamRange(model.w1, g.w1, opt.m.w1, opt.v.w1, i * nH, (i + 1) * nH, lr, scale, 1 - b1 ** n, 1 - b2 ** n);
  }
  clearGrads(g, nH);
}

/**
 * One plain gradient-descent step (practice, where the feedback is noisy), with the batch's gradient times
 * `scale`, shortened to length `clip` when longer; then clear `g`.
 */
export function sgdStep(model: Model, g: Grads, lr: number = TRAINING.sgdLearningRate, scale = 1, clip: number = TRAINING.sgdClip): void {
  const nH = model.nH;
  const norm = gradNorm(g, nH, scale);
  const f = lr * scale * (norm > clip ? clip / norm : 1);
  for (const i of g.rows) for (let k = i * nH; k < (i + 1) * nH; k++) model.w1[k] -= f * g.w1[k];
  for (const k of ['b1', 'w2', 'b2'] as const) {
    const p = model[k];
    const gk = g[k];
    for (let i = 0; i < p.length; i++) p[i] -= f * gk[i];
  }
  clearGrads(g, nH);
}

// ── Saving ──────────────────────────────────────────────────────────────────

/** A model as a plain object, for saves and links. Numbers keep 9 significant digits: exact for 32-bit floats. */
export interface ModelJSON {
  version: number;
  nIn: number;
  nH: number;
  nOut: number;
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
}

const toNumbers = (a: Float32Array): number[] => Array.from(a, (v) => Number(v.toPrecision(9)));

export const modelToJSON = (m: Model): ModelJSON => ({
  version: SAVE_VERSION, nIn: m.nIn, nH: m.nH, nOut: N_OUT,
  w1: toNumbers(m.w1), b1: toNumbers(m.b1), w2: toNumbers(m.w2), b2: toNumbers(m.b2),
});

/**
 * A model back from its plain object. Throws when it was saved under another `SAVE_VERSION`, for another number
 * of actions, for an input size other than `expectInputs` (when given), or when its arrays do not fit its sizes.
 */
export function modelFromJSON(j: ModelJSON, expectInputs?: number): Model {
  if (j.version !== SAVE_VERSION) throw new Error(`The model was saved by version ${j.version}; this game reads version ${SAVE_VERSION}`);
  if (j.nOut !== N_OUT) throw new Error(`The model has ${j.nOut} actions, not ${N_OUT}`);
  if (expectInputs !== undefined && j.nIn !== expectInputs) throw new Error(`The model reads ${j.nIn} inputs, not ${expectInputs}`);
  const { nIn, nH } = j;
  const sizes = [nIn * nH, nH, N_OUT * nH, N_OUT];
  const arrays = [j.w1, j.b1, j.w2, j.b2];
  if (!(nIn > 0 && nH > 0) || arrays.some((a, k) => !Array.isArray(a) || a.length !== sizes[k])) {
    throw new Error('The model file does not match its sizes');
  }
  return {
    nIn, nH,
    w1: Float32Array.from(j.w1), b1: Float32Array.from(j.b1), w2: Float32Array.from(j.w2), b2: Float32Array.from(j.b2),
  };
}
