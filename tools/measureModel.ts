/**
 * Model speed at each memory size: `npm run measure:model -- [examples]`. Inputs come from random walks through
 * real dungeons; times are per example, with one optimiser step per batch of 32.
 */
import { generateDungeon } from '../src/dungeon';
import {
  adamStep, createAdam, createModel, forward, imitationGrad, parameterCount, policyGrad, sgdStep, zeroGrads,
} from '../src/model';
import { randInt, randomCode, rngFrom } from '../src/rng';
import { MEMORY_SIZES, encode, inputSize, newMemory, remember } from '../src/tokens';
import { newRaid, step, view, type Action } from '../src/world';

const BATCH = 32;

function inputs(pairs: number, count: number): number[][] {
  const rng = rngFrom('measure-model');
  const out: number[][] = [];
  while (out.length < count) {
    const s = newRaid(generateDungeon(randomCode(rng)));
    const mem = newMemory(pairs);
    for (let t = 0; t < 60 && !s.ended && out.length < count; t++) {
      out.push(encode(s, view(s), mem));
      const a = randInt(rng, 7) as Action; // never Leave, so the walk goes on
      remember(mem, view(s), a);
      step(s, a, rng);
    }
  }
  return out;
}

function time(label: string, n: number, f: () => void) {
  f(); // warm up
  const t0 = performance.now();
  f();
  const us = ((performance.now() - t0) * 1000) / n;
  return `${label} ${us.toFixed(1)} µs`;
}

export function main(args: string[]) {
  const count = Number(args[0] ?? 20000);
  console.log(`${count} examples per memory size, batches of ${BATCH}\n`);
  for (const [name, pairs] of Object.entries(MEMORY_SIZES)) {
    const xs = inputs(pairs, count);
    const active = xs.reduce((s, x) => s + x.length, 0) / xs.length;
    const m = createModel(inputSize(pairs), 'measure');
    const g = zeroGrads(m);
    const opt = createAdam(m);
    const rng = rngFrom('measure-actions');
    const actions = xs.map(() => randInt(rng, 8));
    const parts = [
      time('forward', count, () => { for (const x of xs) forward(m, x); }),
      time('lesson (imitation + Adam)', count, () => {
        xs.forEach((x, k) => {
          imitationGrad(m, g, x, actions[k]);
          if ((k + 1) % BATCH === 0) adamStep(m, opt, g, undefined, 1 / BATCH);
        });
        adamStep(m, opt, g, undefined, 1 / BATCH);
      }),
      time('practice (policy gradient + SGD)', count, () => {
        xs.forEach((x, k) => {
          policyGrad(m, g, x, actions[k], k % 2 ? 0.5 : -0.5);
          if ((k + 1) % BATCH === 0) sgdStep(m, g, undefined, 1 / BATCH);
        });
        sgdStep(m, g, undefined, 1 / BATCH);
      }),
    ];
    console.log(`${name.padEnd(6)} ${inputSize(pairs)} inputs, ${parameterCount(m)} parameters, ` +
      `${active.toFixed(1)} active on average\n  ${parts.join(', ')}`);
  }
}
