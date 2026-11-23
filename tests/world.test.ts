import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/dungeon';
import { rngFrom, type Rng } from '../src/rng';
import { FLOOR, GOLD, HEAP_FROM, POTION, SHOWN, TORCH, WALL, WALL_HP, shownKind } from '../src/tiles';
import {
  ACTIONS, DRINK, LEAVE, LEFT, LIGHT_TORCH, PICK_UP, RIGHT, RULES, UP, allowedActions, goldOut, newRaid, step,
  type Action,
} from '../src/world';
import { cell, raidFrom } from './maps';

/** A monster stream that must not be used. */
const noRng: Rng = () => { throw new Error('the monster stream was used'); };

describe('a new raid', () => {
  it('starts on the stairs with the starting stats and its own copy of the map', () => {
    const d = generateDungeon('ABC123');
    const before = JSON.stringify(d);
    const s = newRaid(d);
    expect(s.pos).toBe(d.stairs);
    expect([s.hp, s.maxHp, s.attack, s.potions, s.torches, s.torchLeft, s.gold, s.timeLeft]).toEqual([12, 12, 2, 1, 1, 0, 0, 150]);
    const rng = rngFrom('ABC123|1|monsters');
    for (let k = 0; k < 40 && !s.ended; k++) step(s, (k % 4) as Action, rng);
    s.map.tiles[0] = FLOOR;
    s.monsters.length = 0;
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('bumps', () => {
  it('walks onto an open tile; every action takes a turn', () => {
    const s = raidFrom(['@..']);
    const r = step(s, RIGHT, noRng);
    expect(r.did).toBe('walk');
    expect(s.pos).toBe(cell(s, 1, 0));
    expect([s.turn, s.timeLeft]).toEqual([1, 149]);
  });

  it('wastes the turn on bedrock', () => {
    const s = raidFrom(['@..']);
    const r = step(s, UP, noRng);
    expect(r.did).toBe('nothing');
    expect(s.pos).toBe(cell(s, 0, 0));
    expect(s.timeLeft).toBe(149);
  });

  it('digs a stone wall by his attack, to floor at 0', () => {
    const s = raidFrom(['@#.']);
    const wall = cell(s, 1, 0);
    expect(step(s, RIGHT, noRng).did).toBe('dig');
    expect(s.map.wallHp[wall]).toBe(WALL_HP - 2);
    step(s, RIGHT, noRng);
    expect(shownKind(s.map.tiles[wall], s.map.wallHp[wall], 0)).toBe(SHOWN.cracked);
    const r = step(s, RIGHT, noRng);
    expect(r.dugThrough).toBe(true);
    expect([s.map.tiles[wall], s.map.wallHp[wall], s.pos]).toEqual([FLOOR, 0, cell(s, 0, 0)]);
    step(s, RIGHT, noRng);
    expect(s.pos).toBe(wall);
  });

  it('breaks a cracked wall in 2 blows, or 1 with attack 3', () => {
    const s = raidFrom(['@%.']);
    step(s, RIGHT, noRng);
    expect(s.map.tiles[cell(s, 1, 0)]).toBe(WALL);
    step(s, RIGHT, noRng);
    expect(s.map.tiles[cell(s, 1, 0)]).toBe(FLOOR);
    const t = raidFrom(['@%.']);
    t.attack = 3;
    expect(step(t, RIGHT, noRng).dugThrough).toBe(true);
  });

  it('attacks a monster for his attack; a beaten one leaves its gold on its tile', () => {
    const s = raidFrom(['@g.']);
    const r = step(s, RIGHT, noRng);
    expect(r.did).toBe('attack');
    expect(r.struck?.hp).toBe(2);
    expect(s.pos).toBe(cell(s, 0, 0));
    s.hp = 12;
    const r2 = step(s, RIGHT, noRng);
    expect(r2.beaten).toEqual({ monster: { kind: 'goblin', pos: cell(s, 1, 0), hp: 0, rich: false }, gold: 3, at: cell(s, 1, 0) });
    expect(s.monsters).toEqual([]);
    expect([s.map.tiles[cell(s, 1, 0)], s.map.gold[cell(s, 1, 0)]]).toEqual([GOLD, 3]);
  });

  it('adds a beaten monster\'s gold to gold on its tile (a heap from 6)', () => {
    const s = raidFrom(['@g.']);
    const at = cell(s, 1, 0);
    s.map.tiles[at] = GOLD;
    s.map.gold[at] = 3;
    s.monsters[0].hp = 1;
    step(s, RIGHT, noRng);
    expect(s.map.gold[at]).toBe(6);
    expect(shownKind(s.map.tiles[at], 0, s.map.gold[at])).toBe(SHOWN.heap);
    expect(HEAP_FROM).toBe(6);
  });

  it('drops the gold on the nearest bare floor when the tile holds an item: up, right, down, left, then further', () => {
    // The goblin stands on a potion at (2, 1); up is a torch, right is floor.
    const s = raidFrom(['#i#', '@g.', '#.#']);
    const at = cell(s, 1, 1);
    s.map.tiles[at] = POTION;
    s.monsters[0].hp = 1;
    expect(step(s, RIGHT, noRng).beaten?.at).toBe(cell(s, 2, 1));
    expect(s.map.tiles[at]).toBe(POTION);
    // Nothing bare next to it: the first bare floor breadth-first, searching up first.
    const t = raidFrom(['#.##', '#i##', '@gi.', '#!##']);
    t.map.tiles[cell(t, 1, 2)] = POTION;
    t.monsters[0].hp = 1;
    expect(step(t, RIGHT, noRng).beaten?.at).toBe(cell(t, 1, 0));
  });
});

describe('pick up', () => {
  it('takes gold, potions, torches, strength and vigour', () => {
    const s = raidFrom(['@']);
    const here = s.pos;
    const put = (t: number, gold = 0) => { s.map.tiles[here] = t as never; s.map.gold[here] = gold; };
    put(GOLD, 10);
    expect(step(s, PICK_UP, noRng).goldGained).toBe(10);
    expect([s.gold, s.map.tiles[here], s.map.gold[here]]).toEqual([10, FLOOR, 0]);
    put(POTION);
    step(s, PICK_UP, noRng);
    put(TORCH);
    step(s, PICK_UP, noRng);
    expect([s.potions, s.torches]).toEqual([2, 2]);
    put(8);
    step(s, PICK_UP, noRng);
    expect(s.attack).toBe(3);
    s.hp = 5;
    put(9);
    step(s, PICK_UP, noRng);
    expect([s.hp, s.maxHp]).toEqual([16, 16]);
  });

  it('does nothing on bare floor or with a full pack', () => {
    const s = raidFrom(['@.']);
    step(s, RIGHT, noRng);
    expect(step(s, PICK_UP, noRng).did).toBe('nothing');
    s.potions = RULES.packMax;
    s.map.tiles[s.pos] = POTION;
    expect(step(s, PICK_UP, noRng).did).toBe('nothing');
    expect([s.potions, s.map.tiles[s.pos]]).toEqual([3, POTION]);
    s.torches = RULES.packMax;
    s.map.tiles[s.pos] = TORCH;
    expect(step(s, PICK_UP, noRng).did).toBe('nothing');
  });
});

describe('drink and torch', () => {
  it('drinks to heal 6, up to max HP; with no potions, nothing', () => {
    const s = raidFrom(['@']);
    s.hp = 4;
    s.potions = 2;
    step(s, DRINK, noRng);
    expect(s.hp).toBe(10);
    step(s, DRINK, noRng);
    expect([s.hp, s.potions]).toEqual([12, 0]);
    expect(step(s, DRINK, noRng).did).toBe('nothing');
  });

  it('lights a torch for 15 turns, counting the turn it is lit; not while one burns', () => {
    const s = raidFrom(['@']);
    s.torches = 2;
    expect(step(s, LIGHT_TORCH, noRng).did).toBe('light');
    expect([s.torches, s.torchLeft]).toEqual([1, RULES.torchTurns - 1]);
    expect(step(s, LIGHT_TORCH, noRng).did).toBe('nothing');
    let out = 0;
    for (let k = 0; k < 13; k++) if (step(s, DRINK, noRng).torchOut) out++;
    expect([s.torchLeft, out]).toEqual([0, 1]);
    expect(step(s, LIGHT_TORCH, noRng).did).toBe('light');
    s.torches = 0;
    s.torchLeft = 0;
    expect(step(s, LIGHT_TORCH, noRng).did).toBe('nothing');
  });
});

describe('the end of a trip', () => {
  it('leaves only on the stairs, at once: no trap, torch, time or monster step', () => {
    const s = raidFrom(['>@.', '...', '.g.']);
    s.torchLeft = 5;
    expect(step(s, LEAVE, rngFrom('x')).did).toBe('nothing');
    expect(s.ended).toBe(null);
    const goblinAt = s.monsters[0].pos;
    s.pos = s.map.stairs;
    s.gold = 7;
    const before = { time: s.timeLeft, torch: s.torchLeft, hp: s.hp };
    const r = step(s, LEAVE, noRng);
    expect([r.did, r.ended, s.ended]).toEqual(['leave', 'left', 'left']);
    expect({ time: s.timeLeft, torch: s.torchLeft, hp: s.hp }).toEqual(before);
    expect(s.monsters[0].pos).toBe(goblinAt);
    expect(goldOut(s)).toBe(7);
    expect(() => step(s, UP, noRng)).toThrow();
  });

  it('hurts 2 each time he steps onto a spike trap, not while he stands on it', () => {
    const s = raidFrom(['@^.']);
    expect(step(s, RIGHT, noRng).trapDamage).toBe(2);
    expect(s.hp).toBe(10);
    step(s, DRINK, noRng);
    s.potions = 0;
    step(s, DRINK, noRng);
    expect(s.hp).toBe(12);
    step(s, RIGHT, noRng);
    step(s, LEFT, noRng);
    expect(s.hp).toBe(10);
  });

  it('knocks him out at 0 HP and keeps no gold', () => {
    const s = raidFrom(['@^.']);
    s.hp = 2;
    s.gold = 20;
    expect(step(s, RIGHT, noRng).ended).toBe('knockedOut');
    expect([s.hp, goldOut(s)]).toEqual([0, 0]);
  });

  it('locks him in at time 0; knocked out wins if both happen', () => {
    const s = raidFrom(['@^.']);
    s.timeLeft = 2;
    s.gold = 5;
    expect(step(s, DRINK, noRng).ended).toBe(null);
    expect(step(s, DRINK, noRng).ended).toBe('lockedIn');
    expect(goldOut(s)).toBe(0);
    const t = raidFrom(['@^.']);
    t.timeLeft = 1;
    t.hp = 1;
    expect(step(t, RIGHT, noRng).ended).toBe('knockedOut');
  });
});

describe('block impossible actions', () => {
  const names = (a: boolean[]) => a.flatMap((ok, k) => (ok ? [] : [k]));

  it('blocks bedrock bumps, picking up nothing, drinking and lighting with none, and leaving off the stairs', () => {
    const s = raidFrom(['@#', '..']);
    s.potions = 0;
    s.torches = 0;
    s.pos = cell(s, 0, 0);
    s.map.tiles[s.pos] = FLOOR;
    expect(allowedActions(s).length).toBe(ACTIONS);
    expect(names(allowedActions(s))).toEqual([UP, LEFT, PICK_UP, DRINK, LIGHT_TORCH, LEAVE]);
  });

  it('allows digging, drinking at full HP, picking up an item, leaving on the stairs', () => {
    const s = raidFrom(['>#', '..']);
    expect(names(allowedActions(s))).toEqual([UP, LEFT, PICK_UP]);
    s.map.tiles[s.pos] = POTION;
    expect(allowedActions(s)[PICK_UP]).toBe(true);
    s.potions = RULES.packMax;
    expect(allowedActions(s)[PICK_UP]).toBe(false);
    s.map.tiles[s.pos] = GOLD;
    expect(allowedActions(s)[PICK_UP]).toBe(true);
  });

  it('blocks lighting while a torch burns', () => {
    const s = raidFrom(['@']);
    s.torchLeft = 3;
    expect(allowedActions(s)[LIGHT_TORCH]).toBe(false);
  });

  it('marks blocked actions exactly as the ones that do nothing', () => {
    const d = generateDungeon('BLOCKS');
    const rng = rngFrom('BLOCKS|1|monsters');
    const act = rngFrom('BLOCKS|1|act');
    const s = newRaid(d);
    while (!s.ended) {
      const allowed = allowedActions(s);
      const a = Math.floor(act() * ACTIONS) as Action;
      const wasted = step(s, a, rng).did === 'nothing';
      expect(wasted).toBe(!allowed[a]);
    }
  });
});

describe('a full scripted raid', () => {
  it('goes in, fights a rat, takes the gold and a potion, and leaves', () => {
    // x: 0 stairs, 5 a rat, 6 a spike trap, 7 a potion, 8 small gold. The rat always sees him, so it never wanders.
    const s = raidFrom(['>....r^!c']);
    const x = () => s.pos - cell(s, 0, 0);
    const ratX = () => (s.monsters.length ? s.monsters[0].pos - cell(s, 0, 0) : null);
    // [action, his x, HP, gold, potions, rat x, what he did]
    const script: [Action, number, number, number, number, number | null, string][] = [
      [LIGHT_TORCH, 0, 12, 0, 1, 4, 'light'], // lit: the rat notices him from 5 and comes
      [RIGHT, 1, 12, 0, 1, 3, 'walk'],
      [RIGHT, 2, 11, 0, 1, 3, 'walk'], // next to the rat: it hits for 1
      [RIGHT, 2, 11, 0, 1, null, 'attack'], // 2 damage beats it: its 1 gold drops at x 3
      [RIGHT, 3, 11, 0, 1, null, 'walk'],
      [PICK_UP, 3, 11, 1, 1, null, 'pickUp'],
      [RIGHT, 4, 11, 1, 1, null, 'walk'],
      [RIGHT, 5, 11, 1, 1, null, 'walk'],
      [RIGHT, 6, 9, 1, 1, null, 'walk'], // the trap
      [RIGHT, 7, 9, 1, 1, null, 'walk'],
      [PICK_UP, 7, 9, 1, 2, null, 'pickUp'],
      [RIGHT, 8, 9, 1, 2, null, 'walk'],
      [PICK_UP, 8, 9, 4, 2, null, 'pickUp'],
      [DRINK, 8, 12, 4, 1, null, 'drink'], // heals 6, but only up to 12
      [RIGHT, 8, 12, 4, 1, null, 'nothing'], // bedrock: the turn is wasted
      [LEFT, 7, 12, 4, 1, null, 'walk'],
      [LEFT, 6, 10, 4, 1, null, 'walk'], // the trap again
      [LEFT, 5, 10, 4, 1, null, 'walk'],
      [LEFT, 4, 10, 4, 1, null, 'walk'],
      [LEFT, 3, 10, 4, 1, null, 'walk'],
      [LEFT, 2, 10, 4, 1, null, 'walk'],
      [LEFT, 1, 10, 4, 1, null, 'walk'],
      [LEFT, 0, 10, 4, 1, null, 'walk'],
      [LEAVE, 0, 10, 4, 1, null, 'leave'],
    ];
    let torchOutAt = 0;
    script.forEach(([a, ex, hp, gold, potions, rx, did], k) => {
      const r = step(s, a, noRng);
      if (r.torchOut) torchOutAt = s.turn;
      expect([r.did, x(), s.hp, s.gold, s.potions, ratX()], `turn ${k + 1}`).toEqual([did, ex, hp, gold, potions, rx]);
    });
    expect(torchOutAt).toBe(RULES.torchTurns);
    expect(s.ended).toBe('left');
    expect(goldOut(s)).toBe(4);
    expect(s.turn).toBe(script.length);
    expect(s.timeLeft).toBe(RULES.timeLimit - (script.length - 1)); // Leave takes no time
  });

  it('plays out the same with the same streams, on a real dungeon', () => {
    const run = () => {
      const s = newRaid(generateDungeon('SCRIPT'));
      const act = rngFrom('SCRIPT|1|act');
      const mon = rngFrom('SCRIPT|1|monsters');
      const trace: number[] = [];
      while (!s.ended) {
        const allowed = allowedActions(s);
        let a: Action;
        do a = Math.floor(act() * ACTIONS) as Action; while (!allowed[a]);
        step(s, a, mon);
        trace.push(s.pos, s.hp, ...s.monsters.map((m) => m.pos));
      }
      return { trace, end: s.ended, turns: s.turn };
    };
    expect(run()).toEqual(run());
  });
});
