import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { randomCode, rngFrom } from '../src/rng';
import { seenTiles } from '../src/sight';
import {
  TEACHERS, TeacherRaid, fightDamage, fightReserve, firstStep, newKnowledge, newTeacher, observe, plan, teacherRaid, wayBack,
  type Knowledge, type PlanOptions, type Teacher, type TeacherName,
} from '../src/teachers';
import { DOWN, DRINK, LEAVE, LEFT, RIGHT, RULES, UP, WAIT, bumpTarget, torchLit, type RaidState } from '../src/world';
import { cell, raidFrom } from './maps';

const walk: PlanOptions = { attack: 2, dig: 'never', mayFight: () => true, hpWeight: 0 };

/** Knowledge of the whole map, as if he had seen all of it. */
function seeAll(s: RaidState): Knowledge {
  const k = newKnowledge(s);
  k.seen.fill(1);
  k.tiles = s.map.tiles.slice();
  k.wallHp = s.map.wallHp.slice();
  k.gold = s.map.gold.slice();
  k.monsters = s.monsters.map((m) => ({ ...m, seenAt: s.turn }));
  return k;
}

/** A teacher that has seen the whole map (for rules that are about what it does with what it knows). */
function knowing(name: TeacherName, s: RaidState): Teacher {
  const t = newTeacher(name, s);
  Object.assign(t.knowledge, seeAll(s));
  return t;
}

describe('the planner', () => {
  it('walks the shortest way over known tiles, first step in the order up, right, down, left', () => {
    const s = raidFrom(['@...', '....']);
    const p = plan(seeAll(s), s.pos, walk);
    const to = cell(s, 3, 1);
    expect(p.turns[to]).toBe(4);
    expect(p.damage[to]).toBe(0);
    expect(firstStep(p, to)).toBe(cell(s, 1, 0)); // right comes before down
    expect(firstStep(p, s.pos)).toBe(-1);
  });

  it('never plans over tiles he has not seen', () => {
    const s = raidFrom(['@....']);
    const k = newKnowledge(s);
    observe(k, s); // in the dark: only his 8 neighbours
    const p = plan(k, s.pos, walk);
    expect(p.cost[cell(s, 1, 0)]).toBe(1);
    expect(p.cost[cell(s, 2, 0)]).toBe(-1);
  });

  it('digs at his real attack, or in one blow with the pickaxe, or goes round', () => {
    // Through the wall: 2 steps plus the blows; round it: 6 steps.
    const s = raidFrom(['@#.', '.#.', '...']);
    const k = seeAll(s);
    const to = cell(s, 2, 0);
    expect(plan(k, s.pos, walk).turns[to]).toBe(6);
    expect(plan(k, s.pos, { ...walk, dig: 'real' }).turns[to]).toBe(2 + 3); // 6 HP at attack 2: 3 blows
    expect(plan(k, s.pos, { ...walk, dig: 'real', attack: 3 }).turns[to]).toBe(2 + 2);
    expect(plan(k, s.pos, { ...walk, dig: 'pickaxe' }).turns[to]).toBe(2 + 1);
    s.map.wallHp[cell(s, 1, 0)] = 3; // cracked
    expect(plan(seeAll(s), s.pos, { ...walk, dig: 'real' }).turns[to]).toBe(2 + 2);
  });

  it('counts a fight as its blows and the hits he takes, and closes monsters he will not fight', () => {
    const s = raidFrom(['@.g.']);
    const k = seeAll(s);
    const to = cell(s, 2, 0);
    const p = plan(k, s.pos, walk);
    // Step next to it (hit 2), 2 blows (hit 2 after the first), step onto its tile.
    expect(p.turns[to]).toBe(1 + 2 + 1);
    expect(p.damage[to]).toBe(2 + 2);
    expect(fightDamage({ kind: 'goblin', hp: 4 }, 2, true)).toBe(4);
    expect(fightDamage({ kind: 'goblin', hp: 4 }, 2, false)).toBe(2);
    expect(fightDamage({ kind: 'troll', hp: 12 }, 2, true)).toBe(24);
    expect(plan(k, s.pos, { ...walk, mayFight: () => false }).cost[to]).toBe(-1);
  });

  it('weighs HP against turns: goes round a trap when HP is worth enough', () => {
    const s = raidFrom(['@^.', '...']);
    const k = seeAll(s);
    const to = cell(s, 2, 0);
    expect(firstStep(plan(k, s.pos, { ...walk, hpWeight: 0 }), to)).toBe(cell(s, 1, 0));
    expect(plan(k, s.pos, walk).damage[to]).toBe(RULES.trapDamage);
    expect(firstStep(plan(k, s.pos, { ...walk, hpWeight: 2 }), to)).toBe(cell(s, 0, 1));
  });

  it('counts every monster next to a tile he passes, and closes tiles that would knock him out', () => {
    const s = raidFrom(['@..', '.s.', '...']);
    const k = seeAll(s);
    const to = cell(s, 2, 0);
    expect(plan(k, s.pos, walk).damage[to]).toBe(3); // (1, 0) is next to the slime
    expect(plan(k, s.pos, { ...walk, damageLimit: 3 }).cost[to]).toBe(-1); // the only ways pass it
  });

  it('knows the way back: turns and trap damage to the stairs', () => {
    const s = raidFrom(['>.^.@']);
    const back = wayBack(seeAll(s), 2, 'never');
    expect(back.turns[s.pos]).toBe(4);
    expect(back.damage[s.pos]).toBe(RULES.trapDamage);
  });
});

describe('what a teacher knows', () => {
  it('is exactly what he has seen, kept for the whole trip; a monster hides what it stands on', () => {
    const s = raidFrom(['@.c..']);
    const k = newKnowledge(s);
    observe(k, s);
    s.torchLeft = 5;
    s.monsters.push({ kind: 'rat', pos: cell(s, 2, 0), hp: 2, rich: false });
    observe(k, s);
    expect(k.seen[cell(s, 2, 0)]).toBe(1);
    expect(k.tiles[cell(s, 2, 0)]).toBe(0); // under the rat, never seen: counted as floor
    expect(k.monsters.map((m) => m.kind)).toEqual(['rat']);
    expect(k.seen[cell(s, 3, 0)]).toBe(0);
  });

  it('never uses a tile he has not seen, in any teacher\'s raids', () => {
    const rng = rngFrom('teachers-unseen');
    for (const name of TEACHERS) {
      for (let n = 0; n < 4; n++) {
        const d = generateDungeon(randomCode(rng));
        const union = new Uint8Array(d.tiles.length);
        let checked = 0;
        const s0 = { pos: d.stairs, lit: false };
        for (const i of seenTiles({ ...d, ...s0 })) union[i] = 1;
        teacherRaid(d, name, 0, {
          onTurn: (s, t, turn) => {
            // Every tile it knows was in one of his views; every bump went to a tile he had seen.
            for (let i = 0; i < union.length; i++) if (t.knowledge.seen[i]) expect(union[i], `${name} ${i}`).toBe(1);
            if (turn.action <= LEFT && turn.result.did === 'walk') {
              expect(union[s.pos]).toBe(1);
              checked++;
            }
            if (!s.ended) for (const i of seenTiles({ ...s.map, pos: s.pos, lit: torchLit(s) })) union[i] = 1;
          },
        });
        expect(checked).toBeGreaterThan(0);
      }
    }
  });
});

describe('the teachers\' rules', () => {
  it('healer drinks below half HP, not at half', () => {
    const s = raidFrom(['>...@...']);
    s.torches = 0;
    s.hp = 5;
    expect(knowing('healer', s).act(s)).toBe(DRINK);
    s.hp = 6;
    expect(knowing('healer', s).act(s)).not.toBe(DRINK);
  });

  it('warrior drinks only when the next hit would knock him out', () => {
    const s = raidFrom(['>...@g']);
    s.torches = 0;
    s.hp = 3;
    expect(knowing('warrior', s).act(s)).toBe(RIGHT); // a goblin hits 2: he strikes
    s.hp = 2;
    expect(knowing('warrior', s).act(s)).toBe(DRINK);
    s.hp = 5;
    expect(knowing('warrior', s).act(s)).toBe(RIGHT); // half HP is no reason for him
  });

  it('goblin in disguise walks into a troll in sight; the warrior does not', () => {
    const s = raidFrom(['>...@.', '.....t']);
    s.torches = 0;
    s.potions = 0;
    const goblin = knowing('goblin', s);
    const a = goblin.act(s);
    expect(goblin.reason).toBe('troll');
    expect([RIGHT, DOWN]).toContain(a);
    const warrior = knowing('warrior', s);
    warrior.act(s);
    expect(warrior.reason).not.toBe('troll');
  });

  it('thief leaves gold next to a slime; the healer takes it', () => {
    const s = raidFrom(['>...@c', '.....s']);
    s.torches = 0;
    const healer = knowing('healer', s);
    expect(healer.act(s)).toBe(RIGHT);
    expect(healer.reason).toBe('target');
    const thief = knowing('thief', s);
    thief.act(s);
    expect(thief.reason).not.toBe('target');
  });

  it('steps away from a slime it will not fight, but not on the way home past it', () => {
    // The way home passes another slime; stepping right is out of reach of both.
    const s = raidFrom(['>.@..', '#ss##']);
    s.torches = 0;
    const out = knowing('thief', s);
    expect(out.act(s)).toBe(RIGHT);
    expect(out.reason).toBe('flee');
    const home = knowing('thief', s);
    home.goingHome = true;
    expect(home.act(s)).toBe(LEFT); // stepping aside would only mean passing them again
  });

  it('dwarf digs when it is shorter than walking round; the healer walks round', () => {
    const s = raidFrom(['>#@', '.#.', '.#.', '...']);
    s.torches = 0;
    for (const name of ['dwarf', 'pickaxe', 'healer'] as const) {
      const t = knowing(name, s);
      t.goingHome = true;
      expect(t.act(s), name).toBe(name === 'healer' ? DOWN : LEFT);
    }
  });

  it('a careful teacher waits for a monster two steps away; the warrior steps in', () => {
    const s = raidFrom(['>.@.g..']);
    s.torchLeft = 5; // lit: he sees the goblin
    const healer = knowing('healer', s);
    expect(healer.act(s)).toBe(WAIT);
    expect(knowing('warrior', s).act(s)).toBe(RIGHT);
  });

  it('in one fight, potions top him up to full first, then heal only what the next hit leaves', () => {
    const dragon = { kind: 'dragon' as const };
    expect(fightReserve({ hp: 16, maxHp: 22, potions: 2 }, dragon, true, true)).toBe(22 + 1); // one to top up, one at +1
    expect(fightReserve({ hp: 16, maxHp: 22, potions: 2 }, dragon, false, true)).toBe(16 + 2); // already next to it
    expect(fightReserve({ hp: 16, maxHp: 22, potions: 2 }, dragon, true, false)).toBe(16);
    expect(fightReserve({ hp: 10, maxHp: 14, potions: 1 }, { kind: 'rat' }, false, true)).toBe(10 + 5);
  });

  it('a dragon takes all four buffs: 20 damage at attack 4, 30 at attack 3', () => {
    const d = { kind: 'dragon' as const, hp: 16 };
    expect(fightDamage(d, 4, true)).toBe(20);
    expect(fightDamage(d, 3, true)).toBe(30);
    expect(fightDamage(d, 2, true)).toBe(40);
  });

  it('the champion takes on a dragon only fully buffed and healthy, drinking up to full first', () => {
    const s = raidFrom(['>....', '.@.d.']);
    s.torches = 0;
    s.attack = 4;
    s.maxHp = 22;
    s.hp = 22;
    s.potions = 0;
    let t = knowing('champion', s);
    t.act(s);
    expect(t.reason).not.toBe('target'); // 2 HP left after it is too close for him
    s.potions = 1;
    t = knowing('champion', s);
    expect(t.act(s)).toBe(RIGHT);
    expect(t.reason).toBe('target');
    s.hp = 18;
    s.potions = 2;
    t = knowing('champion', s);
    expect(t.act(s)).toBe(DRINK); // one step from it: drink first, while it cannot hit him for it
    s.attack = 3;
    s.hp = 22;
    s.potions = 3;
    t = knowing('champion', s);
    t.act(s);
    expect(t.reason).not.toBe('target');
    s.attack = 4;
    s.maxHp = 18;
    s.hp = 18;
    t = knowing('champion', s);
    t.act(s);
    expect(t.reason).not.toBe('target');
  });

  it('below half HP, a careful teacher finishes a fight he can finish before drinking', () => {
    const s = raidFrom(['>...@d']);
    s.torches = 0;
    s.attack = 4;
    s.maxHp = 22;
    s.hp = 7;
    s.potions = 2;
    s.monsters[0].hp = 8; // two blows, one hit of 5 between them
    expect(knowing('champion', s).act(s)).toBe(RIGHT);
    s.monsters[0].hp = 12; // three blows, two hits: he would fall
    expect(knowing('champion', s).act(s)).not.toBe(RIGHT);
  });

  it('goblin in disguise walks into a dragon in sight too', () => {
    const s = raidFrom(['>...@.', '.....d']);
    s.torches = 0;
    s.potions = 0;
    const goblin = knowing('goblin', s);
    goblin.act(s);
    expect(goblin.reason).toBe('troll');
  });

  it('steps away from a troll he will not fight', () => {
    const s = raidFrom(['>....', '...@t', '.....']);
    s.torches = 0;
    const t = knowing('healer', s);
    const a = t.act(s);
    expect(t.reason).toBe('flee');
    expect(bumpTarget(s, a)).not.toBe(cell(s, 4, 1));
  });

  it('leaves from the stairs when it heads home', () => {
    const s = raidFrom(['@....']);
    const t = knowing('healer', s);
    t.goingHome = true;
    expect(t.act(s)).toBe(LEAVE);
    // Nothing to find on a fully known, empty map: it leaves at once.
    expect(knowing('thief', s).act(s)).toBe(LEAVE);
    expect(UP).toBe(0);
  });
});

describe('teacher raids', () => {
  it('are the same every time for the same raid', () => {
    for (const name of TEACHERS) {
      const d = generateDungeon('TEACHER');
      const run = () => teacherRaid(d, name, 3).turns.map((t) => t.action);
      // One turn at a time (watching a lesson) gives the same raid.
      const stepper = new TeacherRaid(d, name, 3);
      const actions = [];
      for (let t = stepper.next(); t; t = stepper.next()) actions.push(t.action);
      expect(actions).toEqual(run());
      expect(stepper.next()).toBeNull();
      expect(run(), name).toEqual(run());
    }
  });

  it('always end, within the time limit, for every teacher', () => {
    const rng = rngFrom('teachers-end');
    for (const name of TEACHERS) {
      for (let n = 0; n < 15; n++) {
        const { state } = teacherRaid(generateDungeon(randomCode(rng)), name, n);
        expect(state.ended).not.toBeNull();
        expect(state.turn).toBeLessThanOrEqual(RULES.timeLimit + 1);
      }
    }
  });

  it('the pickaxe dwarf digs in one blow with his own pickaxe, and needs more when copied', () => {
    const rng = rngFrom('teachers-pickaxe');
    let own = 0;
    let ownThrough = 0;
    let copied = 0;
    let copiedThrough = 0;
    for (let n = 0; n < 20; n++) {
      const d = generateDungeon(randomCode(rng));
      for (const t of teacherRaid(d, 'pickaxe').turns) {
        if (t.result.did === 'dig') own++;
        if (t.result.dugThrough) ownThrough++;
      }
      for (const t of teacherRaid(d, 'pickaxe', 0, { ownPickaxe: false }).turns) {
        if (t.result.did === 'dig') copied++;
        if (t.result.dugThrough) copiedThrough++;
      }
    }
    expect(own).toBe(ownThrough);
    expect(own).toBeGreaterThan(0);
    expect(copied).toBeGreaterThan(copiedThrough * 1.5);
  });

  it('the champion fights a slime or troll only once he has taken a strength and a vigour', () => {
    const rng = rngFrom('teachers-champion');
    let big = 0;
    for (let n = 0; n < 40; n++) {
      teacherRaid(generateDungeon(randomCode(rng)), 'champion', 0, {
        onTurn: (s, _t, turn) => {
          const kind = turn.result.beaten?.monster.kind;
          if (kind !== 'slime' && kind !== 'troll') return;
          big++;
          // Careful like the healer until buffed: a big fight before that is one the healer could afford too.
          if (s.attack === RULES.startAttack || s.maxHp === RULES.startHp) expect(kind).toBe('slime');
        },
      });
    }
    expect(big).toBeGreaterThan(0);
  });
});
