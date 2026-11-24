/**
 * The Raid alone tab: his current model raids the dungeon on screen one sampled action at a time, on the main
 * thread through `Raid` (it is not training). Raid numbers count up per dungeon code; a replay plays the same
 * number again. His thoughts and the saga have their own streams (`storyStreams`, `sagaStream`), so they never
 * change what he does. The panel shows the next action's probabilities as bars, the boldness dial, the block
 * option, step / play / to the end, and the saga once the raid is over.
 */
import type { Dungeon } from '../dungeon';
import type { CardKey } from '../explain';
import { DATA } from '../events';
import { FloorMarks } from '../marks';
import { Raid, sagaStream, storyStreams, type RaidTurn } from '../raid';
import { sagaCount, singSaga, type SagaSentence } from '../saga';
import { hallScript, type HallEntry } from '../storage';
import { Thoughts } from '../thoughts';
import { TEACHER_LABELS, type TeacherName } from '../teachers';
import { RULES } from '../world';
import { clear, h, s } from './dom';
import { ACTION_LABELS, ACTION_MARKS, BOLDNESS, SPEEDS, nextRaidNumber, percent, readMs, type Speed } from './raidPlay';
import type { Settings } from './settings';
import { T, cloudMark, runeStone } from './symbols';
import type { Trainer } from './trainer';

/** What the tab needs from the app. */
export interface RaidHost {
  readonly dungeon: Dungeon;
  readonly settings: Settings;
  readonly trainer: Trainer;
  /** Change settings without redrawing the panel (the dial is being dragged). */
  setQuietly(patch: Partial<Settings>): void;
  /** Draw a turn just taken (null: the raid was restarted or played to the end). */
  showTurn(turn: RaidTurn | null, fx: boolean): void;
  /** Redraw the panel. */
  renderPanel(): void;
  /** An "AI" badge. */
  card(key: CardKey, place?: string): Node;
  /** The hall of fame, best first. */
  readonly hall: readonly HallEntry[];
  /** A raid alone just ended: into the hall of fame if it is good enough; its place (1 = best) or null. */
  raidEnded(raid: Raid): number | null;
  /** Play a hall of fame raid back (in its dungeon). */
  replayEntry(e: HallEntry): void;
  /** Forget the hall of fame. */
  clearHall(): void;
}

export class RaidAlone {
  raid: Raid | null = null;
  marks: FloorMarks | null = null;
  /** The thought shown now (null: none). */
  thought: string[] | null = null;
  saga: SagaSentence[] | null = null;
  telling = 0;
  speed: Speed = 'normal';
  /** The hall of fame raid being played back, or null for his own raid. */
  replay: HallEntry | null = null;
  /** Where the raid just ended got into the hall of fame (1 = best), or null. */
  private place: number | null = null;
  private thoughts: Thoughts | null = null;
  private timer = 0;
  private readonly numbers = new Map<string, number>();
  /** What the raid at turn 0 was made with, so it is made again if the model or the events change first. */
  private madeWith = '';
  /** The live parts, updated every turn without redrawing the panel (so the dial can be dragged meanwhile). */
  private readonly barsEl = h('div', { class: 'bars', role: 'list', 'aria-label': 'His next action' });
  private readonly lineEl = h('p', { class: 'turn-line', 'aria-live': 'polite' });
  private readonly turnEl = h('span', { class: 'muted' });

  constructor(private readonly host: RaidHost) {}

  get playing(): boolean { return this.timer !== 0; }

  private recipe(): string {
    const st = this.host.settings;
    return `${this.host.dungeon.code}|${st.events}|${st.newSpots}`;
  }

  /** The raid on screen: made when first needed, and made again while it has not started if anything changed. */
  ensure(): Raid {
    const r = this.raid;
    const model = this.host.trainer.model;
    if (r && this.replay && r.dungeon === this.host.dungeon) return r;
    if (r && r.dungeon === this.host.dungeon && (r.turns.length > 0 || (r.model === model && this.madeWith === this.recipe()))) return r;
    return this.start(r && r.dungeon === this.host.dungeon && r.turns.length === 0 ? r.n : undefined);
  }

  /** A new raid: the next number for this dungeon, or raid `n` again (a replay). */
  start(n?: number): Raid {
    this.pause();
    const d = this.host.dungeon;
    const st = this.host.settings;
    const num = n ?? nextRaidNumber(this.numbers, d.code);
    this.replay = null;
    return this.begin(new Raid(this.host.trainer.model, d, num, {
      temperature: st.boldness, block: st.block, events: st.events ? { newSpots: st.newSpots } : false,
    }));
  }

  /**
   * Play a hall of fame raid back in the dungeon on screen (the app puts its dungeon there first): its own actions
   * and chances, turn by turn, through the same streams, so it happens again exactly as it did.
   */
  playBack(e: HallEntry): Raid {
    this.pause();
    const raid = new Raid(null, this.host.dungeon, e.n, {
      block: e.block, events: e.events ? { newSpots: e.newSpots } : false, script: hallScript(e),
    });
    this.replay = e;
    return this.begin(raid);
  }

  private begin(raid: Raid): Raid {
    const d = raid.dungeon;
    const num = raid.n;
    this.raid = raid;
    this.place = null;
    this.madeWith = this.recipe();
    this.marks = new FloorMarks(raid.state.pos);
    this.thoughts = new Thoughts(storyStreams(d.code, num).thoughts, DATA.thoughts, raid.events?.setup.cast);
    this.thought = null;
    this.saga = null;
    this.telling = 0;
    this.lineEl.textContent = '';
    return raid;
  }

  /** Forget the raid (a new dungeon on screen); the raid numbers of each code are kept. */
  forget(): void {
    this.pause();
    this.raid = null;
    this.replay = null;
    this.marks = null;
    this.saga = null;
  }

  /** One turn: the action drawn, the dungeon's answer, his thought, and the saga if it was the last. */
  private turn(): RaidTurn | null {
    const r = this.ensure();
    if (r.state.ended) return null;
    const st = this.host.settings;
    if (!this.replay) {
      r.options.temperature = st.boldness;
      r.options.block = st.block;
    }
    const t = r.next();
    if (!t) return null;
    this.marks!.after(t.result, r.state.pos, r.state.turn);
    this.thought = this.thoughts!.after(t);
    if (r.state.ended) {
      this.pause();
      this.sing(0);
      if (!this.replay) this.place = this.host.raidEnded(r);
    }
    return t;
  }

  step(): void {
    const t = this.turn();
    if (t) this.after(t, true);
  }

  play(): void {
    if (this.playing) return;
    if (this.ensure().state.ended) return;
    const tick = () => {
      const t = this.turn();
      if (!t) { this.timer = 0; this.host.renderPanel(); return; }
      this.after(t, true);
      if (this.raid?.state.ended) return;
      const sp = SPEEDS.find((x) => x.id === this.speed)!;
      const say = this.thought && this.host.settings.thoughts;
      this.timer = window.setTimeout(tick, say ? Math.max(sp.ms, readMs(this.thought!) * sp.read) : sp.ms);
    };
    this.timer = window.setTimeout(tick, 0);
    this.host.renderPanel();
  }

  pause(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = 0;
    this.host.renderPanel();
  }

  /** The rest of the raid at once: no effects, and only the last thought. */
  toEnd(): void {
    this.pause();
    let last: RaidTurn | null = null;
    for (let t = this.turn(); t; t = this.turn()) last = t;
    if (last) this.after(last, false);
  }

  /** Sing the saga again: the same raid at the boldness set now, with the next telling's stream. */
  singAgain(): void {
    this.sing(this.telling + 1);
    this.host.renderPanel();
  }

  private sing(telling: number): void {
    const r = this.raid!;
    this.telling = telling;
    // A replay's first telling is at the boldness it was first sung at, so it is the same saga.
    const boldness = telling === 0 && this.replay ? this.replay.boldness : this.host.settings.boldness;
    this.saga = singSaga(r.record(), boldness, sagaStream(r.dungeon.code, r.n, telling));
  }

  private after(t: RaidTurn, fx: boolean): void {
    const r = this.raid!;
    const did = t.result.did === 'nothing' ? ' Nothing happened.' : '';
    this.lineEl.textContent = `Turn ${r.state.turn}: he took ${ACTION_LABELS[t.action].toLowerCase()}, drawn at ${percent(t.sample[t.action])}.${did}`;
    this.host.showTurn(t, fx);
    this.renderTurn();
    if (r.state.ended) this.host.renderPanel();
    else this.renderBars();
  }

  /** The next action's probabilities, unmasked; blocked ones struck through when the block option is on. */
  renderBars(): void {
    const r = this.ensure();
    if (!this.replay) {
      r.options.temperature = this.host.settings.boldness;
      r.options.block = this.host.settings.block;
    }
    fillBars(this.barsEl, r.peek());
  }

  private renderTurn(): void {
    const r = this.raid;
    if (r) this.turnEl.textContent = ` in ${r.dungeon.code} · turn ${r.state.turn} of ${RULES.timeLimit}`;
  }

  /** The panel. */
  panel(): (HTMLElement | null)[] {
    const r = this.ensure();
    const host = this.host;
    const st = host.settings;
    const tr = host.trainer;
    const ended = !!r.state.ended;
    const trained = tr.stats.lessons + tr.stats.practiceRaids;
    const rep = this.replay;
    const dial = h('input', {
      type: 'range', min: BOLDNESS.min, max: BOLDNESS.max, step: BOLDNESS.step, value: String(st.boldness), 'aria-label': 'Boldness', disabled: !!rep && !ended,
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        host.setQuietly({ boldness: v });
        value.textContent = v.toFixed(1);
        if (!ended) this.renderBars();
      },
    });
    const again = rep
      ? h('button', { class: 'subtle', onclick: () => { this.playBack(rep); host.showTurn(null, false); host.renderPanel(); }, title: 'Play the same raid back again from the start' }, 'Play it back again')
      : h('button', { class: 'subtle', onclick: () => { this.start(r.n); host.showTurn(null, false); host.renderPanel(); }, title: 'The same raid number again: the same raid, unless his model or the boldness changed' }, `Replay raid ${r.n}`);
    const value = h('strong', { class: 'dial-value' }, st.boldness.toFixed(1));
    const speedRadios = h('div', { class: 'row', role: 'radiogroup', 'aria-label': 'Speed' }, ...SPEEDS.map((sp) =>
      h('label', { class: 'radio' },
        h('input', { type: 'radio', name: 'speed', checked: this.speed === sp.id, onchange: () => { this.speed = sp.id; } }),
        sp.label)));
    if (!ended) this.renderBars();
    this.renderTurn();
    return [
      h('h2', {}, 'Raid alone ', host.card('agentLoop', 'raid')),
      h('p', { class: 'caption' }, 'He raids on his own. Each turn his model gives every action a chance, and one is drawn at random, the way a language model picks its next word.'),
      h('div', { class: 'group' },
        h('div', { class: 'row spaced' },
          h('span', {}, h('strong', {}, rep ? `Hall of fame: raid ${r.n}` : `Raid ${r.n}`), this.turnEl),
          h('span', { class: 'row' },
            again,
            h('button', { onclick: () => { this.start(); host.showTurn(null, false); host.renderPanel(); } }, 'New raid'))),
        rep ? h('p', { class: 'muted' }, `Played back as it happened on ${shortDate(rep.date)}: his actions and the chances he had then, from ${trainedWords(rep)}. His model now plays no part.`)
          : trained ? h('p', { class: 'muted' }, `His model after ${trained.toLocaleString('en')} lessons and practice raids.`)
            : h('p', { class: 'muted' }, 'He has had no lessons yet: his model is random, so his actions are random guesses.'),
        tr.busy && !rep ? h('p', { class: 'muted' }, 'He is training meanwhile; a new raid uses his model as it is then.') : null),
      h('div', { class: 'group' },
        h('div', { class: 'row' },
          h('button', { class: 'primary', disabled: ended || this.playing, onclick: () => this.step() }, 'Next turn'),
          this.playing
            ? h('button', { onclick: () => this.pause() }, 'Pause')
            : h('button', { disabled: ended, onclick: () => this.play() }, 'Play'),
          h('button', { class: 'subtle', disabled: ended, onclick: () => this.toEnd() }, 'To the end')),
        speedRadios),
      h('div', { class: 'group' },
        h('label', { class: 'dial' }, h('span', {}, 'Boldness ', value),
          h('span', { class: 'dial-row' }, h('small', { class: 'muted' }, 'careful'), dial, h('small', { class: 'muted' }, 'bold'))),
        h('p', { class: 'muted' }, rep && !ended ? `A replay keeps the boldness it had (${rep.boldness.toFixed(1)} at the end).` : 'Low boldness: he nearly always takes his likeliest action. High: the chances even out and he takes more long shots.'),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: rep ? rep.block : st.block, disabled: !!rep, onchange: (e: Event) => { host.setQuietly({ block: (e.target as HTMLInputElement).checked }); if (!ended) this.renderBars(); } }),
          h('span', {}, 'Block impossible actions', h('small', { class: 'muted' }, ' Struck through, never drawn.')))),
      ended ? this.endBox() : h('div', { class: 'group' },
        h('h3', {}, 'His next action ', host.card('probabilities', 'raid')),
        this.barsEl,
        this.lineEl),
      this.hallBox(),
    ];
  }

  /** The hall of fame: the best raids alone in this browser, each with a button to play it back. */
  private hallBox(): HTMLElement {
    const host = this.host;
    const hall = host.hall;
    const today = new Date().toISOString().slice(0, 10);
    return h('details', { class: 'group hall', open: hall.length > 0 },
      h('summary', {}, 'Hall of fame'),
      hall.length ? h('table', { class: 'hall-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Gold'), h('th', {}, 'Dungeon'), h('th', {}, 'Raid'), h('th', {}, 'Teacher'), h('th', {}, ''))),
        h('tbody', {}, ...hall.map((e, i) => h('tr', {
          class: this.replay === e ? 'playing' : '',
          title: `Raid ${e.n} in ${e.code}, ${e.turns} turns, boldness ${e.boldness.toFixed(1)}${e.block ? ', impossible actions blocked' : ''}${e.events ? '' : ', no events'}, ${shortDate(e.date)}`,
        },
        h('td', {}, String(i + 1)),
        h('td', {}, h('strong', {}, String(e.gold))),
        h('td', {}, h('span', { class: 'code' }, e.code), e.day ? h('span', { class: 'day-mark', title: e.date.slice(0, 10) === today ? 'Today\'s dungeon of the day' : `The dungeon of the day on ${e.date.slice(0, 10)}` }, ' ☀') : null),
        h('td', {}, String(e.n)),
        h('td', {}, teacherLabel(e.teacher) ?? '–'),
        h('td', {}, h('button', { class: 'subtle', onclick: () => host.replayEntry(e) }, 'Replay')))))) : null,
      h('p', { class: 'muted' }, hall.length
        ? 'His best raids alone in this browser. A replay plays the very same raid again, even after his model has changed.'
        : 'His best raids alone will be kept here: the ones he gets out of with gold.'),
      hall.length ? h('button', { class: 'subtle', onclick: () => { if (confirm('Forget the hall of fame?')) host.clearHall(); } }, 'Clear the hall of fame') : null);
  }

  private endBox(): HTMLElement {
    const st = this.raid!.state;
    const text = st.ended === 'left'
      ? (st.gold > 0 ? `Out with ${st.gold} gold after ${st.turn} turns!` : `Out after ${st.turn} turns, with empty pockets.`)
      : st.ended === 'knockedOut' ? `Knocked out after ${st.turn} turns. The keeper carries him out; the gold stays behind.`
        : 'The gate closed at sundown. Locked in till morning; the keeper keeps the gold.';
    const saga = this.saga ?? [];
    return h('div', { class: 'group' },
      h('p', { class: `end ${st.ended === 'left' && st.gold > 0 ? 'good' : 'bad'}` }, text, ' ', this.host.card('leave', 'end')),
      this.place ? h('p', { class: 'hall-news' }, `Into the hall of fame, place ${this.place}!`) : null,
      this.replay && (this.replay.gold !== st.gold || this.replay.turns !== st.turn || st.ended !== 'left')
        ? h('p', { class: 'muted' }, `It came out differently from the first time (${this.replay.gold} gold in ${this.replay.turns} turns): the game's rules have changed since.`) : null,
      h('div', { class: 'saga' },
        h('h3', {}, 'The skald\'s saga ', this.host.card('saga', 'end')),
        h('ol', {}, ...saga.map((x) => h('li', { class: x.madeUp ? 'made-up' : '' },
          mark(x.madeUp), h('span', {}, x.text)))),
        h('p', { class: 'saga-count' }, `${sagaCount(saga)}${this.telling ? ` · telling ${this.telling + 1}` : ''}`),
        h('div', { class: 'row' },
          h('button', { onclick: () => this.singAgain(), title: 'The same raid, told again at the boldness set now' }, 'Sing it again'),
          h('span', { class: 'muted' }, `at boldness ${this.host.settings.boldness.toFixed(1)}`)),
        h('p', { class: 'muted' }, 'A rune stone marks what really happened; a cloud, what the skald made up. The bolder the skald, the more he makes up.')));
  }
}

/** "24 Nov 2026" from an ISO time. */
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const teacherLabel = (t: string | null): string | null => (t && t in TEACHER_LABELS ? TEACHER_LABELS[t as TeacherName] : null);

const trainedWords = (e: HallEntry) => e.trained
  ? `his model after ${e.trained.toLocaleString('en')} lessons and practice raids${teacherLabel(e.teacher) ? ` (mostly from the ${teacherLabel(e.teacher)!.toLowerCase()})` : ''}`
  : 'his untrained model';

const mark = (madeUp: boolean) => {
  const el = s('svg', { class: 'saga-mark', width: 20, height: 20, viewBox: `${-T / 2} ${-T / 2} ${T} ${T}`, 'aria-label': madeUp ? 'made up' : 'true', role: 'img' });
  el.append(s('g', { transform: 'scale(1.3)' }, madeUp ? cloudMark() : runeStone()));
  return el;
};

/** The action bars for one turn's probabilities (unmasked); blocked actions struck through. Empty once ended. */
export function fillBars(el: HTMLElement, p: { probs: ArrayLike<number>; allowed?: readonly boolean[] } | null): HTMLElement {
  clear(el);
  if (!p) return el;
  const top = Math.max(...Array.from(p.probs));
  ACTION_LABELS.forEach((label, a) => {
    const blocked = p.allowed ? !p.allowed[a] : false;
    const v = p.probs[a];
    el.append(h('div', {
      class: `bar-row ${blocked ? 'blocked' : ''} ${v === top ? 'likeliest' : ''}`, role: 'listitem',
      title: blocked ? `${label}: ${percent(v)}, blocked: it would do nothing here, so it is never drawn` : `${label}: ${percent(v)}`,
    },
    h('span', { class: `bar-mark ${a <= 3 ? 'move' : ''}` }, ACTION_MARKS[a]),
    h('span', { class: 'bar-name' }, label),
    h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width: ${(v * 100).toFixed(1)}%` })),
    h('span', { class: 'bar-pct' }, percent(v))));
  });
  return el;
}
