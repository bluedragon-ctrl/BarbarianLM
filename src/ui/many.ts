/**
 * The Many raids tab: his model raids 100 or 1,000 times in the worker (the `raids` job), in the dungeon on screen
 * (raids 0, 1, 2… of it) or each in a new dungeon (fixed codes, so runs compare), with the Raid alone boldness and
 * block option and the event settings. His main teacher plays the same raids, so his numbers sit next to the
 * teacher's: how the raids ended as bars, then the averages in a small table, gold out always beside the share
 * that left with gold. The teacher's numbers are fixed per place and count (teachers have no randomness), so they
 * are measured once and kept.
 */
import type { CardKey } from '../explain';
import type { Model } from '../model';
import { codesFrom, summary, type RaidCounts, type RaidPlan, type RaidSummary } from '../raids';
import { TEACHER_LABELS, type TeacherName } from '../teachers';
import { runInWorker } from '../workerClient';
import { ENDS, ensurePatterns } from './charts';
import { h, s } from './dom';
import type { Settings } from './settings';
import type { Trainer } from './trainer';
import type { Dungeon } from '../dungeon';

export const MANY_COUNTS = [100, 1000] as const;
export type ManyWhere = 'shown' | 'new';
/** The seed of the new dungeons' codes: the same codes every run, so runs (and the teacher) compare fairly. */
export const MANY_SEED = 'many';

/** The raids to play: raids 0… of the dungeon on screen, or raid 0 of `count` fixed new dungeons. */
export const manyPlan = (where: ManyWhere, code: string, count: number): RaidPlan =>
  where === 'shown' ? { code, count } : { codes: codesFrom(MANY_SEED, count) };

/** Where a run's raids were, as the teacher's numbers are kept by it. */
export const manyPlace = (where: ManyWhere, code: string, count: number): string =>
  `${where === 'shown' ? code : 'new'}|${count}`;

/** What the tab needs from the app. */
export interface ManyHost {
  readonly dungeon: Dungeon;
  readonly settings: Settings;
  readonly trainer: Trainer;
  /** The teacher picked on the Lessons tab: the one to compare with before any lessons. */
  readonly teacher: TeacherName;
  /** An "AI" badge. */
  card(key: CardKey, place?: string): Node;
  /** Something changed: redraw the panel if it is showing. */
  manyChanged(): void;
}

/** One run of many raids, running or done. */
export interface ManyRun {
  where: ManyWhere;
  code: string;
  count: number;
  teacher: TeacherName;
  boldness: number;
  block: boolean;
  events: boolean;
  /** His model and how much he had trained when the run started. */
  model: Model;
  trained: number;
  counts: RaidCounts | null;
  teacherCounts: RaidCounts | null;
  done: number;
  running: boolean;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

export class ManyRaids {
  count: number = MANY_COUNTS[0];
  where: ManyWhere = 'shown';
  run: ManyRun | null = null;
  private cancel: (() => void) | null = null;
  private readonly teacherKept = new Map<string, RaidCounts>();

  constructor(private readonly host: ManyHost) {}

  get busy(): boolean { return !!this.run?.running; }

  /** The teacher to compare with: the one he had most lessons from, else the one picked on Lessons. */
  teacher(): TeacherName { return this.host.trainer.mainTeacher() ?? this.host.teacher; }

  start(): void {
    if (this.busy) return;
    const { dungeon, settings: st, trainer } = this.host;
    const teacher = this.teacher();
    const key = `${teacher}|${manyPlace(this.where, dungeon.code, this.count)}`;
    const kept = this.teacherKept.get(key) ?? null;
    const run: ManyRun = {
      where: this.where, code: dungeon.code, count: this.count, teacher, boldness: st.boldness, block: st.block, events: st.events,
      model: trainer.model, trained: trainer.stats.lessons + trainer.stats.practiceRaids,
      counts: null, teacherCounts: kept, done: 0, running: true,
    };
    this.run = run;
    const job = runInWorker({
      kind: 'raids', model: trainer.model, plan: manyPlan(this.where, dungeon.code, this.count),
      temperature: st.boldness, block: st.block, events: st.events ? { newSpots: st.newSpots } : false,
      teacher: kept ? undefined : teacher,
    }, (p) => {
      if (this.run !== run || !p.counts) return;
      run.done = p.done;
      run.counts = p.counts;
      if (p.teacherCounts) run.teacherCounts = p.teacherCounts;
      this.host.manyChanged();
    });
    this.cancel = job.cancel;
    job.result.then((r) => {
      if (this.run !== run || !('counts' in r)) return;
      run.counts = r.counts;
      if (r.teacherCounts) {
        run.teacherCounts = r.teacherCounts;
        this.teacherKept.set(key, r.teacherCounts);
      }
      run.done = run.count;
      run.running = false;
      this.cancel = null;
      this.host.manyChanged();
    }).catch(() => {
      if (this.run === run) { run.running = false; this.cancel = null; }
      this.host.manyChanged();
    });
    this.host.manyChanged();
  }

  /** Stop: the run so far is thrown away. */
  stop(): void {
    this.cancel?.();
    this.cancel = null;
    this.run = null;
    this.host.manyChanged();
  }

  panel(): (HTMLElement | null)[] {
    const host = this.host;
    const st = host.settings;
    const busy = this.busy;
    const radios = <T extends string | number>(name: string, options: readonly [T, string][], value: T, pick: (v: T) => void) =>
      h('div', { class: 'row', role: 'radiogroup', 'aria-label': name }, ...options.map(([v, label]) =>
        h('label', { class: 'radio' },
          h('input', { type: 'radio', name, checked: value === v, disabled: busy, onchange: () => { pick(v); host.manyChanged(); } }),
          label)));
    const run = this.run;
    const teacher = this.teacher();
    return [
      h('h2', {}, 'Many raids ', host.card('probabilities', 'many')),
      h('p', { class: 'caption' }, 'One raid is a gamble: every action is drawn by chance. So he raids many times on his own and we count what happened.'),
      h('div', { class: 'group' },
        h('h3', {}, 'How many, and where?'),
        radios('manyCount', MANY_COUNTS.map((n) => [n, n.toLocaleString('en')] as [number, string]), this.count, (n) => { this.count = n; }),
        radios('manyWhere', [['shown', `In ${host.dungeon.code}, the dungeon on screen`], ['new', 'A new dungeon every raid']] as [ManyWhere, string][], this.where, (w) => { this.where = w; }),
        h('p', { class: 'muted' },
          `Boldness ${st.boldness.toFixed(1)}, impossible actions ${st.block ? 'blocked' : 'not blocked'} (set on Raid alone); events ${st.events ? 'on' : 'off'} (in Settings). `,
          `${TEACHER_LABELS[teacher]} plays the same raids${st.events ? ', without events' : ''}.`),
        busy && run
          ? h('div', { class: 'job' },
            h('div', { class: 'row' },
              h('progress', { max: run.count, value: run.done, 'aria-label': 'Raids' }),
              h('span', { class: 'muted' }, `${run.done.toLocaleString('en')} of ${run.count.toLocaleString('en')} raids`),
              h('button', { onclick: () => this.stop() }, 'Stop')))
          : h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => this.start() }, `Raid ${plural(this.count, 'time')}`))),
      run?.counts ? this.results(run) : h('p', { class: 'muted' }, 'No raids counted yet.'),
    ];
  }

  private results(run: ManyRun): HTMLElement {
    const his = summary(run.counts!);
    const t = run.teacherCounts ? summary(run.teacherCounts) : null;
    const tName = TEACHER_LABELS[run.teacher];
    const where = run.where === 'shown' ? `in ${run.code}` : 'each in a new dungeon';
    const trainedNow = this.host.trainer.stats.lessons + this.host.trainer.stats.practiceRaids;
    const stale = run.model !== this.host.trainer.model && !run.running;
    return h('div', { class: 'group many-results' },
      h('h3', {}, `${run.running ? 'So far' : 'After'}: ${plural(his.raids, 'raid')} ${where}`),
      h('p', { class: 'compare' },
        `He carried out ${num(his.goldOut)} gold a raid and left with gold in ${pct(his.left)} of them.`,
        t ? ` ${tName} on the same raids: ${num(t.goldOut)} gold, ${pct(t.left)}.` : ''),
      endBars(his, t, tName),
      numbersTable(his, t, tName),
      run.events ? h('p', { class: 'muted' }, eventsLine(run.counts!)) : null,
      h('p', { class: 'muted' },
        `At boldness ${run.boldness.toFixed(1)}${run.block ? ', impossible actions blocked' : ''}, after ${plural(run.trained, 'lesson or practice raid', 'lessons and practice raids')}.`,
        stale && trainedNow !== run.trained ? ' He has trained since: raid again to see him now.' : stale ? ' His model has changed since.' : ''));
  }
}

/** How the raids ended: a bar per ending, the teacher's share as a dashed mark on the same track. */
function endBars(his: RaidSummary, t: RaidSummary | null, tName: string): HTMLElement {
  ensurePatterns();
  return h('div', { class: 'ends', role: 'list', 'aria-label': 'How the raids ended' }, ...ENDS.map((e) => {
    const v = his[e.key];
    const tv = t?.[e.key];
    const track = h('span', { class: 'end-track' },
      h('span', { class: 'end-fill', style: `width: ${(v * 100).toFixed(1)}%` }, swatchFill(e.fill)));
    if (tv !== undefined) track.append(h('span', { class: 'end-teacher', style: `left: ${(tv * 100).toFixed(1)}%`, title: `${tName}: ${pct(tv)}` }));
    return h('div', { class: 'end-row', role: 'listitem', title: `${e.label}: him ${pct(v)}${tv !== undefined ? `, ${tName.toLowerCase()} ${pct(tv)}` : ''}` },
      h('span', { class: 'end-name' }, e.label),
      track,
      h('span', { class: 'end-pct' }, pct(v), tv !== undefined ? h('small', { class: 'muted' }, ` (${pct(tv)})`) : null));
  }));
}

/** An SVG filling its box with a colour or a texture from the charts. */
function swatchFill(fill: string): SVGSVGElement {
  return s('svg', { width: '100%', height: '100%', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    s('rect', { width: '100%', height: '100%', fill }));
}

/** The averages per raid, his next to the teacher's. */
function numbersTable(his: RaidSummary, t: RaidSummary | null, tName: string): HTMLElement {
  const rows: [string, (x: RaidSummary) => string][] = [
    ['Gold carried out', (x) => num(x.goldOut)],
    ['Left with gold', (x) => pct(x.left)],
    ['Turns', (x) => num(x.turns)],
    ['Gold picked up', (x) => num(x.goldPickedUp)],
    ['Monsters beaten', (x) => num(x.beaten)],
    ['Potions drunk', (x) => num(x.potions)],
    ['Torches lit', (x) => num(x.torches)],
    ['Walls dug through', (x) => num(x.walls)],
    ['Waits', (x) => num(x.waits)],
    ['Wasted actions', (x) => num(x.wasted)],
  ];
  return h('table', { class: 'many-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'A raid on average'), h('th', {}, 'Him'), t ? h('th', {}, tName) : null)),
    h('tbody', {}, ...rows.map(([label, f]) => h('tr', {}, h('th', {}, label), h('td', {}, f(his)), t ? h('td', {}, f(t)) : null))));
}

/** "He met 230 events in 100 raids; 31 changed his stats, and they took 14 gold." */
function eventsLine(c: RaidCounts): string {
  const gold = c.eventGold === 0 ? '' : c.eventGold < 0 ? `, and they took ${-c.eventGold} gold` : `, and they gave ${c.eventGold} gold`;
  return `Hidden events: he met ${plural(c.events, 'event')} in ${plural(c.raids, 'raid')}; ${c.eventEffects.toLocaleString('en')} changed his stats${gold}. He never saw them coming.`;
}
