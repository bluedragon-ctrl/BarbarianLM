import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { createModel } from '../src/model';
import { Raid } from '../src/raid';
import {
  HALL_SIZE, KEYS, addToHall, dayCode, forgetAll, fromBase64, hallScript, linkHash, loadHall, loadModel, loadSettings,
  makesHall, memoryOf, modelFile, packFloats, packModel, packProbs, readLinkHash, readModelFile, saveHall, saveModel,
  saveSettings, toBase64, unpackFloats, unpackModel, unpackProbs, type HallEntry, type Store,
} from '../src/storage';
import { MEMORY_SIZES, SAVE_VERSION, inputSize } from '../src/tokens';
import { newStats } from '../src/train';
import { DEFAULT_SETTINGS } from '../src/ui/settings';

/** A Storage in memory, with a size limit in characters like a browser's. */
class MemoryStore implements Store {
  readonly items = new Map<string, string>();
  constructor(private readonly limit = Infinity) {}
  get length() { return this.items.size; }
  key(i: number) { return [...this.items.keys()][i] ?? null; }
  getItem(k: string) { return this.items.get(k) ?? null; }
  setItem(k: string, v: string) {
    let used = v.length + k.length;
    for (const [kk, vv] of this.items) if (kk !== k) used += kk.length + vv.length;
    if (used > this.limit) throw new Error('QuotaExceededError');
    this.items.set(k, v);
  }
  removeItem(k: string) { this.items.delete(k); }
}

const model = (memory: keyof typeof MEMORY_SIZES = 'medium', seed = 3) => createModel(inputSize(MEMORY_SIZES[memory]), seed);

describe('packing numbers', () => {
  it('base64 round-trips every length and matches the standard encoding', () => {
    for (let n = 0; n < 10; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
      expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
      expect(toBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
    }
  });

  it('keeps 32-bit floats exactly', () => {
    const a = Float32Array.from([0, -0.5, 1e-30, 3.4e38, Math.PI, -1 / 3]);
    expect(Array.from(unpackFloats(packFloats(a)))).toEqual(Array.from(a));
  });

  it('rejects damaged text', () => {
    expect(() => fromBase64('ab$c')).toThrow();
  });
});

describe('his model', () => {
  it('packs and unpacks to the same numbers', () => {
    const m = model();
    const back = unpackModel(packModel(m));
    expect(back.nIn).toBe(m.nIn);
    expect(Array.from(back.w1)).toEqual(Array.from(m.w1));
    expect(Array.from(back.b2)).toEqual(Array.from(m.b2));
  });

  it('is about 5.3 characters a number: under 1 MB even at the long memory', () => {
    const sizes = (['short', 'medium', 'long'] as const).map((k) => JSON.stringify(packModel(model(k))).length);
    expect(sizes[1]).toBeLessThan(520_000);
    expect(sizes[2]).toBeLessThan(900_000);
  });

  it('knows the memory from the input size', () => {
    for (const k of ['short', 'medium', 'long'] as const) expect(memoryOf(inputSize(MEMORY_SIZES[k]))).toBe(k);
    expect(memoryOf(123)).toBeNull();
  });

  it('saves and loads with its stats, under the save version', () => {
    const store = new MemoryStore();
    const m = model('long');
    const stats = { ...newStats(), lessons: 300 };
    expect(saveModel(store, packModel(m), stats)).toBe(true);
    expect(KEYS.model).toBe(`barbarian-lm-model-v${SAVE_VERSION}`);
    const back = loadModel(store)!;
    expect(back.memory).toBe('long');
    expect(back.stats.lessons).toBe(300);
    expect(Array.from(back.model.w2)).toEqual(Array.from(m.w2));
  });

  it('loads nothing from a damaged save, or another version', () => {
    const store = new MemoryStore();
    store.setItem(KEYS.model, '{not json');
    expect(loadModel(store)).toBeNull();
    store.setItem(KEYS.model, JSON.stringify({ model: { ...packModel(model()), version: SAVE_VERSION - 1 }, stats: newStats() }));
    expect(loadModel(store)).toBeNull();
  });

  it('reports a full storage instead of throwing', () => {
    const store = new MemoryStore(100_000);
    expect(saveModel(store, packModel(model()), newStats())).toBe(false);
    expect(store.getItem(KEYS.model)).toBeNull();
  });
});

describe('settings', () => {
  it('fill in the defaults and keep only known, well-typed values', () => {
    const store = new MemoryStore();
    saveSettings(store, { ...DEFAULT_SETTINGS, boldness: 1.3, block: true, memory: 'huge', dim: 'yes', extra: 1 });
    const st = loadSettings(store, DEFAULT_SETTINGS, { memory: Object.keys(MEMORY_SIZES) });
    expect(st.boldness).toBe(1.3);
    expect(st.block).toBe(true);
    expect(st.memory).toBe('medium');
    expect(st.dim).toBe(true);
    expect('extra' in st).toBe(false);
  });

  it('are the defaults with nothing saved', () => {
    expect(loadSettings(new MemoryStore(), DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('links', () => {
  it('carry the dungeon code only', () => {
    expect(linkHash('K7QMPR')).toBe('#dungeon=K7QMPR');
    expect(readLinkHash('#dungeon=K7QMPR')).toBe('K7QMPR');
    expect(readLinkHash('#other=1')).toBeNull();
    expect(readLinkHash('')).toBeNull();
  });
});

describe('dungeon of the day', () => {
  it('is the same all through a UTC day, and another the next day', () => {
    const a = dayCode(new Date('2026-11-24T00:00:00Z'));
    expect(a).toMatch(/^[A-Z2-9]{6}$/);
    expect(dayCode(new Date('2026-11-24T23:59:59Z'))).toBe(a);
    // 00:30 on the 25th in Prague is still the 24th in UTC.
    expect(dayCode(new Date('2026-11-25T00:30:00+01:00'))).toBe(a);
    expect(dayCode(new Date('2026-11-25T00:00:00Z'))).not.toBe(a);
  });
});

describe('model files', () => {
  it('round-trip the model, memory and stats', () => {
    const m = model('short');
    const f = readModelFile(modelFile(m, { ...newStats(), practiceRaids: 7 }));
    expect(f.memory).toBe('short');
    expect(f.stats.practiceRaids).toBe(7);
    expect(Array.from(f.model.w1)).toEqual(Array.from(m.w1));
  });

  it('say plainly why a file cannot be loaded', () => {
    expect(() => readModelFile('hello')).toThrow(/not a Barbarian LM model file/);
    expect(() => readModelFile(JSON.stringify({ format: 'karkulka-model' }))).toThrow(/not a Barbarian LM model file/);
    const old = JSON.parse(modelFile(model(), newStats()));
    old.version = SAVE_VERSION - 1;
    expect(() => readModelFile(JSON.stringify(old))).toThrow(/another version/);
    const bad = JSON.parse(modelFile(model(), newStats()));
    bad.model.w1 = bad.model.w1.slice(0, 100);
    expect(() => readModelFile(JSON.stringify(bad))).toThrow(/damaged/);
  });
});

describe('hall of fame', () => {
  const entry = (gold: number, turns = 100, extra: Partial<HallEntry> = {}): HallEntry => ({
    gold, turns, code: 'BCDEFG', n: gold, boldness: 0.5, block: false, events: true, newSpots: true, teacher: 'healer',
    trained: 100, memory: 'medium', date: '2026-11-24T10:00:00.000Z', day: false, actions: '0123', probs: '', ...extra,
  });

  it('keeps the best 10 by gold, then fewer turns', () => {
    let hall: HallEntry[] = [];
    for (let g = 1; g <= 12; g++) hall = addToHall(hall, entry(g));
    expect(hall).toHaveLength(HALL_SIZE);
    expect(hall.map((e) => e.gold)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(makesHall(hall, 3, 100)).toBe(false);
    expect(makesHall(hall, 3, 90)).toBe(true);
    hall = addToHall(hall, entry(3, 90, { n: 99 }));
    expect(hall.at(-1)!.turns).toBe(90);
  });

  it('takes no raid without gold, and the same raid once', () => {
    expect(makesHall([], 0, 10)).toBe(false);
    expect(addToHall([], entry(0))).toEqual([]);
    const once = addToHall([], entry(5));
    expect(addToHall(once, entry(5))).toHaveLength(1);
  });

  it('saves and loads, dropping broken entries', () => {
    const store = new MemoryStore();
    saveHall(store, [entry(4), { ...entry(9), actions: 'x' }, entry(7)]);
    expect(loadHall(store).map((e) => e.gold)).toEqual([7, 4]);
  });

  it('packs probabilities finely enough for the bars and thoughts', () => {
    const p = [Float32Array.from([0.5, 0.25, 0.125, 0.0625, 0.03125, 0.03125, 0, 0, 0]), Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0])];
    const back = unpackProbs(packProbs(p));
    expect(back).toHaveLength(2);
    back.forEach((b, t) => b.forEach((v, a) => expect(Math.abs(v - p[t][a])).toBeLessThan(1e-4)));
  });

  it('plays a raid back exactly without its model, events and block included', () => {
    const d = generateDungeon('BCDEFG');
    for (const opts of [{ events: true, block: false }, { events: { newSpots: false }, block: true }]) {
      const first = new Raid(model('medium', 11), d, 4, { temperature: 1.5, ...opts });
      first.run();
      const e = entry(first.state.gold, first.state.turn, {
        n: 4, block: opts.block, events: true, newSpots: opts.events === true,
        actions: first.turns.map((t) => t.action).join(''), probs: packProbs(first.turns.map((t) => t.probs)),
      });
      const again = new Raid(null, d, 4, { block: e.block, events: { newSpots: e.newSpots }, script: hallScript(e) });
      again.run();
      expect(again.turns.map((t) => t.action)).toEqual(first.turns.map((t) => t.action));
      expect(again.state).toEqual(first.state);
      expect(again.events!.met).toEqual(first.events!.met);
      again.turns.forEach((t, k) => expect(Math.abs(t.sample[t.action] - first.turns[k].sample[t.action])).toBeLessThan(1e-3));
    }
  });
});

describe('forgetting', () => {
  it('removes this game\'s keys only', () => {
    const store = new MemoryStore();
    store.setItem('karkulka-v4', 'hers');
    saveSettings(store, DEFAULT_SETTINGS);
    saveHall(store, []);
    store.setItem('barbarian-lm-model-v1', 'old');
    forgetAll(store);
    expect([...store.items.keys()]).toEqual(['karkulka-v4']);
  });
});
