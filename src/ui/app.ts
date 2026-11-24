/**
 * The app: tabs in the order the story goes, the board, and a side panel per tab. Built so far: the Dungeon tab
 * (pick a code, look around, walk him yourself), Lessons and Practice (`training.ts`, with the model and its jobs
 * in `trainer.ts`), Raid alone (`raidAlone.ts`, with the memory strip in `strip.ts`), Many raids (`many.ts`), Inside
 * the model (`inside.ts`) and Settings. Small "AI" badges open the AI idea cards (`aiCard.ts`, `src/explain.ts`).
 */
import { raidDungeon, type Dungeon } from '../dungeon';
import { CAST, EventTracker, placeEvents, spotsLabel } from '../events';
import { MAP_CODE_MAX, TREASURE_LABEL, baseCode, cleanCode, codeLabel, dungeonFromCode, isMapCode, isTreasureCode, treasureCode } from '../mapCode';
import { FloorMarks } from '../marks';
import type { Raid, RaidTurn } from '../raid';
import {
  addToHall, dayCode, forgetAll, linkHash, loadHall, loadModel, loadSettings, makesHall, modelFile, packProbs,
  packModel, readLinkHash, readModelFile, saveHall, saveModel, saveSettings, utcDay, type HallEntry, type Store,
} from '../storage';
import { randomCode, rngFrom, type Rng } from '../rng';
import { MONSTER_KINDS, SHOWN, monsterGold, type MonsterKind } from '../tiles';
import { TeacherRaid, type TeacherName, type TeacherTurn } from '../teachers';
import { MEMORY_SIZES, type MemoryName } from '../tokens';
import type { Judge } from '../train';
import { DOWN, LEAVE, LEFT, LIGHT_TORCH, PICK_UP, RIGHT, RULES, UP, WAIT, DRINK, newRaid, step, torchLit, type Action, type RaidState } from '../world';
import type { CardKey } from '../explain';
import type { StepResult } from '../world';
import { aiBadge, closeCard } from './aiCard';
import { Board, type CellHandler } from './board';
import { DungeonEditor, type EditorHost } from './editor';
import { insidePanel, type InsideHost } from './inside';
import { ManyRaids, type ManyHost } from './many';
import { RaidAlone, type RaidHost } from './raidAlone';
import { BOLDNESS } from './raidPlay';
import { renderStrip } from './strip';
import { add, clear, h, s } from './dom';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { Trainer } from './trainer';
import { lessonsPanel, practicePanel, theTeacher, watchWords, type TrainingHost } from './training';
import {
  COLORS, T, bandage, barbarian, eventSpot, footprint, icon, itemSymbol, lootSack, monsterBody, potion, tileSymbol, torch,
} from './symbols';

type TabId = 'dungeon' | 'lessons' | 'raid' | 'practice' | 'many' | 'inside' | 'settings';
const TABS: { id: TabId; label: string }[] = [
  { id: 'dungeon', label: '1. Dungeon' },
  { id: 'lessons', label: '2. Lessons' },
  { id: 'raid', label: '3. Raid alone' },
  { id: 'practice', label: '4. Practice' },
  { id: 'many', label: '5. Many raids' },
  { id: 'inside', label: '6. Inside the model' },
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

/** A teacher's raid played on the board, one turn at a time (Watch a lesson). */
interface Watch {
  raid: TeacherRaid;
  teacher: TeacherName;
  marks: FloorMarks;
  timer: number;
}

/** Milliseconds per turn when watching a lesson. */
const WATCH_MS = 160;

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

/** The browser's storage, or one that keeps nothing when it is turned off. */
function browserStore(): Store {
  try {
    const ls = window.localStorage;
    ls.getItem('barbarian-lm-settings');
    return ls;
  } catch {
    return { getItem: () => null, setItem: () => { throw new Error('No storage'); }, removeItem: () => {} };
  }
}

/** Saved settings, each checked against the defaults (see "Save and links" in the design). */
function savedSettings(store: Store): Settings {
  const st = loadSettings(store, DEFAULT_SETTINGS, { memory: Object.keys(MEMORY_SIZES), trainIn: ['shown', 'treasure', 'new'] });
  st.boldness = Math.min(BOLDNESS.max, Math.max(BOLDNESS.min, Math.round(st.boldness * 10) / 10));
  return st;
}

/** Milliseconds to wait before saving, so a run of changes is saved once. */
const SAVE_MS = 400;

export class App implements TrainingHost, RaidHost, ManyHost, InsideHost, EditorHost {
  tab: TabId = 'dungeon';
  private readonly store: Store = browserStore();
  settings: Settings = savedSettings(this.store);
  hall: HallEntry[] = loadHall(this.store);
  /** What was saved last (the model and stats are saved again only when the trainer has new ones). */
  private saved: { model: unknown; stats: unknown } = { model: null, stats: null };
  /** Whether the browser refused the last save of his model (storage full or turned off). */
  private saveFailed = false;
  private saveTimer = 0;
  /** A line under the model file buttons: what loading a file did. */
  private fileNote = '';
  dungeon!: Dungeon;
  walk!: Walk;
  /** The dungeon editor, while a map is being edited on the Dungeon tab. */
  private editor: DungeonEditor | null = null;
  private readonly paintCell: CellHandler = (i, first) => this.editor?.press(i, first);
  /** Why the last code typed or linked could not be opened. */
  private codeNote = '';
  /** The dungeon before anyone moves: the board on Lessons and Practice when no lesson is being watched. */
  private start!: RaidState;
  readonly trainer = new Trainer(this.settings.memory, () => this.onTrainerChange());
  teacher: TeacherName = 'healer';
  lessonCount = 100;
  /** Lessons as corrected raids: he plays, the teacher says what it would do. */
  corrected = false;
  judge: Judge = 'goldOut';
  practiceCount = 1000;
  private watch: Watch | null = null;
  readonly watchLine = h('p', { class: 'watch-line', 'aria-live': 'polite' });
  private readonly board = new Board();
  readonly raidAlone = new RaidAlone(this);
  readonly many = new ManyRaids(this);
  /** The AI card whose badges pulse (the first time it is relevant), and the cards already made relevant. */
  private fresh: CardKey | null = null;
  private readonly cardsSeen = new Set<CardKey>();
  private readonly stripEl = h('div', { class: 'strip', hidden: true });
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
        h('div', { class: 'main-col' }, this.statsEl, h('div', { class: 'board-wrap' }, this.board.el), this.stripEl),
        this.panelEl));
    document.addEventListener('keydown', (e) => this.onKey(e));
    const saved = loadModel(this.store);
    if (saved) {
      this.settings.memory = saved.memory;
      this.trainer.load(saved.model, saved.memory, saved.stats);
      this.saved = { model: saved.model, stats: saved.stats };
    }
    window.addEventListener('hashchange', () => {
      const code = this.linkedCode();
      if (code && code !== baseCode(this.dungeon.code)) { this.setCode(code); this.render(); }
    });
    window.addEventListener('pagehide', () => this.saveNow());
    const linked = this.linkedCode();
    if (linked && !this.setCode(linked)) {
      // A broken map code in the link: a random dungeon, and the Dungeon tab says why.
      const why = this.codeNote;
      this.setCode(randomCode());
      this.codeNote = why;
      this.renderPanel();
    } else if (!linked) this.setCode(randomCode());
  }

  /** The dungeon code in the page's link, if any. */
  private linkedCode(): string | null {
    const raw = readLinkHash(location.hash);
    return raw ? cleanCode(raw) || null : null;
  }

  // ── Saving ──

  /** Save soon: settings always, his model and stats when the trainer has new ones. */
  saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_MS);
  }

  private saveNow(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    saveSettings(this.store, this.settings);
    const tr = this.trainer;
    if (tr.model === this.saved.model && tr.stats === this.saved.stats) return;
    const was = this.saveFailed;
    this.saveFailed = !saveModel(this.store, packModel(tr.model), tr.stats);
    if (!this.saveFailed) this.saved = { model: tr.model, stats: tr.stats };
    if (was !== this.saveFailed && this.tab === 'settings') this.renderPanel();
  }

  // ── Hall of fame ──

  raidEnded(raid: Raid): number | null {
    const st = raid.state;
    if (st.ended !== 'left' || !makesHall(this.hall, st.gold, st.turn)) return null;
    const set = this.settings;
    const tr = this.trainer;
    const now = new Date();
    const e: HallEntry = {
      gold: st.gold, turns: st.turn, code: raid.dungeon.code, n: raid.n,
      boldness: set.boldness, block: !!raid.options.block, events: !!raid.events, newSpots: set.newSpots,
      teacher: tr.mainTeacher(), trained: tr.stats.lessons + tr.stats.practiceRaids, memory: tr.memory,
      date: now.toISOString(), day: baseCode(raid.dungeon.code) === dayCode(now),
      actions: raid.turns.map((t) => t.action).join(''), probs: packProbs(raid.turns.map((t) => t.probs)),
    };
    this.hall = addToHall(this.hall, e);
    saveHall(this.store, this.hall);
    const place = this.hall.indexOf(e);
    return place < 0 ? null : place + 1;
  }

  replayEntry(e: HallEntry): void {
    if (this.dungeon.code !== e.code) this.setCode(e.code, true);
    this.raidAlone.playBack(e);
    this.board.reset();
    this.render();
  }

  clearHall(): void {
    this.hall = [];
    saveHall(this.store, this.hall);
    this.renderPanel();
  }

  // ── Model files ──

  private downloadModel(): void {
    const tr = this.trainer;
    const blob = new Blob([modelFile(tr.model, tr.stats)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const trained = tr.stats.lessons + tr.stats.practiceRaids;
    const a = h('a', { href: url, download: `barbarian-${tr.memory}-${trained}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async loadModelFile(file: File): Promise<void> {
    try {
      const f = readModelFile(await file.text());
      if (this.trainer.trained && !confirm('Load this barbarian in place of yours? His lessons and practice are replaced by the file\'s.')) return;
      this.settings = { ...this.settings, memory: f.memory };
      this.trainer.load(f.model, f.memory, f.stats);
      const n = f.stats.lessons + f.stats.practiceRaids;
      this.fileNote = `Loaded: ${MEMORY_LABELS[f.memory].toLowerCase()} memory, ${n.toLocaleString('en')} lessons and practice raids.`;
    } catch (err) {
      this.fileNote = err instanceof Error ? err.message : 'This file could not be loaded.';
    }
    this.saveSoon();
    this.render();
  }

  private forgetSaved(): void {
    if (!confirm('Forget everything saved in this browser: settings, his model and the hall of fame? What is on screen stays until you reload.')) return;
    clearTimeout(this.saveTimer);
    forgetAll(window.localStorage);
    this.hall = [];
    this.saved = { model: this.trainer.model, stats: this.trainer.stats };
    this.fileNote = 'Forgotten. Anything you change from now on is saved again.';
    this.renderPanel();
  }

  /**
   * Put a dungeon on screen by its code, with new treasure every raid if the setting says so (`exact`: the code as
   * it is, for a hall of fame replay); false (and the dungeon on screen kept) if it is a map code that cannot be read.
   */
  setCode(code: string, exact = false): boolean {
    let d: Dungeon;
    const wanted = exact ? code : this.settings.trainIn === 'treasure' ? treasureCode(baseCode(code)) : baseCode(code);
    code = baseCode(code);
    try {
      d = dungeonFromCode(wanted);
    } catch (err) {
      this.codeNote = err instanceof Error ? err.message : 'This code could not be opened.';
      if (this.dungeon && location.hash !== linkHash(baseCode(this.dungeon.code))) history.replaceState(null, '', linkHash(baseCode(this.dungeon.code)));
      if (this.dungeon && this.tab === 'dungeon') this.renderPanel();
      return false;
    }
    this.codeNote = '';
    this.editor = null;
    this.board.editWith(null);
    this.stopWatch();
    this.watch = null;
    this.raidAlone?.forget();
    this.dungeon = d;
    // With new treasure every raid, the board before anyone moves shows your walk's treasure.
    this.start = newRaid(raidDungeon(d, 'you'));
    // The address bar always shows the dungeon on screen, so copying it shares the dungeon.
    if (location.hash !== linkHash(code)) history.replaceState(null, '', linkHash(code));
    this.restartWalk();
    return true;
  }

  // ── The dungeon editor ──

  private startEdit(): void {
    this.editor = new DungeonEditor(this, this.dungeon);
    this.board.reset();
    this.render();
  }

  editDone(code: string): void {
    this.setCode(code);
  }

  editCancel(): void {
    this.editor = null;
    this.board.editWith(null);
    this.board.reset();
    this.render();
  }

  editChanged(): void {
    this.board.render(this.shown().state, this.boardOptions());
    this.renderPanel();
  }

  trainCode(): string | undefined {
    return this.settings.trainIn === 'new' ? undefined : this.dungeon.code;
  }

  choose(patch: Partial<Pick<TrainingHost, 'teacher' | 'lessonCount' | 'corrected' | 'judge' | 'practiceCount'>>): void {
    Object.assign(this, patch);
    if (patch.teacher && this.watch) this.stopWatch();
    if (patch.teacher === 'pickaxe') this.relevant('pickaxe');
    if (patch.corrected) this.relevant('corrected');
    this.renderPanel();
  }

  private onTrainerChange(): void {
    const st = this.trainer.stats;
    if (!this.trainer.busy) this.saveSoon();
    if (!this.trainer.busy && st.lessons) this.relevant('lessons');
    if (!this.trainer.busy && st.practiceRaids) this.relevant('practice');
    if (this.tab === 'lessons' || this.tab === 'practice' || this.tab === 'settings') this.renderPanel();
    // A raid that has not started yet takes his newest model.
    else if ((this.tab === 'raid' || this.tab === 'inside') && !this.raidAlone.raid?.turns.length && !this.raidAlone.playing) this.render();
  }

  // ── AI idea cards ──

  /** An "AI" badge for a card; it pulses while the card is fresh. */
  card(key: CardKey, place?: string): Node {
    return aiBadge(key, { fresh: this.fresh === key, place, onOpen: (k) => { if (this.fresh === k) this.setFresh(null); } });
  }

  /** A card is relevant now: its badges pulse, but only the first time. */
  relevant(key: CardKey): void {
    if (this.cardsSeen.has(key)) return;
    this.cardsSeen.add(key);
    this.setFresh(key);
  }

  private setFresh(key: CardKey | null): void {
    this.fresh = key;
    document.querySelectorAll('.ai-badge').forEach((b) => b.classList.toggle('fresh', b.getAttribute('data-card') === key));
  }

  /** The cards a turn just taken makes relevant (his own raid or your walk). */
  private turnCards(r: StepResult): void {
    if (r.hits.length || r.trapDamage) this.relevant('agentLoop');
    if (r.did === 'light') this.relevant('torch');
    else if (r.did === 'drink' || (r.did === 'pickUp' && !r.goldGained)) this.relevant('tools');
    else if (r.goldGained) this.relevant('pinned');
  }

  manyChanged(): void {
    if (this.tab === 'many') this.renderPanel();
  }

  raidOnScreen() {
    return this.raidAlone.ensure();
  }

  setQuietly(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.saveSoon();
  }

  /** A raid alone's turn on the board: effects, event pop-ups and his thought; null after a restart or to the end. */
  showTurn(turn: RaidTurn | null, fx: boolean): void {
    const ra = this.raidAlone;
    const raid = ra.raid;
    if (!raid) return;
    const st = raid.state;
    if (!turn) this.board.reset();
    this.board.render(st, this.boardOptions());
    if (turn) {
      this.relevant('probabilities');
      this.turnCards(turn.result);
      if (st.ended) this.relevant(st.ended === 'left' && turn.result.did === 'leave' && st.gold > 0 ? 'leave' : 'saga');
    }
    if (turn && fx) {
      this.board.effects(st, turn.result);
      for (const e of turn.events ?? []) {
        const k = raid.events?.kind(e.kind);
        if (k) this.board.pop(st.pos, k.popup, 'event');
      }
    }
    this.board.say(turn && this.settings.thoughts ? ra.thought : null, st.pos);
    this.renderStats();
    this.renderStrip();
  }

  private renderStrip(): void {
    const raid = this.tab === 'raid' || this.tab === 'inside' ? this.raidAlone.raid : null;
    this.stripEl.hidden = !raid;
    this.stripEl.parentElement?.parentElement?.classList.toggle('with-strip', !!raid);
    if (raid) renderStrip(this.stripEl, raid.state, raid.turns, raid.memory.size, (k) => this.card(k, 'strip'));
  }

  /** A fresh model, after asking if he has learned anything. */
  startOver(): void {
    if (this.trainer.trained && !confirm('Start over with a new, untrained barbarian? His lessons and practice are cleared.')) return;
    this.trainer.fresh(this.settings.memory);
  }

  get watching(): boolean { return !!this.watch?.timer; }

  /** Play the next lesson of the chosen teacher on the board (raid 0 of the code on screen with new dungeons). */
  startWatch(): void {
    this.stopWatch();
    const st = this.trainer.stats;
    const n = this.trainCode() ? st.lessons + st.practiceRaids : 0;
    const raid = new TeacherRaid(this.dungeon, this.teacher, n);
    this.watch = { raid, teacher: this.teacher, marks: new FloorMarks(raid.state.pos), timer: 0 };
    this.watchLine.textContent = `Turn 0: ${theTeacher(this.teacher)} stands on the stairs.`;
    this.watch.timer = window.setInterval(() => this.watchTick(), WATCH_MS);
    this.board.reset();
    this.render();
  }

  /** Stop the lesson being watched; the board stays where it stopped until another tab or lesson. */
  stopWatch(): void {
    if (!this.watch) return;
    if (this.watch.timer) clearInterval(this.watch.timer);
    this.watch.timer = 0;
    if (this.tab === 'lessons') this.renderPanel();
  }

  private watchTick(): void {
    const w = this.watch;
    if (!w) return;
    const turn: TeacherTurn | null = w.raid.next();
    const st = w.raid.state;
    if (!turn) {
      clearInterval(w.timer);
      w.timer = 0;
      const who = theTeacher(w.teacher).replace(/^t/, 'T');
      this.watchLine.textContent = st.ended === 'left' ? `${who} is out with ${st.gold} gold after ${st.turn} turns.`
        : st.ended === 'knockedOut' ? `${who} is knocked out after ${st.turn} turns. The keeper carries him out.`
          : `${who} is locked in at sundown after ${st.turn} turns.`;
      this.renderPanel();
      return;
    }
    w.marks.after(turn.result, st.pos, st.turn);
    this.board.render(st, this.boardOptions());
    this.board.effects(st, turn.result);
    this.watchLine.textContent = watchWords(w.teacher, st.turn, turn);
    this.renderStats();
  }

  restartWalk(): void {
    const d = this.dungeon;
    // Your walk counts as its own raid, "you", with streams (and, with new treasure every raid, treasure) of its own.
    const here = raidDungeon(d, 'you');
    const state = newRaid(here);
    let events: EventTracker | null = null;
    if (this.settings.events) {
      const label = this.settings.newSpots ? `${d.code}|events|you` : spotsLabel(d.code);
      events = new EventTracker({ spots: placeEvents(here, label), cast: CAST }, rngFrom(`${d.code}|you|story`), state);
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
    this.turnCards(r);
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
    if (this.tab !== 'dungeon') return;
    const target = e.target as HTMLElement | null;
    if (this.editor) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && target?.tagName !== 'INPUT') {
        e.preventDefault();
        this.editor.undo();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON' && e.key === ' ')) return;
    const a = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (a === undefined) return;
    e.preventDefault();
    this.act(a);
  }

  /** What the board shows: your walk on the Dungeon tab, a watched lesson, or the dungeon before anyone moves. */
  private shown(): { state: RaidState; marks: FloorMarks | null; walk: boolean } {
    if (this.tab === 'dungeon' && this.editor) return { state: this.editor.state(), marks: null, walk: false };
    if (this.tab === 'dungeon') return { state: this.walk.state, marks: this.walk.marks, walk: true };
    if (this.tab === 'raid' || this.tab === 'inside') {
      const r = this.raidAlone.ensure();
      return { state: r.state, marks: this.raidAlone.marks, walk: false };
    }
    if (this.tab === 'lessons' && this.watch) return { state: this.watch.raid.state, marks: this.watch.marks, walk: false };
    return { state: this.start, marks: null, walk: false };
  }

  private boardOptions() {
    const st = this.settings;
    const sh = this.shown();
    const editing = this.tab === 'dungeon' && !!this.editor;
    return {
      dim: st.dim && !editing,
      hero: !editing,
      flicker: st.flicker,
      marks: st.fightMarks ? sh.marks : null,
      // Lessons and practice never have events.
      spots: !st.events || !st.showEvents ? null
        : sh.walk ? this.walk.events?.setup.spots ?? null
          : this.tab === 'raid' || this.tab === 'inside' ? this.raidAlone.raid?.events?.setup.spots ?? null : null,
    };
  }

  private setTab(id: TabId): void {
    if (id === this.tab) return;
    if (this.tab === 'lessons') {
      this.stopWatch();
      this.watch = null;
    }
    if (this.tab === 'raid') this.raidAlone.pause();
    closeCard();
    this.tab = id;
    if (id === 'raid') this.relevant('tokens');
    if (id === 'inside') this.relevant('buckets');
    this.board.reset();
    this.render();
  }

  render(): void {
    this.board.editWith(this.tab === 'dungeon' && this.editor ? this.paintCell : null);
    this.renderTabs();
    this.board.render(this.shown().state, this.boardOptions());
    this.board.say(null);
    this.renderStats();
    this.renderStrip();
    this.renderPanel();
  }

  private renderTabs(): void {
    clear(this.tabsEl);
    for (const t of TABS) {
      this.tabsEl.append(h('button', {
        role: 'tab', class: `tab ${this.tab === t.id ? 'active' : ''}`, 'aria-selected': String(this.tab === t.id),
        onclick: () => this.setTab(t.id),
      }, t.label));
    }
  }

  private renderStats(): void {
    const st = this.shown().state;
    const low = st.hp <= 4;
    const lit = torchLit(st);
    clear(this.statsEl);
    add(this.statsEl,
      stat(heartIcon(low), 'HP', `${st.hp} / ${st.maxHp}`, low ? 'danger' : ''),
      stat(swordIcon(), 'Attack', String(st.attack)),
      stat(icon(potion(), 0.55), 'Potions', String(st.potions)),
      stat(icon(torch(lit), 0.55), 'Torches', lit ? `${st.torches} · lit ${st.torchLeft}` : String(st.torches), '', this.card('torch', 'stats')),
      stat(icon(itemSymbol(SHOWN.smallGold)!, 0.6), 'Gold', String(st.gold)),
      stat(sunIcon(), 'Time left', String(st.timeLeft), st.timeLeft <= 20 ? 'warn-text' : ''));
  }

  renderPanel(): void {
    clear(this.panelEl);
    if (this.tab === 'dungeon') this.dungeonPanel();
    else if (this.tab === 'lessons') add(this.panelEl, ...lessonsPanel(this));
    else if (this.tab === 'practice') add(this.panelEl, ...practicePanel(this));
    else if (this.tab === 'raid') add(this.panelEl, ...this.raidAlone.panel());
    else if (this.tab === 'many') add(this.panelEl, ...this.many.panel());
    else if (this.tab === 'inside') add(this.panelEl, ...insidePanel(this));
    else if (this.tab === 'settings') this.settingsPanel();
  }

  private dungeonPanel(): void {
    if (this.editor) {
      add(this.panelEl, ...this.editor.panel());
      return;
    }
    const d = raidDungeon(this.dungeon, 'you');
    const input = h('input', { type: 'text', 'aria-label': 'Dungeon code', placeholder: 'CODE', maxlength: MAP_CODE_MAX });
    const go = () => {
      const code = cleanCode(input.value);
      if (code && !this.setCode(code)) input.value = code;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const goldTotal = d.gold.reduce((a, b) => a + b, 0) + d.monsters.reduce((a, m) => a + monsterGold(m), 0);
    const count = (k: MonsterKind) => d.monsters.filter((m) => m.kind === k).length;
    const now = new Date();
    const today = dayCode(now);
    const copied = h('span', { class: 'muted', 'aria-live': 'polite' });
    const copy = () => {
      const url = location.href;
      navigator.clipboard?.writeText(url).then(() => { copied.textContent = 'Link copied.'; }, () => { copied.textContent = url; })
        ?? (copied.textContent = url);
    };
    add(this.panelEl,
      h('h2', {}, 'The dungeon'),
      h('div', { class: 'code-line' }, h('span', { class: 'muted' }, 'Dungeon code'), h('span', { class: 'code' }, codeLabel(d.code)),
        baseCode(d.code) === today ? h('span', { class: 'day-badge', title: `The same for everyone on ${utcDay(now)} (UTC)` }, '☀ Dungeon of the day') : null,
        isMapCode(d.code) ? h('span', { class: 'muted', title: 'Its whole map is in the link' }, 'made by hand') : null),
      h('div', { class: 'row code-row' },
        h('button', { onclick: () => this.setCode(randomCode()) }, 'New dungeon'),
        input,
        h('button', { onclick: go }, 'Go')),
      h('div', { class: 'row' },
        h('button', { class: 'subtle', disabled: baseCode(d.code) === today, onclick: () => this.setCode(today), title: 'A new one every day at midnight UTC, the same for everyone' }, '☀ Dungeon of the day'),
        h('button', { class: 'subtle', onclick: copy, title: 'A link to this dungeon. His model stays in your browser.' }, 'Copy link'),
        h('button', { class: 'subtle', onclick: () => this.startEdit(), title: 'Paint your own dungeon, starting from this one' }, '✎ Edit'),
        copied),
      this.codeNote ? h('p', { class: 'muted', role: 'alert' }, '✖ ', this.codeNote) : null,
      h('p', { class: 'muted' },
        `${goldTotal} gold in all. `,
        MONSTER_KINDS.map((k) => `${count(k)} ${k}${count(k) === 1 ? '' : 's'}`).join(', '), '.'),
      isTreasureCode(d.code) ? h('p', { class: 'muted' }, `${TREASURE_LABEL} New treasure every raid: the walls stay, but gold, monsters, items and traps are placed afresh each time. This is where they lie for your walk. (Settings)`) : null,
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
      h('h3', {}, 'Walk him yourself ', this.card('tools', 'walk')),
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
      [mon('dragon'), 'Dragon (never moves; only for the fully buffed)'],
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
    const busy = this.trainer.busy;
    const set = <K extends keyof Settings>(k: K, v: Settings[K], restart = false) => {
      // The memory fixes the model's size: another memory needs a fresh model.
      if (k === 'memory' && v !== this.trainer.memory) {
        if (this.trainer.trained && !confirm('Another memory needs a new, untrained barbarian: his lessons and practice are cleared. Go on?')) {
          this.renderPanel();
          return;
        }
        this.settings = { ...this.settings, memory: v as MemoryName };
        this.trainer.fresh(v as MemoryName);
        this.saveSoon();
        this.render();
        return;
      }
      this.settings = { ...this.settings, [k]: v };
      this.saveSoon();
      // New treasure every raid, or not: the dungeon on screen follows.
      if (k === 'trainIn') { this.setCode(this.dungeon.code); this.render(); return; }
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
          h('input', { type: 'radio', name: k, checked: st[k] === v, disabled: busy, onchange: () => set(k, v) }),
          label)));
    add(this.panelEl,
      h('h2', {}, 'Settings'),
      h('div', { class: 'group' },
        h('h3', {}, 'His memory'),
        radio('memory', (Object.keys(MEMORY_SIZES) as MemoryName[]).map((m) => [m, `${MEMORY_LABELS[m]} (${MEMORY_SIZES[m]})`])),
        h('p', { class: 'muted' }, 'How many past views and actions he remembers. Set it before lessons: it fixes the size of his model, so changing it later starts him afresh.')),
      h('div', { class: 'group' },
        h('h3', {}, 'Where he raids'),
        radio('trainIn', [['shown', 'In the dungeon on screen'], ['treasure', `In the dungeon on screen, new treasure every raid ${TREASURE_LABEL}`], ['new', 'Lessons and practice in a new dungeon every raid']]),
        h('p', { class: 'muted' }, st.trainIn === 'treasure'
          ? 'The walls stay; gold, monsters, items and traps move every raid, for lessons, practice, raids alone and many raids. He can learn the map, but must look for the treasure. A dungeon made by hand keeps its own.'
          : st.trainIn === 'shown' ? 'Lessons, practice, raids alone and many raids all happen in the dungeon on screen.' : 'Raids alone stay in the dungeon on screen.'),
        busy ? h('p', { class: 'muted' }, 'These wait until his lessons or practice are done.') : null),
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
        check('fightMarks', 'Pools and prints', 'Where a monster fell, and his prints after he walks through it.')),
      this.saveGroup());
  }

  /** Saving: what this browser keeps, the model file, and forgetting it all. */
  private saveGroup(): HTMLElement {
    const busy = this.trainer.busy;
    const picker = h('input', {
      type: 'file', accept: '.json,application/json', hidden: true,
      onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void this.loadModelFile(f); },
    });
    return h('div', { class: 'group' },
      h('h3', {}, 'Saved in this browser'),
      h('p', { class: 'muted' }, 'Your settings, his model with its stats, and the hall of fame are kept here by themselves. A link carries only the dungeon code.'),
      this.saveFailed ? h('p', { class: 'warn-text' }, 'His model could not be saved: this browser\'s storage is full or turned off. Download it to keep it.') : null,
      h('div', { class: 'row' },
        h('button', { onclick: () => this.downloadModel(), title: 'A file with his model and its stats' }, 'Download his model'),
        h('button', { disabled: busy, onclick: () => picker.click() }, 'Load a model file'),
        picker),
      busy ? h('p', { class: 'muted' }, 'Loading a file waits until his lessons or practice are done.') : null,
      this.fileNote ? h('p', { class: 'muted', 'aria-live': 'polite' }, this.fileNote) : null,
      h('p', { class: 'muted' }, 'A model is just its numbers: a file holds every one of them, so he plays the same on another computer.'),
      h('button', { class: 'subtle', onclick: () => this.forgetSaved() }, 'Forget everything saved'));
  }
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

function stat(ic: SVGSVGElement, label: string, value: string, cls = '', badge?: Node): HTMLElement {
  return h('div', { class: `stat ${cls}` }, ic, h('span', { class: 'label' }, label), h('strong', {}, value), badge);
}
