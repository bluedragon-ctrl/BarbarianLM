import { describe, expect, it } from 'vitest';
import { generateDungeon, roomTiles } from '../src/dungeon';
import {
  CAST, DATA, EFFECT_SIZE, EventTracker, NEAR_STAIRS, SPOT_APART, SPOT_COUNT, applyEffect, checkEventData, metText,
  placeEvents, placeTests, spotTiles, spotsLabel, type EventKind,
} from '../src/events';
import { createModel } from '../src/model';
import { raid, type RaidRecord } from '../src/raid';
import { countRaid, manyRaids, newCounts } from '../src/raids';
import { mulberry32 } from '../src/rng';
import { squareDistance } from '../src/sight';
import { FLOOR, MONSTER_STATS, TRAP } from '../src/tiles';
import { MEMORY_SIZES, inputSize } from '../src/tokens';
import { LEFT, RIGHT, RULES, newRaid, step } from '../src/world';
import { cell, raidFrom } from './maps';

const CODES = ['BCDEFG', 'EVENTS', 'HJKLMN', 'PQRSTU', 'WXYZ23', 'ABCDEF', 'Q2W3E4', 'ZZZZZZ'];

describe('the events data file', () => {
  it('has the right shape', () => {
    expect(checkEventData(DATA)).toEqual([]);
    expect(CAST.length).toBeGreaterThanOrEqual(25);
  });

  it('has every effect, each with quiet versions where it can find nothing to change', () => {
    const effects = new Set(CAST.map((k) => k.effect).filter(Boolean));
    expect([...effects].sort()).toEqual(Object.keys(EFFECT_SIZE).sort());
  });

  it('catches mistakes', () => {
    const bad = structuredClone(DATA);
    bad.events.push({ ...bad.events[0], fits: 'moon' as never });
    bad.events.push({ ...bad.events[1], id: 99, trigger: 'hear' });
    bad.events.push({ ...bad.events[0], id: 100, quiet: undefined, popup: 'A much too long pop-up word' });
    bad.events.push({ ...bad.events[6], id: 101, versions: ['He found a coin.', 'Gold!'] });
    bad.saga.fantasy.push('He found a mountain of gold.');
    bad.saga.endings.left = ['He left.'];
    const errors = checkEventData(bad).join('\n');
    for (const want of ['unknown place', 'id used twice', 'an effect needs the step trigger', 'needs at least 1 quiet version',
      'pop-up longer', 'must not mention gold', 'made-up line mentions gold', 'must say {gold}']) {
      expect(errors).toContain(want);
    }
  });
});

describe('placing events', () => {
  it('puts spots on bare floor, apart, and each kind where it fits, at most once', () => {
    for (const code of CODES) {
      const d = generateDungeon(code);
      const fits = placeTests(d);
      const spots = placeEvents(d, spotsLabel(code));
      expect(spots.length).toBeGreaterThan(SPOT_COUNT / 2);
      expect(spots.length).toBeLessThanOrEqual(SPOT_COUNT);
      expect(new Set(spots.map((s) => s.kind)).size).toBe(spots.length);
      for (const s of spots) {
        expect(d.tiles[s.i]).toBe(FLOOR);
        expect(d.monsters.some((m) => m.pos === s.i)).toBe(false);
        expect(fits(CAST.find((k) => k.id === s.kind)!.fits, s.i)).toBe(true);
        for (const o of spots) if (o !== s) expect(squareDistance(d.size, s.i, o.i)).toBeGreaterThan(SPOT_APART);
      }
    }
  });

  it('gives a kind with its own place first, so "anywhere" kinds fill the rest', () => {
    const d = generateDungeon('BCDEFG');
    const fits = placeTests(d);
    for (const s of placeEvents(d, spotsLabel('BCDEFG'))) {
      if (CAST.find((k) => k.id === s.kind)!.fits !== 'anywhere') continue;
      // The spot could take no special kind, or all of those that fit are used elsewhere.
      const special = CAST.filter((k) => k.fits !== 'anywhere' && fits(k.fits, s.i));
      expect(special.every((k) => placeEvents(d, spotsLabel('BCDEFG')).some((o) => o.kind === k.id))).toBe(true);
    }
  });

  it('is fixed per code, or new every raid, and never changes the dungeon', () => {
    const before = generateDungeon('EVENTS');
    const d = generateDungeon('EVENTS');
    const fixed = placeEvents(d, spotsLabel('EVENTS'));
    expect(placeEvents(d, spotsLabel('EVENTS'))).toEqual(fixed);
    expect(placeEvents(d, spotsLabel('EVENTS', 1))).not.toEqual(placeEvents(d, spotsLabel('EVENTS', 2)));
    expect(d).toEqual(before);
  });

  it('never moves the spots when kinds are added to the cast', () => {
    const d = generateDungeon('HJKLMN');
    const extra: EventKind = { ...CAST[6], id: 500, name: 'Extra' };
    const tiles = spotTiles(d, spotsLabel('HJKLMN'));
    for (const cast of [CAST, [...CAST, extra]]) {
      for (const s of placeEvents(d, spotsLabel('HJKLMN'), cast)) expect(tiles).toContain(s.i);
    }
  });

  it('knows its places', () => {
    const d = generateDungeon('PQRSTU');
    const fits = placeTests(d);
    const room = new Set(d.rooms.flatMap((r) => roomTiles(d.size, r)));
    const stairsNext = d.tiles.findIndex((t, i) => t === FLOOR && squareDistance(d.size, i, d.stairs) === 1);
    d.tiles.forEach((t, i) => {
      if (t !== FLOOR) return;
      expect(fits('room', i)).toBe(room.has(i));
      expect(fits('corridor', i)).toBe(!room.has(i));
      expect(fits('anywhere', i)).toBe(true);
      const guard = d.monsters.some((m) => !MONSTER_STATS[m.kind].mobile && squareDistance(d.size, m.pos, i) <= 2);
      expect(fits('nearGuard', i)).toBe(guard);
      const trap = d.tiles.some((u, j) => u === TRAP && squareDistance(d.size, i, j) <= 1);
      expect(fits('nearTrap', i)).toBe(trap);
    });
    if (stairsNext >= 0) expect(fits('nearStairs', stairsNext)).toBe(true);
    expect(NEAR_STAIRS).toBe(4);
  });
});

describe('effects', () => {
  it('change his stats, or find nothing to change', () => {
    const s = newRaid(generateDungeon('BCDEFG'));
    expect(applyEffect(s, 'takeGold')).toBeNull();
    expect(applyEffect(s, 'giveGold')).toEqual({ gold: 3 });
    expect(applyEffect(s, 'takeGold')).toEqual({ gold: -1 });
    expect(s.gold).toBe(2);
    expect(applyEffect(s, 'heal')).toBeNull();
    s.hp = s.maxHp - 1;
    expect(applyEffect(s, 'heal')).toEqual({ gold: 0 });
    expect(s.hp).toBe(s.maxHp);
    s.hp = 5;
    applyEffect(s, 'heal');
    expect(s.hp).toBe(8);
    expect(applyEffect(s, 'drainTorch')).toBeNull();
    s.torchLeft = 12;
    applyEffect(s, 'drainTorch');
    expect(s.torchLeft).toBe(7);
    s.torchLeft = 3;
    applyEffect(s, 'drainTorch');
    expect(s.torchLeft).toBe(0);
    s.torches = RULES.packMax - 1;
    expect(applyEffect(s, 'giveTorch')).toEqual({ gold: 0 });
    expect(s.torches).toBe(RULES.packMax);
    expect(applyEffect(s, 'giveTorch')).toBeNull();
  });
});

describe('following a raid', () => {
  const kind = (k: Partial<EventKind> & Pick<EventKind, 'id' | 'trigger'>): EventKind => ({
    name: 'Test', fits: 'anywhere', versions: ['one', 'two'], thoughts: ['hm'], popup: 'Hm!', ...k,
  });

  it('sets off a step event when he steps onto it, once a raid, and applies its effect', () => {
    const s = raidFrom(['@...', '....']);
    const spot = cell(s, 1, 0);
    const bat = kind({ id: 1, trigger: 'step', effect: 'giveGold', deed: 'coins' });
    const tr = new EventTracker({ spots: [{ i: spot, kind: 1 }], cast: [bat] }, mulberry32(1), s);
    const rng = mulberry32(2);
    step(s, RIGHT, rng);
    const met = tr.after(s);
    expect(met).toMatchObject([{ spot, kind: 1, turn: 1, effect: 'giveGold', gold: 3 }]);
    expect(s.gold).toBe(3);
    step(s, LEFT, rng);
    tr.after(s);
    step(s, RIGHT, rng);
    expect(tr.after(s)).toEqual([]);
    expect(tr.met.length).toBe(1);
  });

  it('turns out quiet when the effect finds nothing', () => {
    const s = raidFrom(['@...']);
    const bat = kind({ id: 1, trigger: 'step', effect: 'takeGold', deed: 'a coin', quiet: ['nothing to take'] });
    const tr = new EventTracker({ spots: [{ i: cell(s, 1, 0), kind: 1 }], cast: [bat] }, mulberry32(1), s);
    step(s, RIGHT, mulberry32(2));
    const [e] = tr.after(s);
    expect(e.quiet).toBe(true);
    expect(e.effect).toBeUndefined();
    expect(metText(e, [bat])).toBe('nothing to take');
  });

  it('sets off a hear event when the spot comes into his view', () => {
    const s = raidFrom(['@....']);
    const spot = cell(s, 3, 0);
    const tr = new EventTracker({ spots: [{ i: spot, kind: 2 }], cast: [kind({ id: 2, trigger: 'hear' })] }, mulberry32(1), s);
    const rng = mulberry32(2);
    step(s, RIGHT, rng);
    expect(tr.after(s)).toEqual([]); // 2 away, in the dark
    step(s, RIGHT, rng);
    expect(tr.after(s).map((e) => e.spot)).toEqual([spot]);
  });

  it('sets off nothing once the trip has ended', () => {
    const s = raidFrom(['@.']);
    const tr = new EventTracker({ spots: [{ i: cell(s, 1, 0), kind: 1 }], cast: [kind({ id: 1, trigger: 'step' })] }, mulberry32(1), s);
    s.timeLeft = 1;
    step(s, RIGHT, mulberry32(2));
    expect(s.ended).toBe('lockedIn');
    expect(tr.after(s)).toEqual([]);
  });

  it('rolls an event with a chance once, from the story stream', () => {
    const never = kind({ id: 1, trigger: 'step', chance: 1e-9 });
    const s = raidFrom(['@..']);
    const tr = new EventTracker({ spots: [{ i: cell(s, 1, 0), kind: 1 }], cast: [never] }, mulberry32(1), s);
    step(s, RIGHT, mulberry32(2));
    expect(tr.after(s)).toEqual([]);
    step(s, LEFT, mulberry32(2));
    tr.after(s);
    step(s, RIGHT, mulberry32(2));
    expect(tr.after(s)).toEqual([]);
  });
});

describe('the random-stream promise', () => {
  const model = createModel(inputSize(MEMORY_SIZES.short), 'events');
  const trace = (r: RaidRecord) => r.turns.map((t) => [t.action, t.result.did, t.result.hits.length]);
  const firstEffect = (r: RaidRecord) => r.turns.findIndex((t) => t.events?.some((e) => e.effect));
  const noEffects = CAST.map(({ effect: _e, deed: _d, quiet: _q, quietThoughts: _t, ...k }) => k);
  const reworded = CAST.map((k) => ({ ...k, versions: k.versions.map((v) => `${v} (again)`), thoughts: ['Hm.'] }));

  it('events on or off: the same actions and monster moves up to the first event with an effect', () => {
    let effects = 0;
    let met = 0;
    for (const code of CODES) {
      for (const n of [0, 1]) {
        const off = raid(model, code, n);
        const on = raid(model, code, n, { events: true });
        met += on.events!.met.length;
        const k = firstEffect(on);
        if (k >= 0) effects++;
        const upTo = k < 0 ? on.turns.length : k + 1;
        expect(trace(on).slice(0, upTo)).toEqual(trace(off).slice(0, upTo));
      }
    }
    expect(met).toBeGreaterThan(0);
    expect(effects).toBeGreaterThan(0);
  });

  it('events without effects, or with other wording, change nothing at all', () => {
    for (const code of CODES.slice(0, 4)) {
      const off = raid(model, code, 0);
      const quiet = raid(model, code, 0, { events: { cast: noEffects } });
      expect(trace(quiet)).toEqual(trace(off));
      expect(quiet.state).toEqual(off.state);
      const a = raid(model, code, 0, { events: true });
      const b = raid(model, code, 0, { events: { cast: reworded } });
      expect(trace(b)).toEqual(trace(a));
      expect(b.events!.met).toEqual(a.events!.met);
      expect(b.state).toEqual(a.state);
    }
  });

  it('keeps each turn\'s stats after its events, so the next input shows an effect', () => {
    for (const code of CODES) {
      const r = raid(model, code, 0, { events: true });
      r.turns.forEach((t, k) => {
        const before = k ? r.turns[k - 1].after.gold : 0;
        const events = (t.events ?? []).reduce((g, e) => g + (e.gold ?? 0), 0);
        expect(t.after.gold).toBe(before + t.result.goldGained + events);
      });
    }
  });

  it('new spots every raid by default, fixed ones on request', () => {
    const a = raid(model, 'EVENTS', 0, { events: true }).events!.spots;
    const b = raid(model, 'EVENTS', 1, { events: true }).events!.spots;
    expect(b).not.toEqual(a);
    const c = raid(model, 'EVENTS', 0, { events: { newSpots: false } }).events!.spots;
    const e = raid(model, 'EVENTS', 1, { events: { newSpots: false } }).events!.spots;
    expect(e).toEqual(c);
  });
});

describe('counting events over many raids', () => {
  it('counts events met, their effects and their net change to his gold', () => {
    const model = createModel(inputSize(MEMORY_SIZES.short), 'events');
    const plan = { codes: CODES };
    const off = manyRaids(model, plan);
    expect(off.events).toBe(0);
    const on = manyRaids(model, plan, { events: true });
    let met = 0, effects = 0, gold = 0;
    for (const code of CODES) {
      for (const e of raid(model, code, 0, { events: true }).events!.met) {
        met++;
        if (e.effect) effects++;
        gold += e.gold ?? 0;
      }
    }
    expect([on.events, on.eventEffects, on.eventGold]).toEqual([met, effects, gold]);
    expect(countRaid(newCounts(), raid(model, 'BCDEFG', 0)).events).toBe(0);
  });
});
