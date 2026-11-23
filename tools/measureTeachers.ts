/**
 * How each teacher plays, over many dungeon codes: `npm run measure:teachers -- [count]`. Every teacher raids the
 * same codes (raid 0 of each). The pickaxe dwarf is measured twice: with his own pickaxe (how his lessons are
 * played), and as copied by the barbarian (the same plans, digging at the barbarian's real attack).
 */
import { generateDungeon } from '../src/dungeon';
import { randomCode, rngFrom } from '../src/rng';
import { TEACHERS, TEACHER_RULES, teacherRaid, type TeacherName, type TeacherRules } from '../src/teachers';

interface Row {
  label: string; raids: number; gold: number; left: number; leftEmpty: number; knockedOut: number; lockedIn: number;
  turns: number; potions: number; torches: number; dug: number; blows: number; waits: number; wasted: number;
  hpLost: number; fights: number; trollSeenKo: number; trollSeen: number;
}

function measure(label: string, name: TeacherName, codes: string[], o: { ownPickaxe?: boolean; rules?: TeacherRules } = {}): Row {
  const row: Row = {
    label, raids: 0, gold: 0, left: 0, leftEmpty: 0, knockedOut: 0, lockedIn: 0, turns: 0, potions: 0, torches: 0,
    dug: 0, blows: 0, waits: 0, wasted: 0, hpLost: 0, fights: 0, trollSeenKo: 0, trollSeen: 0,
  };
  for (const code of codes) {
    let sawTroll = false;
    const { state, turns } = teacherRaid(generateDungeon(code), name, 0, {
      ...o,
      onTurn: (_s, t) => { if (t.knowledge.monsters.some((m) => m.kind === 'troll')) sawTroll = true; },
    });
    row.raids++;
    if (state.ended === 'left') {
      row.gold += state.gold;
      if (state.gold > 0) row.left++;
      else row.leftEmpty++;
    } else if (state.ended === 'knockedOut') row.knockedOut++;
    else row.lockedIn++;
    row.turns += state.turn;
    for (const { result: r } of turns) {
      if (r.did === 'drink') row.potions++;
      if (r.did === 'light') row.torches++;
      if (r.did === 'dig') row.blows++;
      if (r.dugThrough) row.dug++;
      if (r.did === 'wait') row.waits++;
      if (r.did === 'nothing') row.wasted++;
      if (r.beaten) row.fights++;
      row.hpLost += r.trapDamage + r.hits.reduce((s, h) => s + h.damage, 0);
    }
    if (sawTroll) {
      row.trollSeen++;
      if (state.ended === 'knockedOut') row.trollSeenKo++;
    }
  }
  return row;
}

const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`.padStart(5);
const avg = (n: number, of: number, digits = 1) => (n / of).toFixed(digits).padStart(6);

export function main(args: string[]) {
  const count = Number(args[0] ?? 1000);
  const rng = rngFrom('measure-teachers');
  const codes = Array.from({ length: count }, () => randomCode(rng));
  const rows: Row[] = [];
  // Try other rules without editing the teachers: --try 'name:{"timeMargin":20}' (any number of times).
  const tries = args.flatMap((a, k) => (args[k - 1] === '--try' ? [a] : []));
  for (const t of tries) {
    const [name, json] = [t.slice(0, t.indexOf(':')), t.slice(t.indexOf(':') + 1)] as [TeacherName, string];
    rows.push(measure(`${name} ${json}`.slice(0, 17), name, codes, { rules: { ...TEACHER_RULES[name], ...JSON.parse(json) } }));
  }
  if (tries.length && args.includes('--only-tries')) return print(count, rows);
  for (const name of TEACHERS) rows.push(measure(name, name, codes));
  rows.push(measure('pickaxe, copied', 'pickaxe', codes, { ownPickaxe: false }));
  if (args.includes('--no-wait')) {
    for (const name of ['healer', 'dwarf'] as const) {
      rows.push(measure(`${name}, no wait`, name, codes, { rules: { ...TEACHER_RULES[name], waits: false } }));
    }
  }
  print(count, rows);
}

function print(count: number, rows: Row[]) {
  console.log(`${count} dungeon codes, raid 0 each\n`);
  console.log('teacher            gold out   left  left/0   k.o. locked  turns  potions torches  blows  dug  waits wasted hp lost  beaten  k.o. if troll seen');
  for (const r of rows) {
    console.log(`${r.label.padEnd(17)} ${avg(r.gold, r.raids)}   ${pct(r.left, r.raids)}  ${pct(r.leftEmpty, r.raids)}  ` +
      `${pct(r.knockedOut, r.raids)}  ${pct(r.lockedIn, r.raids)} ${avg(r.turns, r.raids, 0)}   ${avg(r.potions, r.raids, 2)}  ` +
      `${avg(r.torches, r.raids, 2)} ${avg(r.blows, r.raids)} ${avg(r.dug, r.raids)} ${avg(r.waits, r.raids)} ` +
      `${avg(r.wasted, r.raids)}  ${avg(r.hpLost, r.raids)}  ${avg(r.fights, r.raids)}   ` +
      `${pct(r.trollSeenKo, Math.max(1, r.trollSeen))} of ${pct(r.trollSeen, r.raids)}`);
  }
}
