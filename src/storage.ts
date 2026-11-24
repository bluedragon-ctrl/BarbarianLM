/**
 * Saving in the browser, links, model files, the hall of fame and the dungeon of the day (see "Save and links" in
 * docs/design.md). No DOM: the storage is passed in (the page gives `localStorage`), so it is tested directly.
 *
 * Keys are prefixed `barbarian-lm-`: on GitHub Pages this game shares its origin, and its 5 MB or so of storage,
 * with Karkulka. Settings, his model (with stats) and the hall of fame are kept apart, so a full or broken one
 * never takes the others with it, and a new `SAVE_VERSION` forgets only the model.
 */
import { N_OUT, modelFromJSON, type Model } from './model';
import { randomCode, rngFrom } from './rng';
import { MEMORY_SIZES, SAVE_VERSION, inputSize, type MemoryName } from './tokens';
import { newStats, type TrainStats } from './train';
import type { Action } from './world';

/** The part of `Storage` used here. */
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const KEYS = {
  settings: 'barbarian-lm-settings',
  model: `barbarian-lm-model-v${SAVE_VERSION}`,
  hall: 'barbarian-lm-hall',
} as const;

// ── Packing numbers ─────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** Bytes to base64 (standard alphabet, with padding). */
export function toBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out.push(B64[(n >> 18) & 63], B64[(n >> 12) & 63],
      i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=', i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out.join('');
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  if (clean.length % 4 === 1) throw new Error('Damaged numbers');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = clean[i + k];
      const v = c === undefined ? 0 : B64_INDEX.get(c);
      if (v === undefined) throw new Error('Damaged numbers');
      n = (n << 6) | v;
    }
    out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** 32-bit floats, little-endian, as base64: exact, and about 5.3 characters a number. */
export function packFloats(a: Float32Array): string {
  const bytes = new Uint8Array(a.length * 4);
  const dv = new DataView(bytes.buffer);
  a.forEach((v, i) => dv.setFloat32(i * 4, v, true));
  return toBase64(bytes);
}

export function unpackFloats(s: string): Float32Array {
  const bytes = fromBase64(s);
  if (bytes.length % 4) throw new Error('Damaged numbers');
  const dv = new DataView(bytes.buffer);
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => dv.getFloat32(i * 4, true));
}

// ── His model ───────────────────────────────────────────────────────────────

/** A model packed for saving: like `ModelJSON`, with each array as base64 floats. */
export interface PackedModel {
  version: number;
  nIn: number;
  nH: number;
  nOut: number;
  w1: string;
  b1: string;
  w2: string;
  b2: string;
}

export const packModel = (m: Model): PackedModel => ({
  version: SAVE_VERSION, nIn: m.nIn, nH: m.nH, nOut: N_OUT,
  w1: packFloats(m.w1), b1: packFloats(m.b1), w2: packFloats(m.w2), b2: packFloats(m.b2),
});

/** A packed model back, with `modelFromJSON`'s checks (save version, actions, input size, array sizes). */
export function unpackModel(p: PackedModel, expectInputs?: number): Model {
  if (!p || typeof p !== 'object') throw new Error('No model in it');
  const arr = (s: unknown) => {
    if (typeof s !== 'string') throw new Error('The model does not match its sizes');
    return Array.from(unpackFloats(s));
  };
  return modelFromJSON({ version: p.version, nIn: p.nIn, nH: p.nH, nOut: p.nOut, w1: arr(p.w1), b1: arr(p.b1), w2: arr(p.w2), b2: arr(p.b2) }, expectInputs);
}

/** The memory a model's input size fits, or null. */
export function memoryOf(nIn: number): MemoryName | null {
  return (Object.keys(MEMORY_SIZES) as MemoryName[]).find((m) => inputSize(MEMORY_SIZES[m]) === nIn) ?? null;
}

/** Stats from a save or a file: anything not right is replaced by a fresh start's. */
function cleanStats(s: unknown): TrainStats {
  const fresh = newStats();
  if (!s || typeof s !== 'object') return fresh;
  const t = s as Partial<TrainStats>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
  const obj = <T>(v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : ({} as T));
  return {
    lessons: num(t.lessons), lessonSteps: num(t.lessonSteps), practiceRaids: num(t.practiceRaids), practiceSteps: num(t.practiceSteps),
    teacherCounts: obj(t.teacherCounts), judgeRaids: obj(t.judgeRaids), baselines: obj(t.baselines),
    lessonLoss: arr(t.lessonLoss), practiceScore: arr(t.practiceScore), evals: arr(t.evals),
  };
}

/** His model and its stats as saved in the browser (Adam's state is not kept: a reload starts it afresh). */
export interface SavedModel {
  model: PackedModel;
  stats: TrainStats;
}

/** Save his model (packed with `packModel`) and stats; false when the browser refused (storage full or turned off). */
export function saveModel(store: Store, model: PackedModel, stats: TrainStats): boolean {
  return put(store, KEYS.model, { model, stats } satisfies SavedModel);
}

/** His saved model and stats, or null when there is none or it does not fit this game. */
export function loadModel(store: Store): { model: Model; memory: MemoryName; stats: TrainStats } | null {
  const s = get(store, KEYS.model) as SavedModel | null;
  if (!s) return null;
  try {
    const model = unpackModel(s.model);
    const memory = memoryOf(model.nIn);
    return memory ? { model, memory, stats: cleanStats(s.stats) } : null;
  } catch { return null; }
}

// ── Settings ────────────────────────────────────────────────────────────────

export function saveSettings(store: Store, settings: object): boolean {
  return put(store, KEYS.settings, settings);
}

/** Saved settings over the defaults: only known keys, each with the default's type (and a known value for choices). */
export function loadSettings<S extends object>(store: Store, defaults: S, choices: Partial<Record<keyof S, readonly unknown[]>> = {}): S {
  const saved = get(store, KEYS.settings);
  const out = { ...defaults };
  if (!saved || typeof saved !== 'object') return out;
  for (const k of Object.keys(defaults) as (keyof S)[]) {
    const v = (saved as Record<keyof S, unknown>)[k];
    if (typeof v !== typeof defaults[k]) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    const ok = choices[k];
    if (ok && !ok.includes(v)) continue;
    out[k] = v as S[keyof S];
  }
  return out;
}

// ── Links ───────────────────────────────────────────────────────────────────

/** The hash of a link to a dungeon: `#dungeon=CODE`. A model is far too big for a link. */
export const linkHash = (code: string): string => `#dungeon=${encodeURIComponent(code)}`;

/** The dungeon code a link's hash names, as written (the app normalizes it), or null. */
export function readLinkHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('dungeon') || null;
}

// ── Dungeon of the day ──────────────────────────────────────────────────────

/** The UTC date as YYYY-MM-DD: the dungeon of the day changes for everyone at the same moment. */
export const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Today's dungeon code: from the `day|YYYY-MM-DD` stream, the same for everyone that day. */
export const dayCode = (date: Date = new Date()): string => randomCode(rngFrom(`day|${utcDay(date)}`));

// ── Model files ─────────────────────────────────────────────────────────────

export const FILE_FORMAT = 'barbarian-lm-model';

export interface ModelFile {
  format: typeof FILE_FORMAT;
  version: number;
  memory: MemoryName;
  model: PackedModel;
  stats: TrainStats;
}

export const modelFile = (model: Model, stats: TrainStats): string => {
  const memory = memoryOf(model.nIn);
  if (!memory) throw new Error('The model fits no memory size');
  return JSON.stringify({ format: FILE_FORMAT, version: SAVE_VERSION, memory, model: packModel(model), stats } satisfies ModelFile);
};

/** A model file's model, memory and stats; throws with a plain reason when it cannot be loaded. */
export function readModelFile(text: string): { model: Model; memory: MemoryName; stats: TrainStats } {
  let f: Partial<ModelFile>;
  try { f = JSON.parse(text) as Partial<ModelFile>; } catch { throw new Error('This is not a Barbarian LM model file.'); }
  if (!f || f.format !== FILE_FORMAT) throw new Error('This is not a Barbarian LM model file.');
  if (f.version !== SAVE_VERSION) throw new Error('This model file is from another version of the game, whose model reads different inputs, so it cannot be loaded.');
  let model: Model;
  try { model = unpackModel(f.model as PackedModel); } catch { throw new Error('The model in this file is damaged.'); }
  const memory = memoryOf(model.nIn);
  if (!memory) throw new Error('The model in this file is damaged.');
  return { model, memory, stats: cleanStats(f.stats) };
}

// ── Hall of fame ────────────────────────────────────────────────────────────

/** How many raids the hall of fame keeps. */
export const HALL_SIZE = 10;

/** One of the best raids alone in this browser, with what it takes to play it again exactly. */
export interface HallEntry {
  gold: number;
  turns: number;
  code: string;
  n: number;
  boldness: number;
  block: boolean;
  events: boolean;
  newSpots: boolean;
  /** His main teacher then (null: untrained or practice only). */
  teacher: string | null;
  /** Lessons and practice raids he had had. */
  trained: number;
  memory: MemoryName;
  /** When, as an ISO time; `day` when the dungeon was the dungeon of the day then. */
  date: string;
  day: boolean;
  /** The actions, one digit a turn. */
  actions: string;
  /** Each turn's 9 unmasked probabilities, 16 bits each, as base64. */
  probs: string;
}

/** Probabilities as 16-bit fractions (exact to 1 in 65,535: far finer than the bars show). */
export function packProbs(turns: readonly ArrayLike<number>[]): string {
  const bytes = new Uint8Array(turns.length * N_OUT * 2);
  const dv = new DataView(bytes.buffer);
  turns.forEach((p, t) => { for (let a = 0; a < N_OUT; a++) dv.setUint16((t * N_OUT + a) * 2, Math.round(Math.min(1, Math.max(0, p[a])) * 65535), true); });
  return toBase64(bytes);
}

export function unpackProbs(s: string): Float32Array[] {
  const bytes = fromBase64(s);
  const dv = new DataView(bytes.buffer);
  const n = Math.floor(bytes.length / (N_OUT * 2));
  return Array.from({ length: n }, (_, t) => Float32Array.from({ length: N_OUT }, (_, a) => dv.getUint16((t * N_OUT + a) * 2, true) / 65535));
}

/** A raid's script back from its entry: what `Raid` plays back. */
export function hallScript(e: HallEntry): { memory: number; actions: Action[]; probs: Float32Array[] } {
  return { memory: MEMORY_SIZES[e.memory], actions: [...e.actions].map((c) => Number(c) as Action), probs: unpackProbs(e.probs) };
}

/** Better first: more gold, then fewer turns, then the earlier. */
const better = (a: HallEntry, b: HallEntry) => b.gold - a.gold || a.turns - b.turns || a.date.localeCompare(b.date);

/** Whether a raid with this gold and these turns would get in. Only raids he left with gold count. */
export function makesHall(hall: readonly HallEntry[], gold: number, turns: number): boolean {
  if (gold <= 0) return false;
  if (hall.length < HALL_SIZE) return true;
  const last = hall[hall.length - 1];
  return gold > last.gold || (gold === last.gold && turns < last.turns);
}

/** The hall with `e` in it, best first, at most `HALL_SIZE`; the same raid twice (code, number, actions) counts once. */
export function addToHall(hall: readonly HallEntry[], e: HallEntry): HallEntry[] {
  if (e.gold <= 0) return [...hall];
  if (hall.some((x) => x.code === e.code && x.n === e.n && x.actions === e.actions)) return [...hall];
  return [...hall, e].sort(better).slice(0, HALL_SIZE);
}

const isEntry = (e: unknown): e is HallEntry => {
  const x = e as HallEntry;
  return !!x && typeof x.gold === 'number' && typeof x.code === 'string' && typeof x.n === 'number' && typeof x.actions === 'string'
    && /^[0-8]*$/.test(x.actions) && typeof x.probs === 'string' && x.memory in MEMORY_SIZES && typeof x.date === 'string';
};

export function loadHall(store: Store): HallEntry[] {
  const h = get(store, KEYS.hall);
  return Array.isArray(h) ? h.filter(isEntry).sort(better).slice(0, HALL_SIZE) : [];
}

export const saveHall = (store: Store, hall: readonly HallEntry[]): boolean => put(store, KEYS.hall, hall);

// ── Forgetting ──────────────────────────────────────────────────────────────

/** Remove everything this game saved (any save version's model too). */
export function forgetAll(store: Store & Partial<Pick<Storage, 'key' | 'length'>>): void {
  const keys: string[] = [KEYS.settings, KEYS.model, KEYS.hall];
  if (typeof store.length === 'number' && store.key) {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith('barbarian-lm-')) keys.push(k);
    }
  }
  for (const k of keys) { try { store.removeItem(k); } catch { /* ignore */ } }
}

function put(store: Store, key: string, value: unknown): boolean {
  try { store.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function get(store: Store, key: string): unknown {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
