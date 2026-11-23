import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { CAST, DATA, GOLD_WORDS } from '../src/events';
import { createModel } from '../src/model';
import { raid, sagaStream, storyStreams, type RaidRecord, type RaidTurn } from '../src/raid';
import { mulberry32 } from '../src/rng';
import { MADE_UP_FROM, MAX_SENTENCES, madeUpExpected, sagaCount, singSaga } from '../src/saga';
import { MONSTER_VIEW_KIND } from '../src/sight';
import { TEACHERS } from '../src/teachers';
import { LIKELY_FROM, SURE_FROM, THOUGHT_GAP, Thoughts, placeWord, sureness, thinkAll } from '../src/thoughts';
import { MEMORY_SIZES, inputSize } from '../src/tokens';
import { goldOut, newRaid, view, type StepResult } from '../src/world';
import { teacherRecord } from '../tools/measureEvents';

const CODES = ['BCDEFG', 'EVENTS', 'HJKLMN', 'PQRSTU', 'WXYZ23'];
const records: RaidRecord[] = [];
for (const code of CODES) for (const name of ['warrior', 'thief', 'champion'] as const) records.push(teacherRecord(generateDungeon(code), name));
const model = createModel(inputSize(MEMORY_SIZES.short), 'story');
for (const code of CODES) records.push(raid(model, code, 0, { events: true }), raid(model, code, 1));

/** A made-up turn: a walk east at probability p, with these results. */
function turn(p: number, r: Partial<StepResult> = {}, extra: Partial<RaidTurn> = {}): RaidTurn {
  const s = newRaid(generateDungeon('TOY'));
  const sample = new Float32Array(9);
  sample[1] = p;
  return {
    input: [], probs: sample, sample, view: view(s), action: 1,
    result: { action: 1, did: 'walk', goldGained: 0, dugThrough: false, trapDamage: 0, hits: [], monstersTrapped: [], torchOut: false, ended: null, ...r },
    after: { hp: 14, maxHp: 14, gold: 0, potions: 2, torches: 1, torchLeft: 0, timeLeft: 150 },
    ...extra,
  };
}

describe('his thoughts', () => {
  it('sound as sure as he was', () => {
    expect(sureness(SURE_FROM)).toBe('sure');
    expect(sureness(LIKELY_FROM)).toBe('likely');
    expect(sureness(LIKELY_FROM - 0.01)).toBe('unsure');
    const th = new Thoughts(mulberry32(1));
    const fill = (l: string) => l.replace('{A}', 'East').replace('{a}', 'east');
    for (let k = 0; k < 20; k++) {
      expect(DATA.thoughts.sure.map(fill)).toContain(th.decision(1, 0.9));
      expect(DATA.thoughts.unsure.map(fill)).toContain(th.decision(1, 0.1));
    }
  });

  it('always speak up for a hit, a monster beaten, an event and the end', () => {
    const th = new Thoughts(mulberry32(1));
    expect(DATA.thoughts.hit.troll).toContain(th.after(turn(0.5, { hits: [{ kind: 'rat', damage: 1 }, { kind: 'troll', damage: 4 }] }))![0]);
    expect(DATA.thoughts.beaten.goblin).toContain(th.after(turn(0.5, { beaten: { monster: { kind: 'goblin', pos: 0, hp: 0, rich: false }, gold: 3, at: 0 } }))![0]);
    const ghost = CAST.find((k) => k.effect === 'giveTorch')!;
    expect(ghost.thoughts).toContain(th.after(turn(0.5, {}, { events: [{ spot: 0, kind: ghost.id, turn: 3, version: 0, effect: 'giveTorch' }] }))![0]);
    expect(ghost.quietThoughts).toContain(th.after(turn(0.5, {}, { events: [{ spot: 1, kind: ghost.id, turn: 4, version: 0, quiet: true }] }))![0]);
    expect(DATA.thoughts.endings.knockedOut).toContain(th.after(turn(0.5, { ended: 'knockedOut' }))![0]);
  });

  it('talk about a monster in sight, in compass words', () => {
    const t = turn(0.9);
    t.view[7] = { kind: MONSTER_VIEW_KIND('troll'), wounded: false, rich: false }; // one up from him
    const said = new Thoughts(mulberry32(3)).after(t)!;
    expect(DATA.thoughts.monster.troll.map((l) => l.replace('{dir}', 'to the north'))).toContain(said[0]);
    expect(placeWord(1, 1)).toBe('to the south-east');
    expect(placeWord(-2, 0)).toBe('to the west');
  });

  it('keep a gap between ordinary thoughts', () => {
    for (const r of records) {
      const said = thinkAll(r.turns, storyStreams(r.code, r.n).thoughts, r.events?.cast);
      let last = -100;
      said.forEach((lines, k) => {
        if (!lines) return;
        const t = r.turns[k];
        const always = t.result.ended || t.result.hits.length || t.result.trapDamage || t.result.beaten || t.events?.length
          || r.turns.slice(Math.max(0, k - 3), k).some((x) => x.events?.length);
        if (!always) expect(k - last).toBeGreaterThanOrEqual(THOUGHT_GAP);
        last = k;
      });
      expect(said[said.length - 1]).not.toBeNull(); // the end always gets one
    }
  });

  it('are the same for the same stream, and never touch the record', () => {
    const r = records[0];
    const copy = structuredClone(r.turns);
    const a = thinkAll(r.turns, storyStreams(r.code, r.n).thoughts);
    expect(thinkAll(r.turns, storyStreams(r.code, r.n).thoughts)).toEqual(a);
    expect(r.turns).toEqual(copy);
  });
});

describe('the saga', () => {
  const boldnesses = [0, 0.4, 0.7, 1, 1.5, 2, 2.5];

  it('never makes up the ending or the gold carried out', () => {
    for (const r of records) {
      for (const b of boldnesses) {
        for (let telling = 0; telling < 3; telling++) {
          const saga = singSaga(r, b, sagaStream(r.code, r.n, telling));
          const end = saga[saga.length - 1];
          expect(end).toMatchObject({ part: 'ending', madeUp: false });
          const gold = goldOut(r.state);
          if (gold > 0) expect(end.text).toContain(`${gold} gold`);
          const lines = DATA.saga.endings[r.state.ended === 'left' ? (gold > 0 ? 'left' : 'leftNoGold') : r.state.ended!];
          expect(lines.map((l) => l.replace('{gold}', String(gold)))).toContain(end.text);
          expect(saga[0]).toMatchObject({ part: 'opening', madeUp: false });
          for (const s of saga) if (s.madeUp) expect(s.text).not.toMatch(GOLD_WORDS);
          expect(saga.filter((s) => s.part === 'ending').length).toBe(1);
        }
      }
    }
  });

  it('tells the gold he picked up truly', () => {
    for (const r of records) {
      const picked = r.turns.reduce((g, t) => g + t.result.goldGained, 0);
      const saga = singSaga(r, 0, sagaStream(r.code, r.n));
      const s = saga.find((x) => x.part === 'gold');
      if (picked) expect(s?.text).toContain(`${picked} gold`);
      else expect(s).toBeUndefined();
    }
  });

  it('makes nothing up below 0.5, and more the bolder the skald', () => {
    const made = (b: number) => records.reduce((n, r) => n + singSaga(r, b, sagaStream(r.code, r.n)).filter((s) => s.madeUp).length, 0);
    expect(made(0)).toBe(0);
    expect(made(MADE_UP_FROM - 0.01)).toBe(0);
    expect(made(1)).toBeGreaterThan(0);
    expect(made(2.5)).toBeGreaterThan(made(1));
    expect(madeUpExpected(2.5)).toBeCloseTo(4);
  });

  it('borrows only events placed here that he never met, none with an effect', () => {
    let borrowed = 0;
    for (const r of records) {
      const versions = (ids: number[]) => ids.flatMap((id) => CAST.find((k) => k.id === id)!.versions);
      const met = new Set(r.events?.met.map((e) => e.kind));
      const ok = r.events
        ? versions(r.events.spots.map((s) => s.kind).filter((id) => !met.has(id) && !CAST.find((k) => k.id === id)!.effect))
        : versions(CAST.filter((k) => !k.effect).map((k) => k.id));
      for (let telling = 0; telling < 5; telling++) {
        for (const s of singSaga(r, 1.1, sagaStream(r.code, r.n, telling))) {
          if (s.part !== 'borrowed') continue;
          borrowed++;
          expect(ok).toContain(s.text);
        }
      }
    }
    expect(borrowed).toBeGreaterThan(0);
  });

  it('boasts and dreams only when bold, a boast in place of the true sentence it inflates', () => {
    const parts = (b: number) => records.flatMap((r) => [0, 1, 2].flatMap((t) => singSaga(r, b, sagaStream(r.code, r.n, t)).map((s) => s.part)));
    expect(parts(1.1)).not.toContain('boast');
    expect(parts(1.1)).not.toContain('fantasy');
    const wild = parts(2.5);
    expect(wild).toContain('boast');
    expect(wild).toContain('fantasy');
    for (const r of records) {
      for (let t = 0; t < 5; t++) {
        const saga = singSaga(r, 2.5, sagaStream(r.code, r.n, t));
        const fights = saga.filter((s) => s.part === 'fight' || (s.part === 'boast' && /fell|beat/.test(s.text)));
        // One sentence per kind beaten, true or boasted, never both.
        const kinds = new Set(r.turns.flatMap((x) => (x.result.beaten ? [x.result.beaten.monster.kind] : [])));
        expect(fights.length).toBeLessThanOrEqual(kinds.size);
      }
    }
  });

  it('keeps to its length, and tells the true parts again the same way at the same boldness', () => {
    for (const r of records) {
      for (const b of boldnesses) {
        const a = singSaga(r, b, sagaStream(r.code, r.n, 0));
        expect(a.length).toBeLessThanOrEqual(MAX_SENTENCES);
        expect(singSaga(r, b, sagaStream(r.code, r.n, 0))).toEqual(a);
      }
      const trueParts = (t: number) => singSaga(r, 0, sagaStream(r.code, r.n, t)).map((s) => s.part);
      expect(trueParts(1)).toEqual(trueParts(0));
    }
  });

  it('counts true and made-up sentences', () => {
    expect(sagaCount([
      { text: 'a', part: 'opening', madeUp: false }, { text: 'b', part: 'fantasy', madeUp: true }, { text: 'c', part: 'ending', madeUp: false },
    ])).toBe('2 true, 1 made up');
  });

  it('is sung only after the raid has ended', () => {
    const r = records[0];
    expect(() => singSaga({ ...r, state: { ...r.state, ended: null } }, 1, mulberry32(1))).toThrow();
  });

  it('is told for every teacher', () => {
    for (const name of TEACHERS) {
      const r = teacherRecord(generateDungeon('BCDEFG'), name);
      expect(singSaga(r, 1, sagaStream(r.code, r.n)).length).toBeGreaterThanOrEqual(2);
    }
  });
});
