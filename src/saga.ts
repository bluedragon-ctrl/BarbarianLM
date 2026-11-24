/**
 * The skald's saga after a raid alone: true sentences from the raid record (the start, fights, gold, digging, the
 * events he met, the ending) mixed with made-up ones, more the bolder the skald. Made up, in order of boldness:
 * events borrowed from this dungeon that he never met (believable, like real hallucinations), then boasts (a true
 * happening with inflated numbers) and pure fantasy. The ending and the gold carried out are always true, and no
 * made-up sentence mentions gold or changes his stats. The randomness is the caller's (`sagaStream`), never the
 * raid's. No DOM.
 */
import { CAST, DATA, metText, type EventKind, type SagaLines } from './events';
import { codeLabel } from './mapCode';
import type { RaidRecord } from './raid';
import type { Rng } from './rng';
import { STRENGTH, VIGOUR, type MonsterKind } from './tiles';
import { goldOut } from './world';

export type SagaPart =
  | 'opening' | 'fight' | 'hit' | 'trap' | 'gold' | 'dig' | 'potion' | 'torch' | 'item' | 'event' | 'ending'
  | 'borrowed' | 'boast' | 'fantasy';

export interface SagaSentence {
  text: string;
  part: SagaPart;
  /** Made up by the skald, not in the raid record. */
  madeUp: boolean;
}

/** At most this many sentences, opening and ending included; the least telling true parts go first. */
export const MAX_SENTENCES = 10;
/** Below this boldness nothing is made up; from `WILD_FROM` boasts and fantasy join borrowed events (Karkulka's scale). */
export const MADE_UP_FROM = 0.5;
export const WILD_FROM = 1.2;
/** The boldness where the made-up share stops growing. */
export const WILDEST = 2.5;

/**
 * How many made-up sentences a saga gets on average: none below 0.5; one in about every other saga at 0.7, about
 * one at 1.0; then more, up to 4 at 2.5 (capped by the saga's length).
 */
export function madeUpExpected(boldness: number): number {
  if (boldness < MADE_UP_FROM) return 0;
  if (boldness < WILD_FROM) return Math.max(0, 0.5 + (boldness - 0.7) * (0.5 / 0.3));
  return 4 / 3 + (Math.min(boldness, WILDEST) - WILD_FROM) * ((4 - 4 / 3) / (WILDEST - WILD_FROM));
}

const wild = (boldness: number) => (boldness < WILD_FROM ? 0 : Math.min(1, (boldness - WILD_FROM) / (WILDEST - WILD_FROM)));
/** The share of made-up sentences that are pure fantasy: from 0 at 1.2 up to 0.4 at 2.5. */
export const fantasyShare = (boldness: number): number => 0.4 * wild(boldness);
/** The share that are boasts (when there is something to boast about): from 0 at 1.2 up to 0.3 at 2.5. */
export const boastShare = (boldness: number): number => 0.3 * wild(boldness);

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The numbers of the `big` boast words, in order. */
const BIG_VALUES = [12, 20, 50, 100];

/** Fill in `{n}`, `{N}`, `{monster}`, `{monsters}`, `{big}`, `{Big}`, `{gold}` and `{code}`. */
function fill(line: string, v: { n?: number; monster?: MonsterKind; big?: string; gold?: number; code?: string }): string {
  return line
    .replace(/\{n\}/g, numberWord(v.n ?? 0))
    .replace(/\{N\}/g, cap(numberWord(v.n ?? 0)))
    .replace(/\{monsters\}/g, `${v.monster ?? ''}s`)
    .replace(/\{monster\}/g, v.monster ?? '')
    .replace(/\{big\}/g, v.big ?? '')
    .replace(/\{Big\}/g, cap(v.big ?? ''))
    .replace(/\{gold\}/g, String(v.gold ?? 0))
    .replace(/\{code\}/g, v.code ?? '');
}

/** Which true parts go first when a saga is too long: higher first. */
const DROP = {
  hearEvent: 9, torch: 8, potion: 7, trap: 6, hit: 5, item: 4, stepEvent: 3, dig: 2, fight: 1, effectEvent: 1, gold: 0,
} as const;

/** A true happening in the middle, with the turn it happened at. */
interface Happening {
  turn: number;
  s: SagaSentence;
  /** Higher goes first when the saga is too long (the last of equals first). */
  drop: number;
  /** Its boast, when it can be inflated. */
  boast?: (rng: Rng) => string;
}

/**
 * Sing the saga of a raid. The same record always gives the same true parts in the same order; the wording and the
 * made-up parts come from `rng`, so "Sing it again" (a new telling's stream) differs.
 */
export function singSaga(rec: RaidRecord, boldness: number, rng: Rng, lines: SagaLines = DATA.saga): SagaSentence[] {
  if (!rec.state.ended) throw new Error('The saga is sung after the raid has ended');
  const pick = (list: readonly string[]) => list[Math.floor(rng() * list.length)];
  const truth = (text: string, part: SagaPart): SagaSentence => ({ text, part, madeUp: false });
  const cast = rec.events?.cast ?? CAST;
  const middle: Happening[] = [];
  const boastWith = (list: readonly string[], v: { n: number; monster?: MonsterKind }) => {
    const bigs = lines.big.filter((_, k) => (BIG_VALUES[k] ?? Infinity) > 2 * v.n);
    return bigs.length ? (r: Rng) => fill(list[Math.floor(r() * list.length)], { ...v, big: bigs[Math.floor(r() * bigs.length)] }) : undefined;
  };

  // Fights: one sentence per kind beaten, at the first.
  const beaten = new Map<MonsterKind, { n: number; turn: number }>();
  const hitBy = new Map<MonsterKind, { n: number; damage: number; turn: number }>();
  let trap = { n: 0, turn: 0 };
  let picked = { n: 0, turn: 0 };
  let dug = { n: 0, turn: 0 };
  let drunk = { n: 0, turn: 0 };
  let lit = 0;
  const items = new Map<number, number>();
  rec.turns.forEach(({ result: r }, k) => {
    const turn = k + 1;
    if (r.beaten) {
      const b = beaten.get(r.beaten.monster.kind) ?? { n: 0, turn };
      b.n++;
      beaten.set(r.beaten.monster.kind, b);
    }
    for (const h of r.hits) {
      const x = hitBy.get(h.kind) ?? { n: 0, damage: 0, turn };
      x.n++;
      x.damage += h.damage;
      hitBy.set(h.kind, x);
    }
    if (r.trapDamage) trap = { n: trap.n + 1, turn: trap.turn || turn };
    if (r.goldGained) picked = { n: picked.n + r.goldGained, turn: picked.turn || turn };
    if (r.dugThrough) dug = { n: dug.n + 1, turn: dug.turn || turn };
    if (r.did === 'drink') drunk = { n: drunk.n + 1, turn: drunk.turn || turn };
    if (r.did === 'light' && !lit) lit = turn;
    if ((r.picked === STRENGTH || r.picked === VIGOUR) && !items.has(r.picked)) items.set(r.picked, turn);
  });

  for (const [monster, b] of beaten) {
    middle.push({
      turn: b.turn, drop: DROP.fight, boast: boastWith(lines.boasts.beaten, { n: b.n, monster }),
      s: truth(fill(pick(b.n === 1 ? lines.beatenOne : lines.beatenMany), { n: b.n, monster }), 'fight'),
    });
  }
  // Hits: the monster that hurt him most.
  const worst = [...hitBy].sort((a, b) => b[1].damage - a[1].damage)[0];
  if (worst) {
    middle.push({
      turn: worst[1].turn, drop: DROP.hit, boast: boastWith(lines.boasts.hits, { n: worst[1].n, monster: worst[0] }),
      s: truth(fill(pick(lines.hits), { monster: worst[0] }), 'hit'),
    });
  }
  if (trap.n) middle.push({ turn: trap.turn, drop: DROP.trap, boast: boastWith(lines.boasts.trap, { n: trap.n }), s: truth(pick(lines.trap), 'trap') });
  if (picked.n) middle.push({ turn: picked.turn, drop: DROP.gold, s: truth(fill(pick(lines.picked), { gold: picked.n }), 'gold') });
  if (dug.n) {
    middle.push({
      turn: dug.turn, drop: DROP.dig, boast: boastWith(lines.boasts.dig, { n: dug.n }),
      s: truth(fill(pick(dug.n === 1 ? lines.digOne : lines.digMany), { n: dug.n }), 'dig'),
    });
  }
  if (drunk.n) middle.push({ turn: drunk.turn, drop: DROP.potion, s: truth(fill(pick(drunk.n === 1 ? lines.potionOne : lines.potions), { n: drunk.n }), 'potion') });
  if (lit) middle.push({ turn: lit, drop: DROP.torch, s: truth(pick(lines.torch), 'torch') });
  for (const [tile, turn] of items) middle.push({ turn, drop: DROP.item, s: truth(pick(tile === STRENGTH ? lines.strength : lines.vigour), 'item') });
  for (const e of rec.events?.met ?? []) {
    const k = cast.find((c) => c.id === e.kind);
    if (!k) continue;
    middle.push({ turn: e.turn, drop: e.effect ? DROP.effectEvent : k.trigger === 'hear' ? DROP.hearEvent : DROP.stepEvent, s: truth(metText(e, cast), 'event') });
  }
  middle.sort((a, b) => a.turn - b.turn);

  // How many made-up sentences; then, if too long, the least telling true parts go (the last ones first), leaving
  // room for the made-up parts expected at this boldness, so a retelling keeps the same true parts.
  const expected = madeUpExpected(boldness);
  const madeUp = Math.floor(expected) + (rng() < expected - Math.floor(expected) ? 1 : 0);
  const trueRoom = MAX_SENTENCES - 2 - Math.ceil(expected);
  while (middle.length > trueRoom) {
    let at = 0;
    middle.forEach((h, k) => { if (h.drop >= middle[at].drop) at = k; });
    middle.splice(at, 1);
  }

  // Borrowed: events placed in this dungeon he never met (or, with events off, any), never one with an effect.
  const met = new Set((rec.events?.met ?? []).map((e) => e.kind));
  const placed = rec.events ? rec.events.spots.map((s) => s.kind) : cast.map((k) => k.id);
  const borrowable: EventKind[] = placed
    .map((id) => cast.find((k) => k.id === id))
    .filter((k): k is EventKind => !!k && !met.has(k.id) && !k.effect);
  const fantasy = [...lines.fantasy];
  const body = middle.map((h) => h.s);
  const boastable = () => middle.map((h, k) => (h.boast && !body[k].madeUp ? k : -1)).filter((k) => k >= 0);
  const made: SagaSentence[] = [];
  for (let k = 0; k < madeUp; k++) {
    const r = rng();
    const canBoast = boastable();
    if (r < fantasyShare(boldness) && fantasy.length) {
      made.push({ text: fantasy.splice(Math.floor(rng() * fantasy.length), 1)[0], part: 'fantasy', madeUp: true });
    } else if (r < fantasyShare(boldness) + boastShare(boldness) && canBoast.length) {
      // A boast takes the place of the true sentence it inflates.
      const at = canBoast[Math.floor(rng() * canBoast.length)];
      body[at] = { text: middle[at].boast!(rng), part: 'boast', madeUp: true };
    } else if (borrowable.length) {
      const kind = borrowable.splice(Math.floor(rng() * borrowable.length), 1)[0];
      made.push({ text: pick(kind.versions), part: 'borrowed', madeUp: true });
    } else if (fantasy.length) {
      made.push({ text: fantasy.splice(Math.floor(rng() * fantasy.length), 1)[0], part: 'fantasy', madeUp: true });
    }
  }
  // Made-up parts slip in anywhere between the opening and the ending.
  for (const m of made) body.splice(Math.floor(rng() * (body.length + 1)), 0, m);

  const s = rec.state;
  const gold = goldOut(s);
  const end = s.ended === 'left' ? (gold > 0 ? 'left' : 'leftNoGold') : s.ended!;
  return [
    truth(fill(pick(lines.openings), { code: codeLabel(rec.code) }), 'opening'),
    ...body,
    truth(fill(pick(lines.endings[end]), { gold }), 'ending'),
  ];
}

/** "6 true, 2 made up". */
export function sagaCount(saga: readonly SagaSentence[]): string {
  const made = saga.filter((s) => s.madeUp).length;
  return `${saga.length - made} true, ${made} made up`;
}
