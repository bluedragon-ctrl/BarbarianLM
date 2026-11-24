/**
 * The Inside the model tab, kept very light: what goes in (with the input counts for his memory), the one hidden
 * layer of 48, the 9 outputs and the number of parameters, then the raid on screen (Raid alone's): his next
 * action's chances, and the few inputs that pushed hardest toward the likeliest one (each left out in turn).
 */
import type { CardKey } from '../explain';
import { HIDDEN, N_OUT, decide, parameterCount, withoutEach } from '../model';
import type { Raid } from '../raid';
import { PAIR_SIZE, PINNED_SIZE, VIEW_CELLS, CELL_SIZE, VIEW_INPUTS, inputWords } from '../tokens';
import { h } from './dom';
import { ACTION_LABELS } from './raidPlay';
import { fillBars } from './raidAlone';
import type { Settings } from './settings';
import type { Trainer } from './trainer';

/** What the tab needs from the app. */
export interface InsideHost {
  readonly settings: Settings;
  readonly trainer: Trainer;
  /** The raid on the Raid alone tab (made if there is none yet). */
  raidOnScreen(): Raid;
  card(key: CardKey, place?: string): Node;
}

/** How many inputs to list as pushing toward the likeliest action, and as holding him back. */
const PUSHED = 5;
const HELD = 2;

const n = (v: number) => v.toLocaleString('en');

/** The active inputs that moved the chance of `target` most, each with the chance without it. */
export function pushes(raid: Raid, target: number, temperature: number): { input: number; without: number }[] {
  const active = raid.input();
  const without = withoutEach(raid.model, active, target, temperature);
  return active.map((input, k) => ({ input, without: without[k] }));
}

export function insidePanel(host: InsideHost): (HTMLElement | null)[] {
  const tr = host.trainer;
  const m = tr.model;
  const pairs = (m.nIn - PINNED_SIZE - VIEW_INPUTS) / PAIR_SIZE;
  const raid = host.raidOnScreen();
  const on = raid.state.ended ? null : raid.input().length;
  const row = (what: Node | string, count: string, note: string) =>
    h('tr', {}, h('th', {}, what), h('td', {}, count), h('td', { class: 'muted' }, note));
  return [
    h('h2', {}, 'Inside the model'),
    h('p', { class: 'caption' }, 'The plain numbers behind him: what he reads, what he gives back, and what pushed his next action.'),
    h('div', { class: 'group' },
      h('h3', {}, 'What goes in ', host.card('tokens', 'inside')),
      h('table', { class: 'inside-table' },
        h('tbody', {},
          row(h('span', {}, 'Pinned stats ', host.card('buckets', 'inside')), n(PINNED_SIZE), 'HP, max HP, attack, potions, torches, torch, gold, time, stairs: each in buckets'),
          row(`Memory: ${pairs} past view${pairs === 1 ? '' : 's'} and action${pairs === 1 ? '' : 's'}`, `${pairs} × ${n(PAIR_SIZE)} = ${n(pairs * PAIR_SIZE)}`,
            `each a slot-filled flag, a view (${n(VIEW_INPUTS)}) and the action (9)`),
          row('The view now', n(VIEW_INPUTS), `${VIEW_CELLS} cells × ${CELL_SIZE}: what is there, wounded, rich`),
          h('tr', { class: 'total' }, h('th', {}, 'Inputs in all'), h('td', {}, n(m.nIn)),
            h('td', { class: 'muted' }, `each 0 or 1${on ? `; ${on} are 1 now` : ''}`)))),
      h('p', { class: 'muted' }, 'A longer memory means more inputs, and more numbers to learn.')),
    h('div', { class: 'group' },
      h('h3', {}, 'The network'),
      h('div', { class: 'flow', 'aria-label': 'Inputs, then 48 hidden units, then 9 actions' },
        h('span', { class: 'flow-box' }, h('strong', {}, n(m.nIn)), h('small', {}, 'inputs')),
        h('span', { class: 'flow-arrow', 'aria-hidden': 'true' }, '→'),
        h('span', { class: 'flow-box' }, h('strong', {}, String(HIDDEN)), h('small', {}, 'hidden units')),
        h('span', { class: 'flow-arrow', 'aria-hidden': 'true' }, '→'),
        h('span', { class: 'flow-box' }, h('strong', {}, String(N_OUT)), h('small', {}, 'actions'))),
      h('p', {}, `One hidden layer of ${HIDDEN} units. Each input that is 1 adds its own row of ${HIDDEN} numbers; `,
        `${HIDDEN} × ${N_OUT} more numbers turn the result into a score per action, and the scores become chances.`),
      h('p', { class: 'compare' },
        `${n(m.nIn)} × ${HIDDEN} + ${HIDDEN} + ${HIDDEN} × ${N_OUT} + ${N_OUT} = ${n(parameterCount(m))} numbers he learns.`),
      h('p', { class: 'muted' }, tr.trained
        ? `Set by ${n(tr.stats.lessons)} lessons and ${n(tr.stats.practiceRaids)} practice raids so far. A big chatbot has billions of them.`
        : 'All random so far: he has had no lessons. A big chatbot has billions of them.')),
    nowGroup(host, raid),
  ];
}

/** The raid on screen: the next action's chances and what pushed the likeliest one. */
function nowGroup(host: InsideHost, raid: Raid): HTMLElement {
  const head = h('h3', {}, 'Right now');
  const where = `Raid ${raid.n} in ${raid.dungeon.code}, turn ${raid.state.turn}, at boldness ${host.settings.boldness.toFixed(1)} (from the Raid alone tab).`;
  if (raid.state.ended) {
    return h('div', { class: 'group' }, head, h('p', { class: 'muted' }, `Raid ${raid.n} in ${raid.dungeon.code} is over. Start a new raid on the Raid alone tab to look inside again.`));
  }
  raid.options.temperature = host.settings.boldness;
  raid.options.block = host.settings.block;
  const p = raid.peek()!;
  const probs = Array.from(p.probs);
  const top = probs.indexOf(Math.max(...probs));
  // The pushes are measured on his model's own chances (boldness 1): at low boldness they sit at 100% and hide them.
  const base = decide(raid.model, raid.input(), 1).probs[top];
  const all = pushes(raid, top, 1).map((x) => ({ ...x, by: Math.log(base) - Math.log(Math.max(x.without, 1e-12)) }));
  const toward = all.filter((x) => x.by > 1e-3).sort((a, b) => b.by - a.by).slice(0, PUSHED);
  const against = all.filter((x) => x.by < -1e-3).sort((a, b) => a.by - b.by).slice(0, HELD);
  const pairs = (raid.model.nIn - PINNED_SIZE - VIEW_INPUTS) / PAIR_SIZE;
  const item = (x: { input: number; without: number }) => h('li', {},
    h('span', {}, inputWords(x.input, pairs)),
    h('span', { class: 'muted' }, ` ${finePercent(base)} → ${finePercent(x.without)} without it`));
  const name = ACTION_LABELS[top].toLowerCase();
  return h('div', { class: 'group' },
    head,
    h('p', { class: 'muted' }, where),
    fillBars(h('div', { class: 'bars', role: 'list', 'aria-label': 'His next action' }), p),
    h('h3', {}, `What pushed him toward ${name}`),
    toward.length ? h('ol', { class: 'pushes' }, ...toward.map(item)) : h('p', { class: 'muted' }, 'No single input makes much difference.'),
    against.length ? h('p', { class: 'pushes-head' }, `What held him back from ${name}`) : null,
    against.length ? h('ol', { class: 'pushes' }, ...against.map(item)) : null,
    toward.length || against.length ? h('p', { class: 'muted' }, 'Each input is left out in turn and the chance worked out again, at boldness 1: his model\'s own chances, before the dial sharpens them.') : null);
}

/** A chance with a decimal near the ends, so a push from 99.6% to 97.1% still shows: "99.6%", "42%", "0.3%". */
export function finePercent(p: number): string {
  const v = p * 100;
  if (v >= 99.95) return '>99.9%';
  if (v < 0.05) return '<0.1%';
  return v >= 99 || v < 1 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
}
