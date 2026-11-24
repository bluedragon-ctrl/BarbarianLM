/**
 * The memory strip under the board on a raid alone: his context window as the model reads it. The pinned tokens
 * (his stats in buckets and the stairs compass) at the front, then his remembered views, each followed by the
 * action he took on it, oldest first, then the view now and "?" for the action to come. Empty slots at the start
 * of a raid show as empty, as the model gets them (all zero).
 */
import type { CardKey } from '../explain';
import type { RaidTurn } from '../raid';
import { DARK, MONSTER_VIEW_KIND, VIEW_SIZE, type ViewCell } from '../sight';
import { MONSTER_KINDS, SHOWN } from '../tiles';
import { pinnedWords } from '../tokens';
import { ACTION_NAMES, view, type RaidState } from '../world';
import { clear, h, s } from './dom';
import { ACTION_MARKS } from './raidPlay';
import { COLORS, T, bandage, itemSymbol, lootSack, monsterBody, tileSymbol } from './symbols';

/** One remembered or current view as a small 5 × 5 picture, his own cell framed in the middle. */
export function miniView(cells: readonly ViewCell[]): SVGSVGElement {
  const n = VIEW_SIZE;
  const el = s('svg', { class: 'mini-view', viewBox: `0 0 ${n * T} ${n * T}`, 'aria-hidden': 'true' });
  cells.forEach((c, k) => {
    const g = s('g', { transform: `translate(${(k % n) * T + T / 2} ${Math.floor(k / n) * T + T / 2})` });
    if (c.kind === DARK) {
      g.append(
        s('rect', { x: -T / 2, y: -T / 2, width: T, height: T, fill: '#15120e' }),
        s('path', { d: 'M-20 0 L0 -20 M-20 20 L20 -20 M0 20 L20 0', stroke: '#3a332a', 'stroke-width': 4 }));
    } else {
      const monster = MONSTER_KINDS.find((m) => MONSTER_VIEW_KIND(m) === c.kind);
      if (monster) {
        g.append(tileSymbol(SHOWN.floor), s('g', { transform: 'scale(0.9)' }, monsterBody(monster), c.wounded ? bandage() : null));
        if (c.rich) g.append(s('g', { transform: 'translate(-12 -11) scale(0.8)' }, lootSack()));
      } else {
        g.append(tileSymbol(c.kind));
        const item = itemSymbol(c.kind);
        if (item) g.append(item);
      }
    }
    el.append(g);
  });
  const mid = (n >> 1) * T;
  el.append(s('rect', { x: mid + 2, y: mid + 2, width: T - 4, height: T - 4, rx: 5, fill: 'none', stroke: COLORS.coin, 'stroke-width': 4 }));
  return el;
}

const actionToken = (a: number, title: string) =>
  h('span', { class: `act-tok ${a <= 3 ? 'move' : ''}`, title }, ACTION_MARKS[a]);

/**
 * Draw the strip for a raid of `memory` remembered pairs: `turns` so far and the state now. With no turns yet
 * every slot is empty.
 */
export function renderStrip(
  el: HTMLElement, state: RaidState, turns: readonly RaidTurn[], memory: number, card?: (key: CardKey) => Node,
): void {
  clear(el);
  el.setAttribute('aria-label', 'His memory');
  const what = `What the model reads: his stats, pinned (they never scroll out), his last ${memory === 1 ? 'view and action' : `${memory} views and actions`}, and the view now.`;
  const pinned = h('div', { class: 'strip-pinned', title: what },
    h('strong', { class: 'strip-label' }, 'His memory'),
    card?.('tokens'),
    h('span', { class: 'pin' }, 'pinned'),
    card?.('pinned'),
    ...pinnedWords(state).map((w) => h('span', { class: 'chip' }, w)));
  const row = h('div', { class: 'strip-row' });
  const first = Math.max(0, turns.length - memory);
  if (first > 0) row.append(h('span', { class: 'strip-more', title: `${first} older turns he has forgotten` }, '…'));
  for (let k = 0; k < memory - (turns.length - first); k++) {
    row.append(h('span', { class: 'strip-pair empty', title: 'An empty memory slot: nothing here yet' },
      h('span', { class: 'mini-empty' }, 'empty'), h('span', { class: 'act-tok blank' }, '·')));
  }
  for (let k = first; k < turns.length; k++) {
    const t = turns[k];
    const ago = turns.length - k;
    row.append(h('span', { class: 'strip-pair', title: `${ago} turn${ago === 1 ? '' : 's'} ago` },
      miniView(t.view), actionToken(t.action, `then: ${ACTION_NAMES[t.action]}`)));
  }
  if (!state.ended) {
    row.append(h('span', { class: 'strip-pair now', title: 'What he sees now' },
      miniView(view(state)), h('span', { class: 'arrow-next' }, '→'), h('span', { class: 'act-tok next' }, '?')));
  } else {
    row.append(h('span', { class: 'strip-end' }, 'The raid is over.'));
  }
  el.append(pinned, row);
  requestAnimationFrame(() => { row.scrollLeft = row.scrollWidth; });
}
