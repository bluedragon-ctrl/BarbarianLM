/**
 * The dungeon editor on the Dungeon tab: paint cells on the board, see what the map holds and what is wrong with
 * it, and use it. The map is kept in a map code (`src/mapCode.ts`), so the dungeon goes everywhere a generated one
 * does. All the rules are in `mapCode.ts`; this is its panel.
 */
import type { Dungeon } from '../dungeon';
import { LIMITS, checkMap, copyDungeon, emptyDungeon, mapCode, paint, type Brush } from '../mapCode';
import { MONSTER_KINDS, POTION, SHOWN, STRENGTH, TORCH, TRAP, VIGOUR, monsterGold, type MonsterKind, type Tile } from '../tiles';
import { newRaid, type RaidState } from '../world';
import { h, s } from './dom';
import { icon, itemSymbol, lootSack, monsterBody, tileSymbol } from './symbols';

export interface EditorHost {
  /** The edited dungeon is ready: put it on screen by its map code. */
  editDone(code: string): void;
  editCancel(): void;
  /** The map changed: draw the board and the panel again. */
  editChanged(): void;
}

/** Steps of undo kept. */
const UNDO = 50;

const tileIcon = (shown: number) => icon(s('g', {}, tileSymbol(shown), itemSymbol(shown)), 0.55);

const PALETTE: { group: string; brushes: { brush: Brush; label: string; icon: () => SVGSVGElement }[] }[] = [
  {
    group: 'Ground', brushes: [
      { brush: 'floor', label: 'Floor', icon: () => tileIcon(SHOWN.floor) },
      { brush: 'wall', label: 'Stone wall', icon: () => tileIcon(SHOWN.stone) },
      { brush: 'cracked', label: 'Cracked wall', icon: () => tileIcon(SHOWN.cracked) },
      { brush: 'stairs', label: 'Stairs', icon: () => tileIcon(SHOWN.stairs) },
      { brush: 'trap', label: 'Spike trap', icon: () => tileIcon(SHOWN.trap) },
    ],
  },
  {
    group: 'Things', brushes: [
      { brush: 'gold', label: 'Gold', icon: () => tileIcon(SHOWN.smallGold) },
      { brush: 'potion', label: 'Potion', icon: () => tileIcon(SHOWN.potion) },
      { brush: 'torch', label: 'Torch', icon: () => tileIcon(SHOWN.torch) },
      { brush: 'strength', label: 'Strength', icon: () => tileIcon(SHOWN.strength) },
      { brush: 'vigour', label: 'Vigour', icon: () => tileIcon(SHOWN.vigour) },
    ],
  },
  {
    group: 'Monsters', brushes: MONSTER_KINDS.map((k) => ({
      brush: k, label: k[0].toUpperCase() + k.slice(1), icon: () => icon(monsterBody(k), 0.55),
    })),
  },
];

const isMonster = (b: Brush): b is MonsterKind => (MONSTER_KINDS as readonly string[]).includes(b);

export class DungeonEditor {
  /** The map being edited (stairs −1 after Clear, until stairs are painted). */
  draft: Dungeon;
  brush: Brush = 'wall';
  gold = 3;
  rich = false;
  /** Why the last press changed nothing, if it did not. */
  private note = '';
  private readonly undos: Dungeon[] = [];
  /** The map as editing began: using it unchanged keeps the dungeon's own code. */
  private readonly startMap: string;

  constructor(private readonly host: EditorHost, from: Dungeon) {
    this.draft = copyDungeon(from);
    this.startMap = mapCode(this.draft);
  }

  private use(): void {
    const code = mapCode(this.draft);
    if (code === this.startMap) this.host.editCancel();
    else this.host.editDone(code);
  }

  /** What the board shows: the map before anyone moves. */
  state(): RaidState {
    const d = this.draft;
    return newRaid(d.stairs < 0 ? { ...d, stairs: 0 } : d);
  }

  /** A cell pressed (`first`) or dragged over on the board. */
  press(i: number, first: boolean): void {
    if (first) this.remember();
    const before = mapCode(this.draft);
    const why = paint(this.draft, i, this.brush, { gold: this.gold, rich: this.rich });
    // A refusal is said on the press only, so dragging along the edge stays quiet.
    if (first || !why) this.note = why ?? '';
    if (first && mapCode(this.draft) === before) this.undos.pop();
    this.host.editChanged();
  }

  undo(): void {
    const d = this.undos.pop();
    if (!d) return;
    this.draft = d;
    this.note = '';
    this.host.editChanged();
  }

  private remember(): void {
    this.undos.push(copyDungeon(this.draft));
    if (this.undos.length > UNDO) this.undos.shift();
  }

  private clearAll(): void {
    this.remember();
    this.draft = emptyDungeon();
    this.note = 'Solid stone. Paint floor to dig out rooms, and put the stairs somewhere.';
    this.brush = 'floor';
    this.host.editChanged();
  }

  private choose(b: Brush): void {
    this.brush = b;
    this.note = '';
    this.host.editChanged();
  }

  panel(): (Node | null)[] {
    const d = this.draft;
    const check = checkMap(d);
    const palette = PALETTE.map((p) => h('div', { class: 'palette-group' },
      h('span', { class: 'muted' }, p.group),
      h('div', { class: 'palette' }, ...p.brushes.map((b) => h('button', {
        class: `brush ${this.brush === b.brush ? 'chosen' : ''}`, 'aria-pressed': String(this.brush === b.brush),
        onclick: () => this.choose(b.brush),
      }, b.icon(), b.label)))));

    const goldInput = h('input', { type: 'number', min: LIMITS.goldMin, max: LIMITS.goldMax, value: this.gold, 'aria-label': 'Gold in a pile' });
    goldInput.addEventListener('change', () => {
      const v = Math.round(Number(goldInput.value));
      this.gold = Math.min(LIMITS.goldMax, Math.max(LIMITS.goldMin, Number.isFinite(v) ? v : 3));
      goldInput.value = String(this.gold);
    });
    const richBox = h('input', { type: 'checkbox', checked: this.rich });
    richBox.addEventListener('change', () => { this.rich = richBox.checked; });
    const option = this.brush === 'gold'
      ? h('label', { class: 'row' }, 'Gold in a pile ', goldInput, h('span', { class: 'muted' }, `${LIMITS.goldMin}–${LIMITS.goldMax}; a heap from 6`))
      : isMonster(this.brush)
        ? h('label', { class: 'row' }, richBox, icon(lootSack(), 0.45), 'Rich (carries 3 times the gold)')
        : null;

    const gold = d.gold.reduce((a, b) => a + b, 0) + d.monsters.reduce((a, m) => a + monsterGold(m), 0);
    const monsters = MONSTER_KINDS.map((k) => {
      const n = d.monsters.filter((m) => m.kind === k).length;
      return `${n} ${k}${n === 1 ? '' : 's'}`;
    }).join(', ');
    const tally = (t: Tile) => d.tiles.filter((u) => u === t).length;
    const things = `${tally(POTION)} potions, ${tally(TORCH)} torches, ${tally(STRENGTH)} strength, ${tally(VIGOUR)} vigour, ${tally(TRAP)} spike traps`;

    return [
      h('h2', {}, 'Edit the dungeon'),
      h('p', { class: 'caption' }, 'Click or drag on the board to paint. He learned in generated dungeons; a map unlike them shows how he copes with something new, like a language model given a prompt unlike anything it read.'),
      ...palette,
      option,
      h('p', { class: 'muted edit-note', 'aria-live': 'polite' }, this.note),
      h('p', { class: 'muted' }, `${gold} gold in all. ${monsters}. ${things}.`),
      check.problems.length || check.warnings.length
        ? h('ul', { class: 'checks' },
          ...check.problems.map((p) => h('li', { class: 'problem' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, '✖'), p)),
          ...check.warnings.map((w) => h('li', { class: 'warning' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, '⚠'), w)))
        : null,
      h('div', { class: 'row' },
        h('button', {
          class: 'primary', disabled: check.problems.length > 0, onclick: () => this.use(),
          title: check.problems.length ? 'Fix the problems marked ✖ first' : 'Put this dungeon on screen, with a link to share it',
        }, 'Use this dungeon'),
        h('button', { onclick: () => this.undo(), disabled: !this.undos.length, title: 'Key: Ctrl+Z' }, 'Undo'),
        h('button', { class: 'subtle', onclick: () => this.clearAll() }, 'Clear to stone'),
        h('button', { class: 'subtle', onclick: () => this.host.editCancel() }, 'Cancel')),
      h('p', { class: 'muted' }, `At most ${LIMITS.monsters} monsters, ${LIMITS.goldPiles} gold piles, ${LIMITS.items} of each thing and ${LIMITS.traps} spike traps. The bedrock edge stays.`),
    ];
  }
}
