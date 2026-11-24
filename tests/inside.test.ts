import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { createModel, decide, withoutEach } from '../src/model';
import { Raid } from '../src/raid';
import { CARDS, CARD_KEYS } from '../src/explain';
import {
  CELL_SIZE, MEMORY_SIZES, PAIR_SIZE, PINNED_SIZE, VIEW_INPUTS, cellWhere, inputSize, inputWords, pairAt, viewNowAt,
} from '../src/tokens';

describe('inputs in words', () => {
  const pairs = MEMORY_SIZES.medium;

  it('has words for every input of every memory size', () => {
    for (const p of Object.values(MEMORY_SIZES)) {
      for (let i = 0; i < inputSize(p); i++) expect(inputWords(i, p)).toMatch(/\S/);
      expect(() => inputWords(inputSize(p), p)).toThrow();
    }
  });

  it('names the pinned stats, the view now and the remembered pairs', () => {
    expect(inputWords(0, pairs)).toBe('HP 1–3');
    expect(inputWords(PINNED_SIZE - 1, pairs)).toBe('Stairs very far');
    // The view now: cell 13 is one east of him (row 2, column 3); kind 14 is the goblin.
    expect(inputWords(viewNowAt(pairs) + 13 * CELL_SIZE + 14, pairs)).toBe('Now: goblin 1 east');
    expect(inputWords(viewNowAt(pairs) + 12 * CELL_SIZE + 4, pairs)).toBe('Now: stairs under him');
    // The newest pair sits in the last slot: 1 turn ago.
    expect(inputWords(pairAt(pairs - 1), pairs)).toBe('1 turn ago: memory slot filled');
    expect(inputWords(pairAt(0) + 1 + VIEW_INPUTS + 1, pairs)).toBe('3 turns ago: he took right');
    expect(inputWords(pairAt(0) + 1 + 0 * CELL_SIZE + 17, pairs)).toBe('3 turns ago: wounded monster 2 north, 2 west');
    expect(pairAt(1) - pairAt(0)).toBe(PAIR_SIZE);
  });

  it('says where a cell is', () => {
    expect(cellWhere(12)).toBe('under him');
    expect(cellWhere(7)).toBe('1 north');
    expect(cellWhere(24)).toBe('2 south, 2 east');
  });
});

describe('what pushed him', () => {
  it('gives the chance with each input left out, as a forward pass without it would', () => {
    const m = createModel(inputSize(MEMORY_SIZES.short), 3);
    const r = new Raid(m, generateDungeon('BCDEFG'), 1);
    for (let k = 0; k < 5; k++) r.next();
    const active = r.input();
    const top = 2;
    const out = withoutEach(m, active, top, 0.7);
    expect(out).toHaveLength(active.length);
    for (const k of [0, 5, active.length - 1]) {
      const rest = active.filter((_, j) => j !== k);
      expect(out[k]).toBeCloseTo(decide(m, rest, 0.7).probs[top], 5);
    }
  });
});

describe('AI idea cards', () => {
  it('has about 12 short cards, each ending with a real chatbot', () => {
    expect(CARD_KEYS.length).toBeGreaterThanOrEqual(10);
    expect(CARD_KEYS.length).toBeLessThanOrEqual(14);
    for (const k of CARD_KEYS) {
      const c = CARDS[k];
      expect(c.title.length).toBeLessThan(40);
      const sentences = c.text.split(/(?<=[.!?])\s+/);
      expect(sentences.length).toBeGreaterThanOrEqual(2);
      expect(sentences.length).toBeLessThanOrEqual(3);
      expect(sentences.at(-1)).toMatch(/chatbot/i);
    }
  });
});

describe('the tabs\' numbers', () => {
  it('shows chances near the ends with a decimal', async () => {
    const { finePercent } = await import('../src/ui/inside');
    expect([0.9996, 0.996, 0.42, 0.003, 0.0001].map(finePercent)).toEqual(['>99.9%', '99.6%', '42%', '0.3%', '<0.1%']);
  });

  it('plays many raids in the dungeon on screen or in the same new dungeons every run', async () => {
    const { manyPlan, manyPlace } = await import('../src/ui/many');
    expect(manyPlan('shown', 'BCDEFG', 100)).toEqual({ code: 'BCDEFG', count: 100 });
    const a = manyPlan('new', 'BCDEFG', 1000) as { codes: string[] };
    const b = manyPlan('new', 'XYZ', 100) as { codes: string[] };
    expect(a.codes).toHaveLength(1000);
    expect(b.codes).toEqual(a.codes.slice(0, 100));
    expect(manyPlace('new', 'BCDEFG', 100)).toBe(manyPlace('new', 'XYZ', 100));
    expect(manyPlace('shown', 'BCDEFG', 100)).not.toBe(manyPlace('shown', 'XYZ', 100));
  });
});
