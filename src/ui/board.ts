/**
 * The board: the whole dungeon as he raids it, drawn as SVG. Cells he does not see are dimmed and hatched (what the
 * model never gets); a soft light sits around him, warm and flickering while his torch burns, smaller when it
 * burns low; his 5 × 5 view is framed. Monsters show their HP (bar and number) and gold; wounded ones wear a
 * bandage, rich ones carry a sack. Floor marks (pools and prints) and short effects (coins scattering, smoke when
 * the torch goes out, damage) are drawn on top.
 */
import type { EventSpot } from '../events';
import type { FloorMarks } from '../marks';
import { SIGHT_DARK, SIGHT_LIT, VIEW_SIZE, seenTiles } from '../sight';
import { GOLD, MONSTER_STATS, isWounded, monsterGold, shownKind, type Monster } from '../tiles';
import { torchLit, type RaidState, type StepResult } from '../world';
import { clear, s } from './dom';
import { COLORS, T, bandage, barbarian, coinLabel, eventSpot, footprint, itemSymbol, lootSack, monsterBody, tileSymbol, torch } from './symbols';

/** The torch counts as burning low at this many lit views left (the "burning low" token). */
const LOW_TORCH = 3;

export interface BoardOptions {
  /** Dim and hatch the cells he does not see (default on). */
  dim?: boolean;
  /** The torchlight flickers (default on; never with reduced motion, see the CSS). */
  flicker?: boolean;
  /** Pools and prints. */
  marks?: FloorMarks | null;
  /** Event spots to draw ("Show events (for testing)"). */
  spots?: readonly EventSpot[] | null;
  /** Draw him and his light (default on; off in the dungeon editor). */
  hero?: boolean;
}

/** A cell pressed on the board while editing: `first` for the press, false for cells dragged over after it. */
export type CellHandler = (i: number, first: boolean) => void;

const at = (size: number, i: number): [number, number] => [(i % size) * T + T / 2, Math.floor(i / size) * T + T / 2];
const place = (x: number, y: number) => `translate(${x}px, ${y}px)`;

export class Board {
  readonly el: SVGSVGElement;
  private readonly tiles = s('g', { class: 'layer-tiles' });
  private readonly marks = s('g', { class: 'layer-marks' });
  private readonly items = s('g', { class: 'layer-items' });
  private readonly spots = s('g', { class: 'layer-spots' });
  private readonly monsters = s('g', { class: 'layer-monsters' });
  private readonly dark = s('g', { class: 'layer-dark' });
  private readonly hero = s('g', { class: 'actor hero' });
  private readonly glow = s('g', { class: 'actor glow-wrap' });
  private readonly fx = s('g', { class: 'layer-fx' });
  private readonly bubble = s('g', { class: 'layer-bubble', 'aria-hidden': 'true' });
  private readonly monsterEls = new Map<Monster, SVGGElement>();
  private size = 0;
  private onCell: CellHandler | null = null;
  private pressed = -1;

  constructor() {
    this.el = s('svg', { class: 'board', role: 'img', 'aria-label': 'The dungeon' });
    const defs = s('defs', {},
      s('pattern', { id: 'dark-hatch', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
        s('rect', { width: 8, height: 8, fill: '#15120e' }),
        s('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: '#3a332a', 'stroke-width': 3 })),
      s('radialGradient', { id: 'torch-light' },
        s('stop', { offset: '0%', 'stop-color': '#ffcf6b', 'stop-opacity': 0.6 }),
        s('stop', { offset: '60%', 'stop-color': '#ffb347', 'stop-opacity': 0.3 }),
        s('stop', { offset: '100%', 'stop-color': '#ff9a2e', 'stop-opacity': 0 })),
      s('radialGradient', { id: 'dim-light' },
        s('stop', { offset: '0%', 'stop-color': '#fff4dc', 'stop-opacity': 0.15 }),
        s('stop', { offset: '100%', 'stop-color': '#fff4dc', 'stop-opacity': 0 })));
    this.hero.append(barbarian());
    this.el.append(defs, this.tiles, this.marks, this.items, this.spots, this.monsters, this.dark, this.glow, this.hero, this.fx, this.bubble);
    this.el.addEventListener('pointerdown', (e) => {
      if (!this.onCell || e.button !== 0) return;
      const i = this.cellAt(e);
      if (i < 0) return;
      e.preventDefault();
      this.el.setPointerCapture?.(e.pointerId);
      this.pressed = i;
      this.onCell(i, true);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!this.onCell || this.pressed < 0) return;
      const i = this.cellAt(e);
      if (i < 0 || i === this.pressed) return;
      this.pressed = i;
      this.onCell(i, false);
    });
    const release = () => { this.pressed = -1; };
    this.el.addEventListener('pointerup', release);
    this.el.addEventListener('pointercancel', release);
  }

  /** Cells pressed or dragged over go to `handler` (the dungeon editor); null stops it. */
  editWith(handler: CellHandler | null): void {
    if (handler === this.onCell) return;
    this.onCell = handler;
    this.pressed = -1;
    this.el.classList.toggle('editing', !!handler);
  }

  /** The cell under the pointer, or -1. */
  private cellAt(e: PointerEvent): number {
    const m = this.el.getScreenCTM();
    if (!m || !this.size) return -1;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const x = Math.floor(p.x / T);
    const y = Math.floor(p.y / T);
    return x >= 0 && y >= 0 && x < this.size && y < this.size ? y * this.size + x : -1;
  }

  /** Forget the monsters drawn (a new dungeon or a new raid), so none slides in from where an old one stood. */
  reset(): void {
    this.monsterEls.clear();
    clear(this.monsters);
    clear(this.fx);
    clear(this.bubble);
    this.hero.classList.add('no-anim');
    this.glow.classList.add('no-anim');
  }

  render(st: RaidState, o: BoardOptions = {}): void {
    const { size, tiles, wallHp, gold } = st.map;
    if (size !== this.size) {
      this.size = size;
      this.el.setAttribute('viewBox', `0 0 ${size * T} ${size * T}`);
    }
    clear(this.tiles);
    clear(this.items);
    for (let i = 0; i < size * size; i++) {
      const [x, y] = at(size, i);
      const shown = shownKind(tiles[i], wallHp[i], gold[i]);
      this.tiles.append(s('g', { transform: `translate(${x} ${y})` }, tileSymbol(shown)));
      const item = itemSymbol(shown);
      if (item) {
        const g = s('g', { transform: `translate(${x} ${y})` }, item);
        if (tiles[i] === GOLD) g.append(s('text', { x: 18, y: 18, class: 'num pile-num' }, String(gold[i])));
        this.items.append(g);
      }
    }
    this.renderMarks(size, o.marks ?? null);
    this.renderSpots(size, o.spots ?? null);
    this.renderMonsters(size, st.monsters);
    const hero = o.hero !== false && st.pos >= 0;
    this.hero.style.display = hero ? '' : 'none';
    this.glow.style.display = hero ? '' : 'none';
    if (hero) this.renderLight(st, o);
    else { clear(this.dark); clear(this.glow); }
    const [hx, hy] = at(size, Math.max(0, st.pos));
    this.hero.style.transform = place(hx, hy);
    this.glow.style.transform = place(hx, hy);
    this.hero.classList.toggle('out', st.ended === 'knockedOut');
    // Let the next move slide again after a reset.
    requestAnimationFrame(() => {
      this.hero.classList.remove('no-anim');
      this.glow.classList.remove('no-anim');
    });
  }

  private renderMarks(size: number, marks: FloorMarks | null): void {
    clear(this.marks);
    if (!marks) return;
    for (const p of marks.pools) {
      const [x, y] = at(size, p.at);
      const fill = p.kind === 'slime' ? COLORS.slime : COLORS.blood;
      this.marks.append(s('path', {
        class: `pool ${p.kind}`, transform: `translate(${x} ${y})`, fill, 'fill-opacity': p.kind === 'slime' ? 0.55 : 0.5,
        d: 'M-12 2 C-14 -6 -6 -11 1 -9 C8 -12 15 -5 12 3 C14 9 6 13 0 11 C-6 14 -13 9 -12 2 Z M14 -12 a2.5 2.5 0 1 0 0.1 0 Z',
      }));
    }
    for (const p of marks.prints) {
      const [x, y] = at(size, p.at);
      // Left and right foot side by side, fainter with every step from the pool.
      const fill = p.kind === 'slime' ? COLORS.slime : COLORS.blood;
      const opacity = 0.75 - 0.15 * p.n;
      this.marks.append(s('g', { class: `print ${p.kind}`, transform: `translate(${x} ${y}) rotate(${p.dir * 90})`, fill, 'fill-opacity': opacity },
        s('g', { transform: 'translate(-5 4)' }, footprint()),
        s('g', { transform: 'translate(5 -6)' }, footprint())));
    }
  }

  private renderSpots(size: number, spots: readonly EventSpot[] | null): void {
    clear(this.spots);
    for (const sp of spots ?? []) {
      const [x, y] = at(size, sp.i);
      this.spots.append(s('g', { transform: `translate(${x} ${y})` }, eventSpot()));
    }
  }

  private renderMonsters(size: number, monsters: readonly Monster[]): void {
    const live = new Set(monsters);
    for (const [m, el] of this.monsterEls) {
      if (!live.has(m)) {
        el.remove();
        this.monsterEls.delete(m);
      }
    }
    for (const m of monsters) {
      let el = this.monsterEls.get(m);
      if (!el) {
        el = s('g', { class: 'actor monster no-anim' });
        this.monsterEls.set(m, el);
        this.monsters.append(el);
        const fresh = el;
        requestAnimationFrame(() => requestAnimationFrame(() => fresh.classList.remove('no-anim')));
      }
      const [x, y] = at(size, m.pos);
      el.style.transform = place(x, y);
      el.setAttribute('aria-label', `${m.kind}, ${m.hp} HP`);
      clear(el).append(...monsterParts(m));
    }
  }

  private renderLight(st: RaidState, o: BoardOptions): void {
    clear(this.dark);
    clear(this.glow);
    const { size } = st.map;
    const lit = torchLit(st);
    if (o.dim !== false && !st.ended) {
      const seen = new Set(seenTiles({ ...st.map, pos: st.pos, lit }));
      for (let i = 0; i < size * size; i++) {
        if (seen.has(i)) continue;
        const [x, y] = at(size, i);
        this.dark.append(s('rect', { x: x - T / 2, y: y - T / 2, width: T, height: T, fill: 'url(#dark-hatch)', class: 'dark-cell' }));
      }
    }
    if (st.ended) return;
    const reach = lit ? SIGHT_LIT : SIGHT_DARK;
    const low = lit && st.torchLeft <= LOW_TORCH;
    const r = lit ? (low ? 2.1 : 2.8) * T : 1.6 * T;
    const flicker = o.flicker !== false && lit;
    this.glow.append(
      s('circle', { r, fill: lit ? 'url(#torch-light)' : 'url(#dim-light)', class: `glow ${lit ? 'lit' : 'unlit'} ${flicker ? 'flicker' : ''} ${low ? 'low' : ''}` }),
      // The light's reach (3 × 3 in the dark, 5 × 5 with the torch) and his 5 × 5 view.
      s('rect', { class: `reach ${lit ? 'lit' : ''}`, x: -(reach + 0.5) * T, y: -(reach + 0.5) * T, width: (2 * reach + 1) * T, height: (2 * reach + 1) * T, rx: 6 }),
      s('rect', { class: 'view-frame', x: -(VIEW_SIZE / 2) * T, y: -(VIEW_SIZE / 2) * T, width: VIEW_SIZE * T, height: VIEW_SIZE * T, rx: 8 }));
    if (lit) this.glow.append(s('g', { transform: 'translate(13 -13) scale(0.55)', class: low ? 'held-torch low' : 'held-torch' }, torch(true)));
  }

  /** Short effects for what a step did: coins scattering from a beaten monster, smoke when the torch goes out, damage. */
  effects(st: RaidState, r: StepResult): void {
    const { size } = st.map;
    if (r.beaten) {
      const [fx, fy] = at(size, r.beaten.monster.pos);
      const [tx, ty] = at(size, r.beaten.at);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.4;
        const c = s('g', { class: 'fx-coin' },
          s('circle', { r: 4, fill: COLORS.coin, stroke: COLORS.coinEdge, 'stroke-width': 1.2 }));
        c.style.setProperty('--from', place(fx, fy));
        c.style.setProperty('--mid', place(fx + Math.cos(a) * 18, fy + Math.sin(a) * 18 - 10));
        c.style.setProperty('--to', place(tx + (k % 3 - 1) * 5, ty + (k < 3 ? 2 : 7)));
        c.style.animationDelay = `${k * 25}ms`;
        this.addFx(c, 900);
      }
    }
    if (r.torchOut) {
      const [x, y] = at(size, st.pos);
      const puff = s('g', { class: 'fx-smoke', transform: `translate(${x + 10} ${y - 14})` },
        s('circle', { cx: 0, cy: 0, r: 5 }), s('circle', { cx: 5, cy: -6, r: 6 }), s('circle', { cx: -3, cy: -12, r: 7 }));
      this.addFx(puff, 1400);
    }
    const damage = r.trapDamage + r.hits.reduce((a, h) => a + h.damage, 0);
    if (damage > 0) this.pop(st.pos, `−${damage}`, 'danger');
    if (r.goldGained > 0) this.pop(st.pos, `+${r.goldGained}`, 'gold');
  }

  /** A short word over a tile: damage, gold, an event's pop-up. */
  pop(i: number, text: string, kind: 'danger' | 'gold' | 'event' = 'event'): void {
    const [x, y] = at(this.size, i);
    const g = s('g', { transform: `translate(${x} ${y - 24})` }, s('text', { class: `fx-pop ${kind}`, x: 0, y: 0 }, text));
    this.addFx(g, 1600);
  }

  /**
   * His thought bubble over tile `i` (null takes it away). It sits above him, or below near the top edge, and is
   * kept inside the board.
   */
  say(lines: readonly string[] | null, i = 0): void {
    clear(this.bubble);
    if (!lines?.length) return;
    const [x, y] = at(this.size, i);
    const lh = 28;
    const pad = { x: 12, y: 8 };
    const g = s('g', { class: 'bubble' });
    const box = s('rect', { rx: 10 });
    const tail = s('path', {});
    const texts = lines.map((l) => s('text', {}, l));
    g.append(tail, box, ...texts);
    this.bubble.append(g);
    // Measure the text when it is on screen; guess from the length when it is not.
    const width = Math.max(...texts.map((t, k) => {
      let w = 0;
      try { w = t.getComputedTextLength(); } catch { /* not rendered */ }
      return w > 0 ? w : lines[k].length * 11.6;
    })) + 2 * pad.x;
    const height = lines.length * lh + 2 * pad.y;
    const full = this.size * T;
    const bx = Math.min(Math.max(4, x - width / 2), full - width - 4);
    const gap = 12;
    const above = y - T / 2 - gap - height >= 4;
    const by = above ? y - T / 2 - gap - height : y + T / 2 + gap;
    box.setAttribute('x', String(bx));
    box.setAttribute('y', String(by));
    box.setAttribute('width', String(width));
    box.setAttribute('height', String(height));
    const tx = Math.min(Math.max(bx + 14, x), bx + width - 14);
    tail.setAttribute('d', above
      ? `M${tx - 7} ${by + height - 1} L${x} ${y - T / 2 + 2} L${tx + 7} ${by + height - 1} Z`
      : `M${tx - 7} ${by + 1} L${x} ${y + T / 2 - 2} L${tx + 7} ${by + 1} Z`);
    texts.forEach((t, k) => {
      t.setAttribute('x', String(bx + pad.x));
      t.setAttribute('y', String(by + pad.y + lh * k + 22));
    });
  }

  private addFx(el: SVGElement, ms: number): void {
    this.fx.append(el);
    setTimeout(() => el.remove(), ms);
  }
}

/** A monster: body, bandage if wounded, sack if rich, HP bar with the number, and the gold it carries. */
function monsterParts(m: Monster): SVGElement[] {
  const max = MONSTER_STATS[m.kind].hp;
  const wounded = isWounded(m);
  const big = m.kind === 'troll' ? 1 : m.kind === 'rat' ? 0.78 : 0.88;
  const parts: SVGElement[] = [s('g', { transform: `translate(0 -3) scale(${big})` }, monsterBody(m.kind), wounded ? bandage() : null)];
  if (m.rich) parts.push(s('g', { transform: 'translate(-13 -11) scale(0.8)' }, lootSack()));
  const w = 22;
  parts.push(s('g', { class: 'hp' },
    s('rect', { x: -18, y: 13, width: w + 2, height: 5.5, rx: 2, fill: '#2b2622' }),
    s('rect', { x: -17, y: 14, width: (w * Math.max(0, m.hp)) / max, height: 3.5, rx: 1.5, fill: wounded ? COLORS.hpWounded : COLORS.hpBar }),
    s('text', { x: 12, y: 19, class: 'num hp-num' }, String(m.hp))));
  parts.push(coinLabel(7, -15, monsterGold(m)));
  return parts;
}
