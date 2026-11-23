/**
 * The app: tabs in the order the story goes, the board, and a side panel per tab. This first version has the
 * Dungeon tab (pick a code, look around, walk him yourself) and Settings; the other tabs come in later steps.
 */
import { generateDungeon, type Dungeon } from '../dungeon';
import { CAST, EventTracker, placeEvents, spotsLabel } from '../events';
import { FloorMarks } from '../marks';
import { normalizeCode, randomCode, rngFrom, type Rng } from '../rng';
import { MONSTER_KINDS, SHOWN, monsterGold, type MonsterKind } from '../tiles';
import { MEMORY_SIZES, type MemoryName } from '../tokens';
import { DOWN, LEAVE, LEFT, LIGHT_TORCH, PICK_UP, RIGHT, RULES, UP, WAIT, DRINK, newRaid, step, torchLit, type Action, type RaidState } from '../world';
import { Board } from './board';
import { add, clear, h, s } from './dom';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import {
  COLORS, T, bandage, barbarian, eventSpot, footprint, itemSymbol, lootSack, monsterBody, potion, tileSymbol, torch,
} from './symbols';

type TabId = 'dungeon' | 'lessons' | 'raid' | 'practice' | 'many' | 'inside' | 'settings';
const TABS: { id: TabId; label: string; soon?: string }[] = [
  { id: 'dungeon', label: '1. Dungeon' },
  { id: 'lessons', label: '2. Lessons', soon: 'He watches a teacher raid and learns to copy each next action.' },
  { id: 'raid', label: '3. Raid alone', soon: 'He raids on his own, one predicted action at a time, thinking out loud. A skald sings the saga after.' },
  { id: 'practice', label: '4. Practice', soon: 'He raids again and again, and a judge scores each raid.' },
  { id: 'many', label: '5. Many raids', soon: 'Hundreds of raids at once, and what they add up to.' },
  { id: 'inside', label: '6. Inside the model', soon: 'The numbers he reads and the weights that turn them into actions.' },
  { id: 'settings', label: '⚙ Settings' },
];

/** Your own walk through the dungeon on the Dungeon tab: you pick each action. */
interface Walk {
  state: RaidState;
  marks: FloorMarks;
  monsterRng: Rng;
  events: EventTracker | null;
  last: string;
}

/** Keys for walking him yourself. */
const KEYS: Record<string, Action> = {
  ArrowUp: UP, ArrowRight: RIGHT, ArrowDown: DOWN, ArrowLeft: LEFT,
  p: PICK_UP, d: DRINK, t: LIGHT_TORCH, l: LEAVE, ' ': WAIT,
};

const ACTION_BUTTONS: { a: Action; label: string; key: string }[] = [
  { a: PICK_UP, label: 'Pick up', key: 'P' },
  { a: DRINK, label: 'Drink', key: 'D' },
  { a: LIGHT_TORCH, label: 'Light torch', key: 'T' },
  { a: LEAVE, label: 'Leave', key: 'L' },
  { a: WAIT, label: 'Wait', key: 'Space' },
];

const MEMORY_LABELS: Record<MemoryName, string> = { short: 'Short', medium: 'Medium', long: 'Long' };

export class App {
  tab: TabId = 'dungeon';
  settings: Settings = { ...DEFAULT_SETTINGS };
  dungeon!: Dungeon;
  walk!: Walk;
  private readonly board = new Board();
  private readonly tabsEl = h('nav', { class: 'tabs', role: 'tablist' });
  private readonly statsEl = h('div', { class: 'stats', 'aria-live': 'polite' });
  private readonly panelEl = h('section', { class: 'panel' });

  constructor(root: HTMLElement) {
    root.append(
      h('header', { class: 'top' },
        h('div', { class: 'title' },
          h('h1', {}, 'Barbarian LM'),
          h('p', {}, 'A barbarian raids a dungeon one predicted action at a time, the way a language model writes one word at a time.')),
        this.tabsEl),
      h('div', { class: 'stage' },
        h('div', { class: 'main-col' }, this.statsEl, h('div', { class: 'board-wrap' }, this.board.el)),
        this.panelEl));
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.setCode(randomCode());
  }

  setCode(code: string): void {
    this.dungeon = generateDungeon(code);
    this.restartWalk();
  }

  restartWalk(): void {
    const d = this.dungeon;
    const state = newRaid(d);
    let events: EventTracker | null = null;
    if (this.settings.events) {
      // Your walk counts as its own raid, "you", with streams of its own (see docs/plan.md).
      const label = this.settings.newSpots ? `${d.code}|events|you` : spotsLabel(d.code);
      events = new EventTracker({ spots: placeEvents(d, label), cast: CAST }, rngFrom(`${d.code}|you|story`), state);
    }
    this.walk = { state, marks: new FloorMarks(state.pos), monsterRng: rngFrom(`${d.code}|you|monsters`), events, last: '' };
    this.board.reset();
    this.render();
  }

  act(a: Action): void {
    const w = this.walk;
    if (w.state.ended) return;
    const r = step(w.state, a, w.monsterRng);
    w.marks.after(r, w.state.pos, w.state.turn);
    const met = w.events?.after(w.state) ?? [];
    this.board.render(w.state, this.boardOptions());
    this.board.effects(w.state, r);
    for (const e of met) {
      const k = w.events?.kind(e.kind);
      if (k) this.board.pop(w.state.pos, k.popup, 'event');
    }
    w.last = r.did === 'nothing' ? 'Nothing happened.' : '';
    this.renderStats();
    this.renderPanel();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.tab !== 'dungeon' || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON' && e.key === ' ')) return;
    const a = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (a === undefined) return;
    e.preventDefault();
    this.act(a);
  }

  private boardOptions() {
    const st = this.settings;
    return {
      dim: st.dim,
      flicker: st.flicker,
      marks: st.fightMarks ? this.walk.marks : null,
      spots: st.events && st.showEvents ? this.walk.events?.setup.spots ?? null : null,
    };
  }

  render(): void {
    this.renderTabs();
    this.board.render(this.walk.state, this.boardOptions());
    this.renderStats();
    this.renderPanel();
  }

  private renderTabs(): void {
    clear(this.tabsEl);
    for (const t of TABS) {
      this.tabsEl.append(h('button', {
        role: 'tab', class: `tab ${this.tab === t.id ? 'active' : ''}`, 'aria-selected': String(this.tab === t.id),
        onclick: () => { this.tab = t.id; this.render(); },
      }, t.label));
    }
  }

  private renderStats(): void {
    const st = this.walk.state;
    const low = st.hp <= 4;
    const lit = torchLit(st);
    clear(this.statsEl);
    add(this.statsEl,
      stat(heartIcon(low), 'HP', `${st.hp} / ${st.maxHp}`, low ? 'danger' : ''),
      stat(swordIcon(), 'Attack', String(st.attack)),
      stat(icon(potion(), 0.55), 'Potions', String(st.potions)),
      stat(icon(torch(lit), 0.55), 'Torches', lit ? `${st.torches} · lit ${st.torchLeft}` : String(st.torches)),
      stat(icon(itemSymbol(SHOWN.smallGold)!, 0.6), 'Gold', String(st.gold)),
      stat(sunIcon(), 'Time left', String(st.timeLeft), st.timeLeft <= 20 ? 'warn-text' : ''));
  }

  private renderPanel(): void {
    clear(this.panelEl);
    const t = TABS.find((x) => x.id === this.tab)!;
    if (this.tab === 'dungeon') this.dungeonPanel();
    else if (this.tab === 'settings') this.settingsPanel();
    else this.panelEl.append(h('h2', {}, t.label.replace(/^\d+\. /, '')), h('p', {}, t.soon ?? ''), h('p', { class: 'muted' }, 'Coming soon.'));
  }

  private dungeonPanel(): void {
    const d = this.dungeon;
    const input = h('input', { type: 'text', 'aria-label': 'Dungeon code', placeholder: 'CODE', maxlength: 12 });
    const go = () => {
      const code = normalizeCode(input.value);
      if (code) this.setCode(code);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const goldTotal = d.gold.reduce((a, b) => a + b, 0) + d.monsters.reduce((a, m) => a + monsterGold(m), 0);
    const count = (k: MonsterKind) => d.monsters.filter((m) => m.kind === k).length;
    add(this.panelEl,
      h('h2', {}, 'The dungeon'),
      h('div', { class: 'code-line' }, h('span', { class: 'muted' }, 'Dungeon code'), h('span', { class: 'code' }, d.code)),
      h('div', { class: 'row code-row' },
        h('button', { onclick: () => this.setCode(randomCode()) }, 'New dungeon'),
        input,
        h('button', { onclick: go }, 'Go')),
      h('p', { class: 'muted' },
        `${goldTotal} gold in all. `,
        MONSTER_KINDS.map((k) => `${count(k)} ${k}${count(k) === 1 ? '' : 's'}`).join(', '), '.'),
      h('p', { class: 'caption' }, 'You see the whole dungeon. He sees only the lit cells around him; the dark, hatched cells are missing from his view.'),
      this.walkGroup(),
      this.legend());
  }

  private walkGroup(): HTMLElement {
    const st = this.walk.state;
    const arrow = (a: Action, label: string, cls: string) => h('button', { class: `arrow ${cls}`, 'aria-label': label, onclick: () => this.act(a), disabled: !!st.ended }, ['↑', '→', '↓', '←'][a]);
    const end = st.ended === 'left'
      ? (st.gold > 0 ? `Out with ${st.gold} gold!` : 'Out, with empty pockets.')
      : st.ended === 'knockedOut' ? 'Knocked out! The keeper carries him out. The gold stays behind.'
        : st.ended === 'lockedIn' ? 'The gate closed at sundown. Locked in till morning; the keeper keeps the gold.' : '';
    return h('div', { class: 'group' },
      h('h3', {}, 'Walk him yourself'),
      h('p', { class: 'muted' }, 'You pick each action, the way the model will. Arrow keys walk, attack and dig.'),
      h('div', { class: 'walk' },
        h('div', { class: 'pad' }, arrow(UP, 'Up', 'up'), arrow(LEFT, 'Left', 'left'), arrow(DOWN, 'Down', 'down'), arrow(RIGHT, 'Right', 'right')),
        h('div', { class: 'row actions' }, ...ACTION_BUTTONS.map((b) =>
          h('button', { onclick: () => this.act(b.a), disabled: !!st.ended, title: `Key: ${b.key}` }, b.label, h('kbd', {}, b.key))))),
      end ? h('p', { class: `end ${st.ended === 'left' && st.gold > 0 ? 'good' : 'bad'}` }, end) : this.walk.last ? h('p', { class: 'muted' }, this.walk.last) : null,
      h('div', { class: 'row' },
        h('button', { class: 'subtle', onclick: () => this.restartWalk() }, st.turn ? 'Start again' : 'Back to the stairs'),
        h('span', { class: 'muted' }, `Turn ${st.turn} of ${RULES.timeLimit}`)));
  }

  private legend(): HTMLElement {
    const tileIcon = (shown: number) => icon(s('g', {}, tileSymbol(shown), itemSymbol(shown)), 0.6);
    const mon = (k: MonsterKind) => icon(monsterBody(k), 0.6);
    const items: [SVGSVGElement, string][] = [
      [icon(barbarian(), 0.6), 'Him'],
      [tileIcon(SHOWN.stairs), 'Stairs (the way out)'],
      [tileIcon(SHOWN.stone), 'Stone wall (dig)'],
      [tileIcon(SHOWN.cracked), 'Cracked wall'],
      [tileIcon(SHOWN.bedrock), 'Bedrock'],
      [tileIcon(SHOWN.trap), 'Spike trap'],
      [tileIcon(SHOWN.smallGold), 'Gold (small)'],
      [tileIcon(SHOWN.heap), 'Gold heap (6+)'],
      [tileIcon(SHOWN.potion), 'Potion'],
      [tileIcon(SHOWN.torch), 'Torch'],
      [tileIcon(SHOWN.strength), 'Strength (+1 attack)'],
      [tileIcon(SHOWN.vigour), 'Vigour (+4 max HP)'],
      [mon('rat'), 'Rat'],
      [mon('goblin'), 'Goblin'],
      [mon('slime'), 'Slime (never moves)'],
      [mon('troll'), 'Troll (never moves)'],
      [icon(s('g', {}, monsterBody('goblin'), bandage()), 0.6), 'Wounded (half HP or less)'],
      [icon(s('g', { transform: 'scale(1.5)' }, lootSack()), 0.6), 'Rich (3 × gold)'],
      [icon(s('rect', { x: -T / 2, y: -T / 2, width: T, height: T, fill: 'url(#legend-hatch)' }), 0.6, true), 'Out of his sight'],
      [icon(s('path', { d: 'M-12 2 C-14 -6 -6 -11 1 -9 C8 -12 15 -5 12 3 C14 9 6 13 0 11 C-6 14 -13 9 -12 2 Z', fill: COLORS.blood, 'fill-opacity': 0.45 }), 0.6), 'Where a monster fell'],
      [icon(s('g', { fill: COLORS.blood, 'fill-opacity': 0.4 }, s('g', { transform: 'translate(-5 4)' }, footprint()), s('g', { transform: 'translate(5 -6)' }, footprint())), 0.6), 'His prints'],
    ];
    if (this.settings.events && this.settings.showEvents) items.push([icon(eventSpot(), 0.6), 'Hidden event']);
    return h('details', { class: 'group legend', open: true },
      h('summary', {}, 'What\'s what'),
      h('ul', {}, ...items.map(([ic, name]) => h('li', {}, ic, h('span', {}, name)))));
  }

  private settingsPanel(): void {
    const st = this.settings;
    const set = <K extends keyof Settings>(k: K, v: Settings[K], restart = false) => {
      this.settings = { ...this.settings, [k]: v };
      if (restart) this.restartWalk();
      else this.render();
    };
    const check = (k: 'events' | 'newSpots' | 'showEvents' | 'thoughts' | 'dim' | 'flicker' | 'fightMarks', label: string, note?: string, restart = false) =>
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: st[k], onchange: (e: Event) => set(k, (e.target as HTMLInputElement).checked, restart) }),
        h('span', {}, label, note ? h('small', { class: 'muted' }, ` ${note}`) : null));
    const radio = <K extends 'memory' | 'trainIn'>(k: K, options: [Settings[K], string][]) =>
      h('div', { class: 'row', role: 'radiogroup' }, ...options.map(([v, label]) =>
        h('label', { class: 'radio' },
          h('input', { type: 'radio', name: k, checked: st[k] === v, onchange: () => set(k, v) }),
          label)));
    add(this.panelEl,
      h('h2', {}, 'Settings'),
      h('div', { class: 'group' },
        h('h3', {}, 'His memory'),
        radio('memory', (Object.keys(MEMORY_SIZES) as MemoryName[]).map((m) => [m, `${MEMORY_LABELS[m]} (${MEMORY_SIZES[m]})`])),
        h('p', { class: 'muted' }, 'How many past views and actions he remembers. Set it before lessons: it fixes the size of his model.')),
      h('div', { class: 'group' },
        h('h3', {}, 'Lessons and practice'),
        radio('trainIn', [['shown', 'In the dungeon on screen'], ['new', 'A new dungeon every raid']])),
      h('div', { class: 'group' },
        h('h3', {}, 'Hidden events'),
        check('events', 'Events in the dungeon', 'He never sees them coming.', true),
        st.events ? check('newSpots', 'New places every raid', undefined, true) : null,
        st.events ? check('showEvents', 'Show events (for testing)') : null,
        check('thoughts', 'His thoughts on a raid alone')),
      h('div', { class: 'group' },
        h('h3', {}, 'The board'),
        check('dim', 'Dim what he cannot see'),
        check('flicker', 'Torchlight flickers', 'Never with reduced motion.'),
        check('fightMarks', 'Pools and prints', 'Where a monster fell, and his prints after he walks through it.')));
  }
}

/** A small square SVG holding one symbol. */
function icon(g: SVGElement, scale = 0.6, hatch = false): SVGSVGElement {
  const size = Math.round(T * scale);
  const el = s('svg', { width: size, height: size, viewBox: `${-T / 2} ${-T / 2} ${T} ${T}`, class: 'icon', 'aria-hidden': 'true' });
  if (hatch) {
    el.append(s('defs', {}, s('pattern', { id: 'legend-hatch', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('rect', { width: 8, height: 8, fill: '#15120e', 'fill-opacity': 0.6 }),
      s('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: '#3a332a', 'stroke-width': 3 }))));
    el.append(s('rect', { x: -T / 2, y: -T / 2, width: T, height: T, fill: COLORS.floor }));
  }
  el.append(g);
  return el;
}

const heartIcon = (low: boolean) => icon(s('path', {
  d: 'M0 14 C-18 2 -15 -14 -6 -14 C-2 -14 0 -11 0 -8 C0 -11 2 -14 6 -14 C15 -14 18 2 0 14 Z',
  fill: low ? COLORS.danger : '#e3cdbb', stroke: COLORS.ink, 'stroke-width': 1.5,
}), 0.55);
const swordIcon = () => icon(s('g', { transform: 'rotate(45)' },
  s('path', { d: 'M0 -17 L4 -12 V5 H-4 V-12 Z', fill: COLORS.blade, stroke: COLORS.ink, 'stroke-width': 1.3 }),
  s('rect', { x: -9, y: 5, width: 18, height: 4, rx: 1.5, fill: COLORS.coin, stroke: COLORS.ink }),
  s('rect', { x: -2, y: 9, width: 4, height: 7, fill: COLORS.wood })), 0.55);
const sunIcon = () => icon(s('g', {},
  s('path', { d: 'M-16 8 A16 16 0 0 1 16 8 Z', fill: '#f2c14e', stroke: COLORS.ink, 'stroke-width': 1.3 }),
  s('path', { d: 'M-18 8 H18', stroke: COLORS.ink, 'stroke-width': 2 })), 0.55);

function stat(ic: SVGSVGElement, label: string, value: string, cls = ''): HTMLElement {
  return h('div', { class: `stat ${cls}` }, ic, h('span', { class: 'label' }, label), h('strong', {}, value));
}
