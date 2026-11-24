/**
 * Hand-made dungeons (the dungeon editor). A dungeon made or changed in the editor travels as a **map code**: `~2`
 * and then the map itself, packed in URL-safe characters, so it works everywhere a generated dungeon's code does
 * (links, the hall of fame, lessons and many raids in the worker, the raids' random streams). `dungeonFromCode`
 * turns any code into its dungeon: a map code is read back, any other code goes to the generator.
 *
 * Packing: the 18 × 18 cells inside the bedrock ring, row by row. Each cell is one character for what is on it (a
 * gold pile is followed by one for its amount); a character past those repeats the cell before it 1–45 more times.
 * Monsters stand on floor; they act in reading order.
 *
 * Also here, with no DOM: painting a cell (`paint`), the limits on what can be placed (`LIMITS`), and the checks
 * (`checkMap`): problems that would break a raid, and warnings that only say what he will meet.
 */
import { DUNGEON_SIZE, generateDungeon, walkingDistances, type Dungeon, type Room } from './dungeon';
import { randomCode, rngFrom } from './rng';
import {
  BEDROCK, CRACKED_HP, FLOOR, GOLD, MONSTER_KINDS, MONSTER_STATS, POTION, STAIRS, STRENGTH, TORCH, TRAP, VIGOUR, WALL,
  WALL_HP, isOpen, monsterGold, type MonsterKind, type Tile,
} from './tiles';

/** Every map code starts with this (a generated code never does). */
export const MAP_PREFIX = '~';
/** The packing's version, after the prefix: 2 since the dragon. Version 1 (four monster kinds) is still read. */
const VERSION = '2';
/** The longest map code read (a map that packs worse than this is refused). */
export const MAP_CODE_MAX = 900;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// One character per cell kind; rich monsters after the plain ones.
const C_FLOOR = 0, C_WALL = 1, C_CRACKED = 2, C_BEDROCK = 3, C_STAIRS = 4, C_TRAP = 5, C_POTION = 6, C_TORCH = 7,
  C_STRENGTH = 8, C_VIGOUR = 9, C_GOLD = 10, C_MONSTER = 11;
/** The monster kinds each packing version knows, in order: version 1 had no dragon. */
const VERSION_KINDS: Record<string, readonly MonsterKind[]> = { 1: MONSTER_KINDS.slice(0, 4), 2: MONSTER_KINDS };
/** A character from `repeat` on repeats the cell before it (value − repeat + 1) more times. */
const layout = (kinds: readonly MonsterKind[]) => {
  const repeat = C_MONSTER + 2 * kinds.length;
  return { kinds, repeat, maxRepeat: ALPHABET.length - repeat };
};
const { repeat: REPEAT, maxRepeat: MAX_REPEAT } = layout(MONSTER_KINDS);

const ITEM_CELL: Partial<Record<Tile, number>> = {
  [FLOOR]: C_FLOOR, [BEDROCK]: C_BEDROCK, [STAIRS]: C_STAIRS, [TRAP]: C_TRAP, [POTION]: C_POTION, [TORCH]: C_TORCH,
  [STRENGTH]: C_STRENGTH, [VIGOUR]: C_VIGOUR,
};
const CELL_TILE: Tile[] = [FLOOR, WALL, WALL, BEDROCK, STAIRS, TRAP, POTION, TORCH, STRENGTH, VIGOUR, GOLD];

export const isMapCode = (code: string): boolean => code.startsWith(MAP_PREFIX);

/** What a person typed or pasted as a code: a map code loses only spaces, any other is upper-cased letters and digits. */
export function cleanCode(raw: string): string {
  const t = raw.trim();
  if (isMapCode(t)) return t.replace(/\s+/g, '').slice(0, MAP_CODE_MAX);
  return t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

/** The short name a code is shown by: a generated code as it is, a map code as ✎ and four letters from it. */
export function codeLabel(code: string): string {
  if (isTreasureCode(code)) return `${baseCode(code)}${TREASURE_LABEL}`;
  return isMapCode(code) ? `✎${randomCode(rngFrom(`label|${code}`)).slice(0, 4)}` : code;
}

/**
 * New treasure every raid: a generated dungeon's code with this mark after it gives the same walls, with gold,
 * monsters, items and traps placed afresh for each raid. It never comes from typing or a link (`cleanCode` drops
 * it); the setting adds it. A hand-made dungeon keeps the treasure it was painted with.
 */
export const TREASURE_MARK = '*';
/** How a code with new treasure every raid is shown: "QWERTY✦". */
export const TREASURE_LABEL = '✦';
export const isTreasureCode = (code: string): boolean => code.endsWith(TREASURE_MARK) && !isMapCode(code);
export const baseCode = (code: string): string => (isTreasureCode(code) ? code.slice(0, -TREASURE_MARK.length) : code);
/** The code with new treasure every raid (a map code stays as it is). */
export const treasureCode = (code: string): string => (isMapCode(code) || isTreasureCode(code) ? code : code + TREASURE_MARK);

/** Any code's dungeon: a map code read back, any other from the generator (with new treasure every raid if marked). */
export function dungeonFromCode(code: string): Dungeon {
  if (isTreasureCode(code)) return { ...generateDungeon(baseCode(code)), code, treasure: true };
  return isMapCode(code) ? readMapCode(code) : generateDungeon(code);
}

/** The map code of a dungeon (its tiles, cracked walls, gold and monsters; its code and rooms are not kept). */
export function mapCode(d: Dungeon): string {
  const n = d.size;
  if (n !== DUNGEON_SIZE) throw new Error(`A map code holds a ${DUNGEON_SIZE} × ${DUNGEON_SIZE} dungeon.`);
  const monsterAt = new Map(d.monsters.map((m) => [m.pos, m]));
  const cells: [number, number][] = [];
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const m = monsterAt.get(i);
      const t = d.tiles[i];
      if (m) cells.push([C_MONSTER + MONSTER_KINDS.indexOf(m.kind) + (m.rich ? MONSTER_KINDS.length : 0), 0]);
      else if (t === WALL) cells.push([d.wallHp[i] <= CRACKED_HP ? C_CRACKED : C_WALL, 0]);
      else if (t === GOLD) cells.push([C_GOLD, Math.max(1, Math.min(ALPHABET.length - 1, d.gold[i]))]);
      else cells.push([ITEM_CELL[t]!, 0]);
    }
  }
  let out = MAP_PREFIX + VERSION;
  for (let k = 0; k < cells.length;) {
    const [c, amount] = cells[k];
    out += ALPHABET[c] + (c === C_GOLD ? ALPHABET[amount] : '');
    let run = 1;
    while (k + run < cells.length && cells[k + run][0] === c && cells[k + run][1] === amount) run++;
    k += run;
    for (let more = run - 1; more > 0; more -= MAX_REPEAT) out += ALPHABET[REPEAT + Math.min(more, MAX_REPEAT) - 1];
  }
  return out;
}

/** A map code's dungeon; throws with a short message if the code is broken or the map has a problem. */
export function readMapCode(code: string): Dungeon {
  const broken = () => new Error('This map code is broken: it may have been cut short when it was copied.');
  if (!isMapCode(code) || code.length > MAP_CODE_MAX) throw broken();
  const kinds = VERSION_KINDS[code[1]];
  if (!kinds) throw new Error('This map code is from another version of the game.');
  const { repeat } = layout(kinds);
  const n = DUNGEON_SIZE;
  const inner = (n - 2) * (n - 2);
  const d = emptyDungeon(code);
  let k = 0;
  let last: [number, number] | null = null;
  const put = ([c, amount]: [number, number]) => {
    if (k >= inner) throw broken();
    const i = (1 + Math.floor(k / (n - 2))) * n + 1 + (k % (n - 2));
    k++;
    d.wallHp[i] = 0;
    if (c >= C_MONSTER) {
      const kind = kinds[(c - C_MONSTER) % kinds.length];
      d.tiles[i] = FLOOR;
      d.monsters.push({ kind, pos: i, hp: MONSTER_STATS[kind].hp, rich: c - C_MONSTER >= kinds.length });
      return;
    }
    d.tiles[i] = CELL_TILE[c];
    if (c === C_WALL || c === C_CRACKED) d.wallHp[i] = c === C_CRACKED ? CRACKED_HP : WALL_HP;
    if (c === C_GOLD) d.gold[i] = amount;
    if (c === C_STAIRS) d.stairs = i;
  };
  for (let p = 2; p < code.length; p++) {
    const v = ALPHABET.indexOf(code[p]);
    if (v < 0) throw broken();
    if (v >= repeat) {
      if (!last) throw broken();
      for (let r = 0; r <= v - repeat; r++) put(last);
      continue;
    }
    let amount = 0;
    if (v === C_GOLD) {
      amount = ALPHABET.indexOf(code[++p] ?? '');
      if (amount < 1) throw broken();
    }
    last = [v, amount];
    put(last);
  }
  if (k !== inner) throw broken();
  const { problems } = checkMap(d);
  if (problems.length) throw new Error(`This map cannot be raided: ${problems[0].toLowerCase()}`);
  d.rooms = roomsOf(d);
  return d;
}

/** Solid stone inside the bedrock ring, with no stairs yet (stairs −1): the editor's Clear. */
export function emptyDungeon(code = ''): Dungeon {
  const n = DUNGEON_SIZE;
  const tiles: Tile[] = [];
  const wallHp: number[] = [];
  for (let i = 0; i < n * n; i++) {
    const x = i % n;
    const y = Math.floor(i / n);
    const ring = x === 0 || y === 0 || x === n - 1 || y === n - 1;
    tiles.push(ring ? BEDROCK : WALL);
    wallHp.push(ring ? 0 : WALL_HP);
  }
  return { code, size: n, tiles, wallHp, gold: new Array<number>(n * n).fill(0), stairs: -1, rooms: [], monsters: [] };
}

/** A copy to edit. */
export const copyDungeon = (d: Dungeon): Dungeon => ({
  ...d, tiles: d.tiles.slice(), wallHp: d.wallHp.slice(), gold: d.gold.slice(), rooms: d.rooms.slice(),
  monsters: d.monsters.map((m) => ({ kind: m.kind, pos: m.pos, hp: m.hp, rich: m.rich })),
});

/**
 * Rooms of a hand-made map, for the events' places: every open cell in a 2 × 2 block of open cells is room (each a
 * room of its own, 1 × 1), the rest of the open cells are corridor.
 */
export function roomsOf(d: Pick<Dungeon, 'size' | 'tiles'>): Room[] {
  const n = d.size;
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && isOpen(d.tiles[y * n + x]);
  const rooms: Room[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!open(x, y)) continue;
      const inBlock = [[-1, -1], [0, -1], [-1, 0], [0, 0]].some(([dx, dy]) =>
        open(x + dx, y + dy) && open(x + dx + 1, y + dy) && open(x + dx, y + dy + 1) && open(x + dx + 1, y + dy + 1));
      if (inBlock) rooms.push({ x, y, w: 1, h: 1 });
    }
  }
  return rooms;
}

// ── Painting ────────────────────────────────────────────────────────────────

export type Brush = 'floor' | 'wall' | 'cracked' | 'stairs' | 'trap' | 'gold' | 'potion' | 'torch' | 'strength' | 'vigour' | MonsterKind;

/** How much can be placed *(tune)*: enough for odd dungeons, few enough that the numbers and the saga stay sensible. */
export const LIMITS = {
  monsters: 16,
  /** Each of potion, torch, strength and vigour. */
  items: 8,
  traps: 12,
  goldPiles: 20,
  goldMin: 1,
  goldMax: 30,
} as const;

const ITEM_OF: Partial<Record<Brush, Tile>> = { trap: TRAP, potion: POTION, torch: TORCH, strength: STRENGTH, vigour: VIGOUR };
const ITEM_WORDS: Partial<Record<Tile, string>> = { [TRAP]: 'spike traps', [POTION]: 'potions', [TORCH]: 'torches', [STRENGTH]: 'strength', [VIGOUR]: 'vigour' };

export interface PaintOptions { gold?: number; rich?: boolean }

/**
 * Paint one cell of a map being edited. Returns null when it changed, or why it did not (in a few words). The
 * bedrock ring stays; the stairs move to where they are painted, and nothing else is painted over them.
 */
export function paint(d: Dungeon, i: number, brush: Brush, o: PaintOptions = {}): string | null {
  const n = d.size;
  const x = i % n;
  const y = Math.floor(i / n);
  if (x <= 0 || y <= 0 || x >= n - 1 || y >= n - 1) return 'The bedrock round the edge stays.';
  if (i === d.stairs && brush !== 'stairs') return 'Paint the stairs somewhere else to move them.';
  const monster = d.monsters.findIndex((m) => m.pos === i);
  const count = (t: Tile) => d.tiles.filter((u, j) => u === t && j !== i).length;
  const clearCell = (t: Tile) => {
    if (monster >= 0) d.monsters.splice(monster, 1);
    d.tiles[i] = t;
    d.wallHp[i] = 0;
    d.gold[i] = 0;
  };

  if (brush === 'stairs') {
    if (i === d.stairs) return null;
    if (d.stairs >= 0) d.tiles[d.stairs] = FLOOR;
    clearCell(STAIRS);
    d.stairs = i;
    return null;
  }
  if (brush === 'floor') { clearCell(FLOOR); return null; }
  if (brush === 'wall' || brush === 'cracked') {
    clearCell(WALL);
    d.wallHp[i] = brush === 'cracked' ? CRACKED_HP : WALL_HP;
    return null;
  }
  if (brush === 'gold') {
    const amount = Math.round(o.gold ?? 3);
    if (!(amount >= LIMITS.goldMin && amount <= LIMITS.goldMax)) return `A pile holds ${LIMITS.goldMin} to ${LIMITS.goldMax} gold.`;
    if (count(GOLD) >= LIMITS.goldPiles) return `At most ${LIMITS.goldPiles} gold piles.`;
    clearCell(GOLD);
    d.gold[i] = amount;
    return null;
  }
  const item = ITEM_OF[brush];
  if (item !== undefined) {
    const most = item === TRAP ? LIMITS.traps : LIMITS.items;
    if (count(item) >= most) return `At most ${most} ${ITEM_WORDS[item]}.`;
    clearCell(item);
    return null;
  }
  // A monster, on floor.
  const kind = brush as MonsterKind;
  if (monster < 0 && d.monsters.length >= LIMITS.monsters) return `At most ${LIMITS.monsters} monsters.`;
  const m = { kind, pos: i, hp: MONSTER_STATS[kind].hp, rich: !!o.rich };
  clearCell(FLOOR);
  // In reading order, as a map code reads them back.
  const at = d.monsters.findIndex((other) => other.pos > i);
  d.monsters.splice(at < 0 ? d.monsters.length : at, 0, m);
  return null;
}

// ── Checks ──────────────────────────────────────────────────────────────────

/** No monster starts this close to the stairs in a generated dungeon (the generator's `safeDistance`). */
const NEAR = 5;

export interface MapCheck {
  /** What would break a raid: the map cannot be used until these are gone. */
  problems: string[];
  /** What is allowed but unlike a generated dungeon. */
  warnings: string[];
}

export function checkMap(d: Dungeon): MapCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const stairs = d.tiles.filter((t) => t === STAIRS).length;
  if (stairs === 0) problems.push('No stairs: he needs a way in and out.');
  if (stairs > 1) problems.push('More than one stairs.');
  const n = d.size;
  if (d.tiles.some((t, i) => (i < n || i >= n * (n - 1) || i % n === 0 || i % n === n - 1) && t !== BEDROCK)) {
    problems.push('The edge must be bedrock.');
  }
  const seen = new Set<number>();
  for (const m of d.monsters) {
    if (d.tiles[m.pos] !== FLOOR || seen.has(m.pos)) { problems.push('A monster must stand alone on bare floor.'); break; }
    seen.add(m.pos);
  }
  const piles = d.gold.filter((g, i) => d.tiles[i] === GOLD && g > 0);
  if (d.monsters.length > LIMITS.monsters) problems.push(`More than ${LIMITS.monsters} monsters.`);
  if (piles.length > LIMITS.goldPiles) problems.push(`More than ${LIMITS.goldPiles} gold piles.`);
  if (piles.some((g) => g < LIMITS.goldMin || g > LIMITS.goldMax)) problems.push(`A pile holds ${LIMITS.goldMin} to ${LIMITS.goldMax} gold.`);
  if (d.tiles.some((t, i) => t === GOLD && !(d.gold[i] > 0))) problems.push('A gold pile with no gold.');
  for (const t of [POTION, TORCH, STRENGTH, VIGOUR, TRAP] as Tile[]) {
    const most = t === TRAP ? LIMITS.traps : LIMITS.items;
    if (d.tiles.filter((u) => u === t).length > most) problems.push(`More than ${most} ${ITEM_WORDS[t]}.`);
  }
  if (problems.length || d.stairs < 0) return { problems, warnings };

  const dist = walkingDistances(d, d.stairs);
  const gold = d.gold.reduce((a, b) => a + b, 0) + d.monsters.reduce((a, m) => a + monsterGold(m), 0);
  if (gold === 0) warnings.push('No gold anywhere: nothing to carry out.');
  const behind = d.tiles.reduce<number>((a, t, i) => a + (t === GOLD && dist[i] < 0 ? d.gold[i] : 0), 0);
  if (behind) warnings.push(`${behind} gold lies behind stone: only digging reaches it.`);
  const near = d.monsters.filter((m) => dist[m.pos] >= 0 && dist[m.pos] < NEAR).length;
  if (near) warnings.push(`${near === 1 ? 'A monster stands' : `${near} monsters stand`} within ${NEAR} steps of the stairs. Generated dungeons never do that.`);
  return { problems, warnings };
}
