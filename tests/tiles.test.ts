import { describe, expect, it } from 'vitest';
import {
  BEDROCK, CRACKED_HP, FLOOR, GOLD, HEAP_FROM, SHOWN, SHOWN_KINDS, WALL, WALL_HP, isOpen, isWounded, monsterGold,
  shownKind as shownKindOf,
} from '../src/tiles';

describe('tiles', () => {
  it('shows a stone wall as cracked at 3 HP or less', () => {
    expect(shownKindOf(WALL, WALL_HP, 0)).toBe(SHOWN.stone);
    expect(shownKindOf(WALL, CRACKED_HP + 1, 0)).toBe(SHOWN.stone);
    expect(shownKindOf(WALL, CRACKED_HP, 0)).toBe(SHOWN.cracked);
    expect(shownKindOf(WALL, 1, 0)).toBe(SHOWN.cracked);
  });

  it('shows gold as small below 6 and as a heap from 6', () => {
    expect(shownKindOf(GOLD, 0, HEAP_FROM - 1)).toBe(SHOWN.smallGold);
    expect(shownKindOf(GOLD, 0, HEAP_FROM)).toBe(SHOWN.heap);
  });

  it('has 12 shown kinds (dark makes 13 in a view)', () => {
    expect(SHOWN_KINDS).toBe(12);
    expect(new Set(Object.values(SHOWN)).size).toBe(SHOWN_KINDS);
  });

  it('lets walls only block the way', () => {
    expect(isOpen(FLOOR)).toBe(true);
    expect(isOpen(GOLD)).toBe(true);
    expect(isOpen(WALL)).toBe(false);
    expect(isOpen(BEDROCK)).toBe(false);
  });

  it('marks monsters wounded at half HP and triples a rich one\'s gold', () => {
    expect(isWounded({ kind: 'goblin', pos: 0, hp: 3, rich: false })).toBe(false);
    expect(isWounded({ kind: 'goblin', pos: 0, hp: 2, rich: false })).toBe(true);
    expect(isWounded({ kind: 'rat', pos: 0, hp: 1, rich: false })).toBe(true);
    expect(monsterGold({ kind: 'troll', pos: 0, hp: 12, rich: true })).toBe(36);
  });
});
