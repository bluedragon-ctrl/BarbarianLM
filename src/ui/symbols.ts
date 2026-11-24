/**
 * The board's symbols: simple original shapes drawn in code, each centred on (0, 0) in a tile of `T` units.
 * Every kind differs in shape as well as colour. Red is kept for danger (damage, low HP).
 */
import { s } from './dom';
import { SHOWN, type MonsterKind } from '../tiles';

/** One tile, in SVG units. */
export const T = 40;
const H = T / 2;

export const COLORS = {
  ink: '#262321',
  floor: '#d8cfbd',
  floorLine: '#c4b9a4',
  wall: '#7b6b59',
  wallLine: '#5b4e40',
  bedrock: '#36322f',
  bedrockLine: '#4a4541',
  step: '#a3906f',
  stepDark: '#7d6c52',
  spike: '#6e747b',
  coin: '#e2b23f',
  coinEdge: '#8a6418',
  potion: '#3b7dd8',
  glass: '#e9f1fb',
  wood: '#8a5a2b',
  flame: '#f39c1e',
  flameCore: '#ffe27a',
  blade: '#c9d1d9',
  vigour: '#3d9a4d',
  danger: '#c62828',
  hpBar: '#3f9b46',
  hpWounded: '#d99a1e',
  blood: '#5e1f1f',
  slime: '#2f9c8a',
} as const;

const coin = (x: number, y: number, r = 5) =>
  s('circle', { cx: x, cy: y, r, fill: COLORS.coin, stroke: COLORS.coinEdge, 'stroke-width': 1.3 });

/** A small coin with a number, for gold piles and what a monster carries. */
export function coinLabel(x: number, y: number, n: number) {
  return s('g', { class: 'coin-label' },
    coin(x, y, 4.2),
    s('text', { x: x + 6, y: y + 3.6, class: 'num' }, String(n)));
}

const floorRect = () => s('rect', { x: -H, y: -H, width: T, height: T, fill: COLORS.floor, stroke: COLORS.floorLine, 'stroke-width': 1 });

/** A wall block with brick lines; cracked walls get a zigzag crack. */
function wall(cracked: boolean) {
  return s('g', {},
    s('rect', { x: -H, y: -H, width: T, height: T, fill: COLORS.wall }),
    s('path', { d: `M${-H} -7 H${H} M${-H} 7 H${H} M-6 ${-H} V-7 M8 -7 V7 M-6 7 V${H}`, stroke: COLORS.wallLine, 'stroke-width': 1.5, fill: 'none' }),
    cracked ? s('path', { d: 'M-4 -18 L2 -9 L-5 -1 L4 6 L-1 18', stroke: COLORS.ink, 'stroke-width': 2.6, fill: 'none', 'stroke-linejoin': 'round' }) : null);
}

function bedrock() {
  return s('g', {},
    s('rect', { x: -H, y: -H, width: T, height: T, fill: COLORS.bedrock }),
    s('path', { d: 'M-20 0 L0 -20 M-20 20 L20 -20 M0 20 L20 0', stroke: COLORS.bedrockLine, 'stroke-width': 3 }));
}

/** Stairs: three steps going up, and a small arrow. */
function stairs() {
  return s('g', {},
    floorRect(),
    s('rect', { x: -15, y: 4, width: 30, height: 10, fill: COLORS.step, stroke: COLORS.stepDark, 'stroke-width': 1.5 }),
    s('rect', { x: -15, y: -6, width: 20, height: 10, fill: COLORS.step, stroke: COLORS.stepDark, 'stroke-width': 1.5 }),
    s('rect', { x: -15, y: -16, width: 10, height: 10, fill: COLORS.step, stroke: COLORS.stepDark, 'stroke-width': 1.5 }),
    s('path', { d: 'M7 -8 L13 -16 L19 -8 M13 -16 V-2', stroke: COLORS.ink, 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

/** A spike trap: a plate with three spikes. */
function trap() {
  return s('g', {},
    floorRect(),
    s('rect', { x: -15, y: 6, width: 30, height: 6, rx: 2, fill: '#8d8a84' }),
    s('path', { d: 'M-14 6 L-9 -11 L-4 6 Z M-5 6 L0 -15 L5 6 Z M4 6 L9 -11 L14 6 Z', fill: COLORS.spike, stroke: COLORS.ink, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }));
}

/** A few coins (small gold) or a heap of them (from 6). */
export function goldPile(heap: boolean) {
  if (!heap) return s('g', {}, coin(-6, 4), coin(5, 6), coin(0, -3));
  return s('g', {},
    coin(-11, 9), coin(0, 9), coin(11, 9),
    coin(-5.5, 1), coin(5.5, 1), coin(0, -7));
}

/** A round flask of blue potion. */
export function potion() {
  return s('g', {},
    s('rect', { x: -3.5, y: -15, width: 7, height: 4, rx: 1, fill: COLORS.wood }),
    s('rect', { x: -3, y: -12, width: 6, height: 8, fill: COLORS.glass, stroke: COLORS.ink, 'stroke-width': 1.3 }),
    s('circle', { cx: 0, cy: 5, r: 10, fill: COLORS.glass, stroke: COLORS.ink, 'stroke-width': 1.5 }),
    s('path', { d: 'M-9.3 7 A10 10 0 0 0 9.3 7 Z', fill: COLORS.potion }),
    s('circle', { cx: -4, cy: 1, r: 2, fill: '#fff' }));
}

/** An unlit torch: a stick with a wrapped head. */
export function torch(lit = false) {
  return s('g', { transform: 'rotate(20)' },
    s('rect', { x: -2.5, y: -6, width: 5, height: 21, rx: 2, fill: COLORS.wood }),
    s('rect', { x: -4.5, y: -10, width: 9, height: 6, rx: 2, fill: '#5a4632' }),
    lit ? s('path', { d: 'M0 -26 C7 -18 7 -12 0 -9 C-7 -12 -7 -18 0 -26 Z', fill: COLORS.flame }) : null,
    lit ? s('path', { d: 'M0 -20 C3 -16 3 -13 0 -11 C-3 -13 -3 -16 0 -20 Z', fill: COLORS.flameCore }) : null);
}

/** Strength: a sword, point up. */
export function strength() {
  return s('g', {},
    s('path', { d: 'M0 -17 L4 -12 V5 H-4 V-12 Z', fill: COLORS.blade, stroke: COLORS.ink, 'stroke-width': 1.3, 'stroke-linejoin': 'round' }),
    s('rect', { x: -9, y: 5, width: 18, height: 4, rx: 1.5, fill: COLORS.coin, stroke: COLORS.ink, 'stroke-width': 1.2 }),
    s('rect', { x: -2, y: 9, width: 4, height: 7, fill: COLORS.wood }),
    s('circle', { cx: 0, cy: 17, r: 2.5, fill: COLORS.coin }));
}

/** Vigour: a green heart with a white plus. */
export function vigour() {
  return s('g', {},
    s('path', { d: 'M0 14 C-18 2 -15 -14 -6 -14 C-2 -14 0 -11 0 -8 C0 -11 2 -14 6 -14 C15 -14 18 2 0 14 Z', fill: COLORS.vigour, stroke: COLORS.ink, 'stroke-width': 1.3 }),
    s('path', { d: 'M0 -7 V5 M-6 -1 H6', stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round' }));
}

/** The tile underneath, for any shown kind (items are drawn on floor). */
export function tileSymbol(shown: number) {
  switch (shown) {
    case SHOWN.stone: return wall(false);
    case SHOWN.cracked: return wall(true);
    case SHOWN.bedrock: return bedrock();
    case SHOWN.stairs: return stairs();
    case SHOWN.trap: return trap();
    default: return floorRect();
  }
}

/** The item lying on a tile, if any. */
export function itemSymbol(shown: number) {
  switch (shown) {
    case SHOWN.smallGold: return goldPile(false);
    case SHOWN.heap: return goldPile(true);
    case SHOWN.potion: return potion();
    case SHOWN.torch: return torch();
    case SHOWN.strength: return strength();
    case SHOWN.vigour: return vigour();
    default: return null;
  }
}

const eye = (x: number, y: number, r = 1.8, fill = COLORS.ink) => s('circle', { cx: x, cy: y, r, fill });

/** Monster bodies: a rat, a goblin head with pointed ears, a slime blob, a troll with tusks, a horned dragon with wings. */
export function monsterBody(kind: MonsterKind) {
  switch (kind) {
    case 'rat':
      return s('g', {},
        s('path', { d: 'M9 6 C16 8 17 14 11 15', stroke: '#9b8576', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }),
        s('ellipse', { cx: -1, cy: 3, rx: 11, ry: 7.5, fill: '#857262', stroke: COLORS.ink, 'stroke-width': 1.3 }),
        s('circle', { cx: -7, cy: -5, r: 4, fill: '#a99282', stroke: COLORS.ink, 'stroke-width': 1.2 }),
        s('circle', { cx: 0, cy: -5, r: 3.5, fill: '#a99282', stroke: COLORS.ink, 'stroke-width': 1.2 }),
        eye(-7, 1), s('circle', { cx: -12, cy: 4, r: 1.6, fill: COLORS.ink }));
    case 'goblin':
      return s('g', {},
        s('path', { d: 'M-8 -4 L-18 -10 L-10 2 Z M8 -4 L18 -10 L10 2 Z', fill: '#5f9a46', stroke: COLORS.ink, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }),
        s('path', { d: 'M-10 -2 C-10 -14 10 -14 10 -2 L8 10 C4 15 -4 15 -8 10 Z', fill: '#76b356', stroke: COLORS.ink, 'stroke-width': 1.3 }),
        s('circle', { cx: -4, cy: -2, r: 2.6, fill: '#f3e36b' }), s('circle', { cx: 4, cy: -2, r: 2.6, fill: '#f3e36b' }),
        eye(-4, -2, 1.2), eye(4, -2, 1.2),
        s('path', { d: 'M-5 7 L-3 5 L-1 7 L1 5 L3 7 L5 5', stroke: COLORS.ink, 'stroke-width': 1.2, fill: 'none' }));
    case 'slime':
      return s('g', {},
        s('path', { d: 'M-15 13 C-17 0 -9 -14 0 -14 C9 -14 17 0 15 13 C10 15 5 12 0 14 C-5 12 -10 15 -15 13 Z', fill: '#47c2ad', 'fill-opacity': 0.9, stroke: '#1f6e62', 'stroke-width': 1.5 }),
        s('ellipse', { cx: -6, cy: -7, rx: 3, ry: 2, fill: '#dff7f2' }),
        eye(-4, 2, 2.2), eye(5, 2, 2.2));
    case 'troll':
      return s('g', {},
        s('path', { d: 'M-17 12 C-19 -6 -12 -17 0 -17 C12 -17 19 -6 17 12 C10 17 -10 17 -17 12 Z', fill: '#7a8896', stroke: COLORS.ink, 'stroke-width': 1.5 }),
        s('path', { d: 'M-10 -6 L-2 -3 M10 -6 L2 -3', stroke: COLORS.ink, 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
        eye(-6, -1, 1.8), eye(6, -1, 1.8),
        s('path', { d: 'M-8 6 Q0 10 8 6', stroke: COLORS.ink, 'stroke-width': 1.6, fill: 'none' }),
        s('path', { d: 'M-7 7 L-8 1 L-4 6 Z M7 7 L8 1 L4 6 Z', fill: '#f4eee0', stroke: COLORS.ink, 'stroke-width': 1 }));
    case 'dragon':
      // Bronze, never red (red is for danger): folded wings behind a horned head with a long snout.
      return s('g', {},
        s('path', { d: 'M-8 -2 L-20 -14 L-17 -3 L-21 2 L-15 4 L-18 10 L-8 8 Z M8 -2 L20 -14 L17 -3 L21 2 L15 4 L18 10 L8 8 Z', fill: '#6f5a2a', stroke: COLORS.ink, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }),
        s('path', { d: 'M-6 -11 L-9 -19 L-2 -12 Z M6 -11 L9 -19 L2 -12 Z', fill: '#f4eee0', stroke: COLORS.ink, 'stroke-width': 1 }),
        s('path', { d: 'M-11 -2 C-11 -14 11 -14 11 -2 L7 12 C4 17 -4 17 -7 12 Z', fill: '#b08a3e', stroke: COLORS.ink, 'stroke-width': 1.5 }),
        s('path', { d: 'M-6 -4 L-2 -2 M6 -4 L2 -2', stroke: COLORS.ink, 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
        s('ellipse', { cx: -4.5, cy: 0, rx: 2.4, ry: 1.6, fill: '#f3e36b', stroke: COLORS.ink, 'stroke-width': 0.8 }),
        s('ellipse', { cx: 4.5, cy: 0, rx: 2.4, ry: 1.6, fill: '#f3e36b', stroke: COLORS.ink, 'stroke-width': 0.8 }),
        s('path', { d: 'M-1 0 V1.6 M1 0 V1.6', stroke: COLORS.ink, 'stroke-width': 1 }),
        eye(-2.5, 11, 1), eye(2.5, 11, 1),
        s('path', { d: 'M-5 5 L-3 7 L-1 5 L1 7 L3 5 L5 7', stroke: '#f4eee0', 'stroke-width': 1, fill: 'none' }));
  }
}

/** The wounded mark: a bandage strip across, with stitches. The model only knows healthy or wounded. */
export function bandage() {
  return s('g', { class: 'bandage', transform: 'rotate(-30)' },
    s('rect', { x: -13, y: -3.5, width: 26, height: 7, rx: 2, fill: '#f2ead6', stroke: COLORS.ink, 'stroke-width': 1.1 }),
    s('path', { d: 'M-6 -3.5 V3.5 M0 -3.5 V3.5 M6 -3.5 V3.5', stroke: '#b9ac90', 'stroke-width': 1 }));
}

/** The rich mark: a loot sack tied at the top. */
export function lootSack() {
  return s('g', { class: 'sack' },
    s('path', { d: 'M-4 -4 L4 -4 L2 -1 C8 1 8 9 0 9 C-8 9 -8 1 -2 -1 Z', fill: '#b07f45', stroke: COLORS.ink, 'stroke-width': 1.1, 'stroke-linejoin': 'round' }),
    s('text', { x: 0, y: 7, class: 'sack-mark' }, '$'));
}

/** Him: a horned helmet over a round face and a braided beard. */
export function barbarian() {
  return s('g', {},
    s('path', { d: 'M-8 6 L-9 16 L-4 12 L0 17 L4 12 L9 16 L8 6 Z', fill: '#b4692b', stroke: COLORS.ink, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }),
    s('circle', { cx: 0, cy: 2, r: 9, fill: '#e8c39e', stroke: COLORS.ink, 'stroke-width': 1.3 }),
    eye(-3.5, 2, 1.5), eye(3.5, 2, 1.5),
    s('path', { d: 'M-12 -4 Q-21 -10 -18 -21 Q-14 -11 -8 -9 Z M12 -4 Q21 -10 18 -21 Q14 -11 8 -9 Z', fill: '#f1e3c2', stroke: COLORS.ink, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }),
    s('path', { d: 'M-12 -2 A12 12 0 0 1 12 -2 Z', fill: '#a0a7b0', stroke: COLORS.ink, 'stroke-width': 1.3 }),
    s('rect', { x: -13, y: -3.5, width: 26, height: 4, rx: 2, fill: COLORS.coin, stroke: COLORS.ink, 'stroke-width': 1 }));
}

/** An event spot, for "Show events (for testing)": a dashed ring with a question mark. */
export function eventSpot() {
  return s('g', { class: 'event-spot' },
    s('circle', { r: 11, fill: '#efe6ff', 'fill-opacity': 0.75, stroke: '#6a4fb3', 'stroke-width': 1.8, 'stroke-dasharray': '3 2.5' }),
    s('text', { x: 0, y: 5, class: 'spot-mark' }, '?'));
}

/** A footprint, toes pointing up (rotate it for the way he walked). */
export function footprint() {
  return s('g', {},
    s('ellipse', { cx: 0, cy: 2, rx: 3.2, ry: 5 }),
    s('circle', { cx: -2.6, cy: -5, r: 1.3 }), s('circle', { cx: 0, cy: -6, r: 1.3 }), s('circle', { cx: 2.6, cy: -5, r: 1.3 }));
}

/** A true saga sentence's mark: a small rune stone. */
export function runeStone() {
  return s('g', {},
    s('path', { d: 'M-9 12 C-12 2 -9 -12 0 -13 C9 -12 12 2 9 12 Z', fill: '#9a948a', stroke: COLORS.ink, 'stroke-width': 1.5 }),
    s('path', { d: 'M-2 -7 V7 M-2 -6 L4 -1 M-2 0 L4 5', stroke: COLORS.ink, 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round' }));
}

/** A made-up saga sentence's mark: a grey dashed cloud. */
export function cloudMark() {
  return s('path', {
    d: 'M-12 8 C-17 8 -17 0 -11 -1 C-11 -8 -2 -10 1 -5 C4 -10 13 -8 12 -1 C18 0 17 8 12 8 Z',
    fill: '#eeece8', stroke: '#7a756e', 'stroke-width': 1.6, 'stroke-dasharray': '3 2.5',
  });
}

/** A small square SVG holding one symbol. */
export function icon(g: SVGElement, scale = 0.6, hatch = false): SVGSVGElement {
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
