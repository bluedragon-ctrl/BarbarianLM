import { describe, expect, it } from 'vitest';
import { DUNGEON_SIZE, GEN, depths, digSaving, generateDungeon, roomTiles, sideNeighbours, xyOf, type Dungeon } from '../src/dungeon';
import { hashString, randomCode, rngFrom } from '../src/rng';
import {
  BEDROCK, CRACKED_HP, FLOOR, GOLD, MONSTER_STATS, POTION, STAIRS, STRENGTH, TORCH, TRAP, VIGOUR, WALL, WALL_HP,
  isOpen, monsterGold,
} from '../src/tiles';

const rng = rngFrom('dungeon tests');
const CODES = Array.from({ length: 200 }, () => randomCode(rng));
const DUNGEONS = CODES.map(generateDungeon);
const all = (d: Dungeon) => d.tiles.map((_, i) => i);
const inAnyRoom = (d: Dungeon) => new Set(d.rooms.flatMap((r) => roomTiles(d.size, r)));

describe('dungeon generator', () => {
  it('gives the same dungeon for the same code, and different ones for different codes', () => {
    expect(generateDungeon('ABC123')).toEqual(generateDungeon('ABC123'));
    expect(generateDungeon('ABC123').tiles).not.toEqual(generateDungeon('ABC124').tiles);
  });

  // If this fails, the generator changed and every existing dungeon code now gives a different dungeon:
  // update the number and say so in the pull request.
  it('keeps old codes giving the same dungeons', () => {
    const d = generateDungeon('ABC123');
    const text = JSON.stringify([d.tiles, d.wallHp, d.gold, d.stairs, d.monsters]);
    expect(hashString(text)).toBe(FINGERPRINT);
  });

  it('rings the edge with bedrock and has none inside', () => {
    for (const d of DUNGEONS) {
      expect(d.size).toBe(DUNGEON_SIZE);
      for (const i of all(d)) {
        const [x, y] = xyOf(d.size, i);
        const edge = x === 0 || y === 0 || x === d.size - 1 || y === d.size - 1;
        expect(d.tiles[i] === BEDROCK).toBe(edge);
      }
    }
  });

  it('has one stairs, inside a room', () => {
    for (const d of DUNGEONS) {
      expect(all(d).filter((i) => d.tiles[i] === STAIRS)).toEqual([d.stairs]);
      expect(inAnyRoom(d).has(d.stairs)).toBe(true);
    }
  });

  it('reaches every open tile from the stairs without digging', () => {
    for (const d of DUNGEONS) {
      const depth = depths(d);
      for (const i of all(d)) if (isOpen(d.tiles[i])) expect(depth[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('places rooms that never touch, with enough of them', () => {
    for (const d of DUNGEONS) {
      expect(d.rooms.length).toBeGreaterThanOrEqual(5);
      for (let a = 0; a < d.rooms.length; a++) {
        for (let b = a + 1; b < d.rooms.length; b++) {
          const [p, q] = [d.rooms[a], d.rooms[b]];
          const apart = p.x + p.w < q.x || q.x + q.w < p.x || p.y + p.h < q.y || q.y + q.h < p.y;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it('gives walls their HP, and cracked walls only where a dig saves many steps', () => {
    let cracked = 0;
    for (const d of DUNGEONS) {
      for (const i of all(d)) {
        if (d.tiles[i] !== WALL) { expect(d.wallHp[i]).toBe(0); continue; }
        expect([WALL_HP, CRACKED_HP]).toContain(d.wallHp[i]);
        if (d.wallHp[i] === CRACKED_HP) {
          cracked++;
          expect(digSaving(d, i)).toBeGreaterThanOrEqual(GEN.crackMinSaving);
        }
      }
    }
    expect(cracked / DUNGEONS.length).toBeGreaterThan(1.2);
  });

  it('puts gold amounts exactly on gold piles', () => {
    for (const d of DUNGEONS) {
      for (const i of all(d)) expect(d.gold[i] > 0).toBe(d.tiles[i] === GOLD);
    }
  });

  it('places the items and traps', () => {
    for (const d of DUNGEONS) {
      const count = (t: number) => all(d).filter((i) => d.tiles[i] === t).length;
      expect(count(POTION)).toBe(GEN.potions);
      expect(count(TORCH)).toBe(GEN.torches);
      expect(count(STRENGTH)).toBe(GEN.strengths.length);
      expect(count(VIGOUR)).toBe(GEN.vigours.length);
      expect(count(TRAP)).toBe(GEN.traps);
      const rooms = inAnyRoom(d);
      for (const i of all(d)) {
        if (d.tiles[i] !== TRAP) continue;
        expect(rooms.has(i)).toBe(false);
        expect(sideNeighbours(d.size, i).some((n) => d.tiles[n] === TRAP)).toBe(false);
      }
    }
  });

  it('starts monsters at full HP on bare floor, apart, away from the stairs, with one troll guarding a heap', () => {
    for (const d of DUNGEONS) {
      const depth = depths(d);
      expect(new Set(d.monsters.map((m) => m.pos)).size).toBe(d.monsters.length);
      for (const m of d.monsters) {
        expect(d.tiles[m.pos]).toBe(FLOOR);
        expect(m.hp).toBe(MONSTER_STATS[m.kind].hp);
        expect(depth[m.pos]).toBeGreaterThanOrEqual(GEN.safeDistance);
      }
      const trolls = d.monsters.filter((m) => m.kind === 'troll');
      expect(trolls.length).toBe(1);
      expect(sideNeighbours(d.size, trolls[0].pos).some((n) => d.tiles[n] === GOLD && d.gold[n] === GEN.heap)).toBe(true);
    }
  });

  it('makes about 1 monster in 4 rich', () => {
    const ms = DUNGEONS.flatMap((d) => d.monsters);
    const share = ms.filter((m) => m.rich).length / ms.length;
    expect(share).toBeGreaterThan(0.18);
    expect(share).toBeLessThan(0.32);
  });

  it('puts more gold and tougher monsters further from the stairs', () => {
    const gold = [0, 0, 0];
    const attack = [[0, 0], [0, 0], [0, 0]];
    for (const d of DUNGEONS) {
      const depth = depths(d);
      const max = Math.max(...depth);
      const third = (i: number) => Math.min(2, Math.floor((depth[i] / max) * 3));
      for (const i of all(d)) if (d.tiles[i] === GOLD) gold[third(i)] += d.gold[i];
      for (const m of d.monsters) {
        gold[third(m.pos)] += monsterGold(m);
        attack[third(m.pos)][0] += MONSTER_STATS[m.kind].attack;
        attack[third(m.pos)][1]++;
      }
    }
    expect(gold[1]).toBeGreaterThan(gold[0] * 2);
    expect(gold[2]).toBeGreaterThan(gold[1] * 1.5);
    const avg = attack.map(([s, n]) => s / Math.max(1, n));
    expect(avg[2]).toBeGreaterThan(avg[1]);
    expect(avg[1]).toBeGreaterThan(avg[0]);
  });
});

const FINGERPRINT = 232885594;
