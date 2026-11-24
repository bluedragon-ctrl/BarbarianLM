/** Tile and monster kinds: what a dungeon is made of. */

// What a dungeon tile holds. Items lie on floor: picking one up leaves floor.
export const FLOOR = 0;
export const WALL = 1; // stone wall, with HP (cracked when 3 or less)
export const BEDROCK = 2;
export const STAIRS = 3;
export const TRAP = 4; // spike trap
export const GOLD = 5; // a pile of any amount (small below 6, a heap from 6)
export const POTION = 6;
export const TORCH = 7;
export const STRENGTH = 8;
export const VIGOUR = 9;
export type Tile = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const TILE_NAMES = ['floor', 'stone wall', 'bedrock', 'stairs', 'spike trap', 'gold', 'potion', 'torch', 'strength', 'vigour'] as const;

export const isWall = (t: Tile): boolean => t === WALL || t === BEDROCK;
/** Open tiles can be stood on: everything but walls. */
export const isOpen = (t: Tile): boolean => !isWall(t);
/** Items "Pick up" takes. */
export const isItem = (t: Tile): boolean => t >= GOLD;

/** Damage a spike trap deals to whoever steps onto it, him or a monster. */
export const TRAP_DAMAGE = 2;

export const WALL_HP = 6;
/** A stone wall at this HP or less shows as cracked. */
export const CRACKED_HP = 3;
/** A gold pile shows as a heap from this amount. */
export const HEAP_FROM = 6;

/** The 12 tile kinds a cell can show in his view; the 13th, dark, is added by the view. */
export const SHOWN = {
  floor: 0, stone: 1, cracked: 2, bedrock: 3, stairs: 4, trap: 5,
  smallGold: 6, heap: 7, potion: 8, torch: 9, strength: 10, vigour: 11,
} as const;
export const SHOWN_KINDS = 12;

/** What a tile shows as, given its wall HP or gold amount. */
export function shownKind(tile: Tile, wallHp: number, gold: number): number {
  switch (tile) {
    case FLOOR: return SHOWN.floor;
    case WALL: return wallHp <= CRACKED_HP ? SHOWN.cracked : SHOWN.stone;
    case BEDROCK: return SHOWN.bedrock;
    case STAIRS: return SHOWN.stairs;
    case TRAP: return SHOWN.trap;
    case GOLD: return gold >= HEAP_FROM ? SHOWN.heap : SHOWN.smallGold;
    case POTION: return SHOWN.potion;
    case TORCH: return SHOWN.torch;
    case STRENGTH: return SHOWN.strength;
    case VIGOUR: return SHOWN.vigour;
  }
}

export const MONSTER_KINDS = ['rat', 'goblin', 'slime', 'troll', 'dragon'] as const;
export type MonsterKind = typeof MONSTER_KINDS[number];

export interface MonsterStats { attack: number; hp: number; gold: number; mobile: boolean }
export const MONSTER_STATS: Record<MonsterKind, MonsterStats> = {
  rat: { attack: 1, hp: 2, gold: 1, mobile: true },
  goblin: { attack: 2, hp: 4, gold: 3, mobile: true },
  slime: { attack: 3, hp: 6, gold: 5, mobile: false },
  troll: { attack: 4, hp: 12, gold: 12, mobile: false },
  /**
   * Beaten only fully buffed (attack 4, max HP 22) and healthy: 4 blows, 20 damage. At attack 3 it is 6 blows and
   * 30 damage, and a potion drunk in the fight heals 6 but costs a hit of 5.
   */
  dragon: { attack: 5, hp: 16, gold: 25, mobile: false },
};
/** A rich monster carries this many times the usual gold. */
export const RICH_TIMES = 3;

export interface Monster {
  kind: MonsterKind; pos: number; hp: number; rich: boolean;
  /** Steps taken in the chase now, and turns left of losing interest (see `CHASE` in monsters.ts); unset at the start. */
  chased?: number; rest?: number;
}

export const monsterGold = (m: Monster): number => MONSTER_STATS[m.kind].gold * (m.rich ? RICH_TIMES : 1);
/** Wounded: at or below half HP. */
export const isWounded = (m: Monster): boolean => m.hp * 2 <= MONSTER_STATS[m.kind].hp;
