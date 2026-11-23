/**
 * Hidden events over many dungeon codes: `npm run measure:events -- [count]`. How many spots each dungeon gets, how
 * often each kind is placed, and what each teacher meets on raid 0 (events, effects, their net change to his gold).
 * `npm run measure:events -- --show CODE [teacher] [boldness]` plays one teacher raid with events on and prints his
 * thoughts and the saga.
 */
import { generateDungeon, type Dungeon } from '../src/dungeon';
import { CAST, EventTracker, placeEvents, spotsLabel, type EventMet } from '../src/events';
import { sagaStream, storyStreams, type RaidRecord, type RaidTurn } from '../src/raid';
import { randomCode, rngFrom } from '../src/rng';
import { sagaCount, singSaga } from '../src/saga';
import { TEACHERS, teacherRaid, type TeacherName } from '../src/teachers';
import { Thoughts } from '../src/thoughts';
import { ACTIONS, view } from '../src/world';
import type { ViewCell } from '../src/sight';

/** A teacher's raid with events on, as a raid record (his sureness is 1 on every action). */
export function teacherRecord(d: Dungeon, name: TeacherName, n = 0): RaidRecord {
  const spots = placeEvents(d, spotsLabel(d.code, n));
  let tracker: EventTracker | null = null;
  const turns: RaidTurn[] = [];
  let seen: ViewCell[] = [];
  const { state } = teacherRaid(d, name, n, {
    beforeStep: (s) => {
      tracker ??= new EventTracker({ spots, cast: CAST }, storyStreams(d.code, n).events, s);
      seen = view(s);
    },
    onTurn: (s, _t, turn) => {
      const met = tracker!.after(s);
      const sample = new Float32Array(ACTIONS);
      sample[turn.action] = 1;
      const rt: RaidTurn = {
        input: [], probs: sample, sample, view: seen, action: turn.action, result: turn.result,
        after: { hp: s.hp, maxHp: s.maxHp, gold: s.gold, potions: s.potions, torches: s.torches, torchLeft: s.torchLeft, timeLeft: s.timeLeft },
      };
      if (met.length) rt.events = met;
      turns.push(rt);
    },
  });
  return { code: d.code, n, state, turns, events: { spots, cast: CAST, met: tracker ? (tracker as EventTracker).met : [] } };
}

function show(code: string, name: TeacherName, boldness: number): void {
  const rec = teacherRecord(generateDungeon(code), name);
  const th = new Thoughts(storyStreams(code, 0).thoughts);
  console.log(`${code}, the ${name}: ${rec.state.ended} with ${rec.state.gold} gold after ${rec.turns.length} turns`);
  console.log(`Spots: ${rec.events!.spots.map((s) => CAST.find((k) => k.id === s.kind)!.name).join(', ')}\n`);
  rec.turns.forEach((t, k) => {
    const said = th.after(t);
    const ev = (t.events ?? []).map((e) => `[${CAST.find((c) => c.id === e.kind)!.popup}${e.effect ? ` ${e.effect}` : e.quiet ? ' quiet' : ''}]`).join(' ');
    if (said || ev) console.log(`${String(k + 1).padStart(3)} ${ev} ${said ? `"${said.join(' ')}"` : ''}`);
  });
  for (const telling of [0, 1]) {
    const saga = singSaga(rec, boldness, sagaStream(code, 0, telling));
    console.log(`\nSaga at boldness ${boldness} (${sagaCount(saga)}):`);
    for (const s of saga) console.log(`  ${s.madeUp ? `~ (${s.part})` : '*'} ${s.text}`);
  }
}

export function main(args: string[]): void {
  if (args[0] === '--show') {
    show(args[1] ?? 'BCDEFG', (args[2] ?? 'champion') as TeacherName, Number(args[3] ?? 1.5));
    return;
  }
  const count = Number(args[0] ?? 1000);
  const rng = rngFrom('measure-events');
  const codes = Array.from({ length: count }, () => randomCode(rng));
  const placed = new Map<number, number>();
  let spots = 0;
  for (const code of codes) {
    const s = placeEvents(generateDungeon(code), spotsLabel(code, 0));
    spots += s.length;
    for (const x of s) placed.set(x.kind, (placed.get(x.kind) ?? 0) + 1);
  }
  console.log(`${count} codes: ${(spots / count).toFixed(1)} spots a dungeon\n`);
  console.log('Kind'.padEnd(26) + 'place'.padEnd(12) + 'trigger'.padEnd(9) + 'placed in');
  for (const k of CAST) {
    console.log(k.name.padEnd(26) + k.fits.padEnd(12) + k.trigger.padEnd(9) + `${((100 * (placed.get(k.id) ?? 0)) / count).toFixed(0)}%`);
  }
  console.log('\nTeacher'.padEnd(11) + 'met'.padStart(6) + 'step'.padStart(6) + 'hear'.padStart(6) + 'effects'.padStart(9) + 'quiet'.padStart(7) + '  net gold');
  for (const name of TEACHERS) {
    let met = 0, step = 0, effects = 0, quiet = 0, gold = 0;
    const byEffect = new Map<string, number>();
    for (const code of codes) {
      const rec = teacherRecord(generateDungeon(code), name);
      for (const e of rec.events!.met as EventMet[]) {
        met++;
        if (CAST.find((k) => k.id === e.kind)!.trigger === 'step') step++;
        if (e.effect) { effects++; byEffect.set(e.effect, (byEffect.get(e.effect) ?? 0) + 1); }
        if (e.quiet) quiet++;
        gold += e.gold ?? 0;
      }
    }
    const per = (x: number) => (x / count).toFixed(2).padStart(6);
    console.log(name.padEnd(10) + per(met) + per(step) + per(met - step) + per(effects).padStart(9) + per(quiet).padStart(7)
      + `  ${gold >= 0 ? '+' : ''}${gold} over ${count} raids  (${[...byEffect].map(([e, n]) => `${e} ${n}`).join(', ')})`);
  }
}
