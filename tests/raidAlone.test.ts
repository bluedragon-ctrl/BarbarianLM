import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { createModel } from '../src/model';
import { Raid } from '../src/raid';
import { MEMORY_SIZES, PINNED_LABELS, PINNED_SIZE, inputSize, pinnedIndices, pinnedWords } from '../src/tokens';
import { newRaid } from '../src/world';
import { DEFAULT_SETTINGS } from '../src/ui/settings';
import { BOLDNESS, nextRaidNumber, readMs } from '../src/ui/raidPlay';

const model = () => createModel(inputSize(MEMORY_SIZES.medium), 7);

describe('pinned tokens in words', () => {
  it('has a word for every pinned input', () => {
    expect(PINNED_LABELS).toHaveLength(PINNED_SIZE);
  });

  it('reads the start as the model does', () => {
    const s = newRaid(generateDungeon('BCDEFG'));
    const words = pinnedWords(s);
    expect(words).toEqual(['HP 11–15', 'Max HP up to 14', 'Attack 2', 'Potions 2', 'Torches 1', 'Torch off', 'Gold 0', 'Time 150+', 'Stairs here']);
    expect(pinnedIndices(s)).toHaveLength(9);
  });

  it('puts the compass direction and distance together off the stairs', () => {
    const d = generateDungeon('BCDEFG');
    const s = newRaid(d);
    s.pos = s.map.tiles.findIndex((t, i) => t === 0 && s.stairsDist[i] >= 20);
    const words = pinnedWords(s);
    expect(words).toHaveLength(9);
    expect(words.at(-1)).toMatch(/^Stairs [a-z-]+, very far$/);
  });
});

describe('a raid alone, turn by turn', () => {
  it('peek shows the probabilities the next turn draws from, and draws nothing', () => {
    const d = generateDungeon('BCDEFG');
    const a = new Raid(model(), d, 1, { temperature: 0.5, block: true });
    const b = new Raid(model(), d, 1, { temperature: 0.5, block: true });
    for (let k = 0; k < 30 && !a.state.ended; k++) {
      const p = a.peek()!;
      const t = a.next()!;
      expect(Array.from(p.probs)).toEqual(Array.from(t.probs));
      expect(Array.from(p.sample)).toEqual(Array.from(t.sample));
      expect(p.allowed).toEqual(t.allowed);
      expect(b.next()!.action).toBe(t.action);
    }
  });

  it('the boldness dial can move between turns', () => {
    const d = generateDungeon('BCDEFG');
    const r = new Raid(model(), d, 1, { temperature: 0.5 });
    const cool = r.peek()!.probs;
    r.options.temperature = 2.5;
    const hot = r.peek()!.probs;
    expect(Math.max(...hot)).toBeLessThan(Math.max(...cool));
    expect(r.next()!.probs).toEqual(hot);
  });

  it('peek is null once the raid has ended', () => {
    const r = new Raid(model(), generateDungeon('BCDEFG'), 1);
    r.run();
    expect(r.peek()).toBeNull();
  });
});

describe('raid alone settings', () => {
  it('boldness 0.5 by default, from 0.1 to 2.5; the block option off', () => {
    expect(DEFAULT_SETTINGS.boldness).toBe(0.5);
    expect(DEFAULT_SETTINGS.block).toBe(false);
    expect(BOLDNESS).toMatchObject({ min: 0.1, max: 2.5 });
  });

  it('raid numbers count up per dungeon code from 1', () => {
    const seen = new Map<string, number>();
    expect(nextRaidNumber(seen, 'AAA')).toBe(1);
    expect(nextRaidNumber(seen, 'AAA')).toBe(2);
    expect(nextRaidNumber(seen, 'BBB')).toBe(1);
    expect(nextRaidNumber(seen, 'AAA')).toBe(3);
  });

  it('a thought waits long enough to read, longer for longer lines', () => {
    expect(readMs(['Ow!'])).toBeGreaterThanOrEqual(1000);
    expect(readMs(['Troll to the north. Too big. Not today.', 'North, I think.'])).toBeGreaterThan(readMs(['Ow!']));
    expect(readMs(['x'.repeat(500)])).toBeLessThanOrEqual(4000);
  });
});
