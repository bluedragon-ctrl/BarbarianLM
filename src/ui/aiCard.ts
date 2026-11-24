/**
 * The small "AI" badges and the card each opens as a popover (modelled on Karkulka's `hint.ts`): click or Enter
 * opens it next to the badge, Esc or a click elsewhere closes it. A badge can pulse (`fresh`) the first time its
 * card is relevant; the app decides when.
 */
import { CARDS, type CardKey } from '../explain';
import { h } from './dom';

let pop: HTMLDivElement | null = null;
let owner: HTMLButtonElement | null = null;
/** Which badge the open card belongs to, so it can follow the badge when a panel is redrawn. */
let openId: string | null = null;

function ensurePop(): HTMLDivElement {
  if (pop) return pop;
  pop = h('div', { class: 'ai-pop', id: 'ai-pop', role: 'dialog', 'aria-labelledby': 'ai-pop-head', tabindex: -1, hidden: true });
  document.body.append(pop);
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (openId && !pop!.contains(t) && !(t instanceof Element && t.closest('.ai-badge'))) closeCard();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openId) { const b = owner; closeCard(); b?.focus(); }
  });
  window.addEventListener('resize', placeCard);
  document.addEventListener('scroll', placeCard, true);
  return pop;
}

/** Put the card under its badge (above when there is no room), inside the window; close it if the badge is gone. */
export function placeCard(): void {
  if (!pop || !openId) return;
  if (!owner?.isConnected) {
    owner = document.querySelector<HTMLButtonElement>(`.ai-badge[data-card-id="${openId}"]`);
    if (!owner) { closeCard(); return; }
    owner.setAttribute('aria-expanded', 'true');
  }
  const r = owner.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) { closeCard(); return; }
  const gap = 8;
  const w = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const left = Math.max(gap, Math.min(window.innerWidth - w - gap, r.left + r.width / 2 - w / 2));
  const below = r.bottom + gap + ph <= window.innerHeight || r.top - gap - ph < 0;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + gap : r.top - gap - ph}px`;
  pop.classList.toggle('above', !below);
  pop.style.setProperty('--arrow-x', `${Math.max(14, Math.min(w - 14, r.left + r.width / 2 - left))}px`);
}

export function closeCard(): void {
  if (!pop) return;
  pop.hidden = true;
  owner?.setAttribute('aria-expanded', 'false');
  owner = null;
  openId = null;
}

function openCard(btn: HTMLButtonElement, key: CardKey, id: string, byKeyboard: boolean): void {
  const p = ensurePop();
  owner?.setAttribute('aria-expanded', 'false');
  owner = btn;
  openId = id;
  const card = CARDS[key];
  p.replaceChildren(
    h('div', { class: 'ai-pop-head' },
      h('span', { class: 'ai-tag' }, 'AI idea'),
      h('strong', { id: 'ai-pop-head' }, card.title),
      h('button', { class: 'ai-close', 'aria-label': 'Close', onclick: () => { const b = owner; closeCard(); b?.focus(); } }, '×')),
    h('p', {}, card.text));
  p.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  placeCard();
  if (byKeyboard) p.focus();
}

export interface BadgeOptions {
  /** Pulse: this is the first time the card is relevant. */
  fresh?: boolean;
  /** Tells badges with the same card apart, so an open card follows the right one after a redraw. */
  place?: string;
  /** Called when the card is opened. */
  onOpen?: (key: CardKey) => void;
}

/** A small "AI" badge that opens the card for `key`. */
export function aiBadge(key: CardKey, opts: BadgeOptions = {}): HTMLButtonElement {
  const id = opts.place ? `${key}-${opts.place}` : key;
  const label = `AI idea: ${CARDS[key].title}`;
  const btn = h('button', {
    type: 'button', class: `ai-badge ${opts.fresh ? 'fresh' : ''}`, 'data-card': key, 'data-card-id': id,
    'aria-label': label, title: label, 'aria-haspopup': 'dialog', 'aria-controls': 'ai-pop', 'aria-expanded': String(openId === id),
    onclick: (e: MouseEvent) => {
      // Inside a <label>, a click must not also pick the radio button.
      e.preventDefault();
      e.stopPropagation();
      if (openId === id && owner === btn) { closeCard(); return; }
      openCard(btn, key, id, e.detail === 0);
      opts.onOpen?.(key);
    },
  }, 'AI');
  // A redraw replaced the badge of the open card: follow the new one.
  if (openId === id) requestAnimationFrame(placeCard);
  return btn;
}
