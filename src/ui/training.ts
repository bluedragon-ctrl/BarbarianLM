/**
 * The Lessons and Practice panels: pick a teacher or a judge, how many lessons or practice raids, run and stop,
 * and the charts of how he does on his test raids, with his teacher's numbers on the same raids next to his.
 */
import type { Dungeon } from '../dungeon';
import type { CardKey } from '../explain';
import { codeLabel } from '../mapCode';
import { parameterCount } from '../model';
import type { RaidSummary } from '../raids';
import { TEACHERS, TEACHER_LABELS, type Reason, type TeacherName, type TeacherTurn } from '../teachers';
import { MEMORY_SIZES, type MemoryName } from '../tokens';
import { JUDGES, JUDGE_LABELS, LOOP, testsIn, type Judge } from '../train';
import { ACTION_NAMES } from '../world';
import { outcomeChart, scoreChart } from './charts';
import { h } from './dom';
import type { Trainer } from './trainer';

/** One plain line per teacher, for the picker. */
export const TEACHER_LINES: Record<TeacherName, string> = {
  warrior: 'Charges for the nearest gold and fights anything he can beat. Earns well, and is knocked out most.',
  healer: 'Careful: fights only with HP to spare, drinks early and leaves in good time.',
  thief: 'Keeps away from monsters and takes the gold no one guards. Earns less, but is the safest.',
  dwarf: 'Careful like the healer, and digs through a wall when that is quicker than walking round.',
  pickaxe: 'Digs through any wall in one blow with his own pickaxe. The barbarian has no such pickaxe.',
  goblin: 'Plays just like the old warrior. Or does he?',
  champion: 'Fetches strength and vigour first, then hunts monsters for their gold. Fully buffed and healthy, he takes on the dragon.',
};

/** One plain line per judge. */
export const JUDGE_LINES: Record<Judge, string> = {
  goldOut: 'Scores the gold he carries out. If he does not get out, the raid scores nothing.',
  goldPickedUp: 'Scores every coin he picks up, whether he gets out with it or not.',
  monstersBeaten: 'Scores every monster he beats, tougher ones more.',
};

/** Why a teacher took its action, in plain words, for watching a lesson. */
export const REASON_WORDS: Record<Reason, string> = {
  leave: 'leaves by the stairs',
  troll: 'walks straight at the troll or dragon',
  flee: 'steps away from a monster he will not fight',
  drink: 'drinks a potion',
  fight: 'strikes',
  wait: 'waits for the monster to come to him',
  torch: 'lights a torch to see more',
  pickUp: 'picks it up',
  target: 'heads for gold or something useful',
  explore: 'explores',
  home: 'heads home',
  stuck: 'is stuck',
};

export const LESSON_COUNTS = [10, 100, 1000] as const;
export const PRACTICE_COUNTS = [100, 1000, 3000] as const;

const MEMORY_LABELS: Record<MemoryName, string> = { short: 'Short', medium: 'Medium', long: 'Long' };

/** What the panels need from the app. */
export interface TrainingHost {
  trainer: Trainer;
  dungeon: Dungeon;
  teacher: TeacherName;
  lessonCount: number;
  /** Lessons as corrected raids: he plays, the teacher says what it would do. */
  corrected: boolean;
  judge: Judge;
  practiceCount: number;
  /** The dungeon training happens in: the code on screen, or none (a new dungeon every raid). */
  trainCode(): string | undefined;
  choose(patch: Partial<Pick<TrainingHost, 'teacher' | 'lessonCount' | 'corrected' | 'judge' | 'practiceCount'>>): void;
  watching: boolean;
  watchLine: HTMLElement;
  startWatch(): void;
  stopWatch(): void;
  startOver(): void;
  /** An "AI" badge. */
  card(key: CardKey, place?: string): Node;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const gold = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
/** Gold out and the share that left with gold, always together. */
export const numbers = (t: RaidSummary) => `${gold(t.goldOut)} gold, left with gold ${pct(t.left)}`;

/** Where the test raids are, in words. */
function testsWhere(host: TrainingHost): string {
  const code = host.trainCode();
  return code ? `raids 0–${LOOP.evalRaids - 1} of ${codeLabel(code)}` : `${LOOP.evalRaids} test dungeons`;
}

/** The radio buttons for a count. */
function counts(name: string, options: readonly number[], value: number, disabled: boolean, pick: (n: number) => void): HTMLElement {
  return h('div', { class: 'row', role: 'radiogroup', 'aria-label': name }, ...options.map((n) =>
    h('label', { class: 'radio' },
      h('input', { type: 'radio', name, checked: value === n, disabled, onchange: () => pick(n) }),
      n.toLocaleString('en'))));
}

/** Run, or the running job's progress and Stop. */
function jobBox(host: TrainingHost, kind: 'lessons' | 'practice', run: HTMLButtonElement): HTMLElement {
  const job = host.trainer.job;
  if (!job) return h('div', { class: 'row' }, run);
  const what = job.kind === 'practice' ? 'Practice raids' : job.corrected ? 'Corrected raids' : 'Lessons';
  return h('div', { class: 'job' },
    h('div', { class: 'row' },
      h('progress', { max: job.total, value: job.done, 'aria-label': what }),
      h('span', { class: 'muted' }, `${what}: ${job.done.toLocaleString('en')} of ${job.total.toLocaleString('en')}`),
      h('button', { onclick: () => host.trainer.stop() }, 'Stop')),
    job.kind !== kind ? h('p', { class: 'muted' }, job.kind === 'lessons' ? 'He is having lessons.' : 'He is practising.') : null,
    h('p', { class: 'muted' }, 'Stop throws this round away: he stays as he was before it.'));
}

/** His test raids as a chart, and the last numbers next to the teacher's on the same raids. */
function howHeDoes(host: TrainingHost, teacher: TeacherName | null): (HTMLElement | null)[] {
  const st = host.trainer.shown;
  const where = testsIn(host.trainCode());
  const points = st.evals.filter((e) => e.where === where);
  const tests = teacher ? host.trainer.teachers(host.trainCode())?.[teacher] : undefined;
  const line = teacher && tests ? { label: TEACHER_LABELS[teacher], tests } : undefined;
  const last = points.at(-1);
  const elsewhere = st.evals.length - points.length;
  return [
    h('h3', {}, 'How he does alone'),
    outcomeChart(points, line),
    last ? h('p', { class: 'compare' },
      `Last test: ${numbers(last)}.`,
      line ? ` ${line.label} on the same raids: ${numbers(line.tests)}.` : '') : null,
    h('p', { class: 'muted' },
      `Every so often he raids alone on his test raids (${testsWhere(host)}), at boldness ${LOOP.evalTemperature}.`,
      line ? ' The dashed line is his teacher on the same raids.' : '',
      elsewhere ? ` (${plural(elsewhere, 'test')} from other dungeons not shown.)` : ''),
  ];
}

export function lessonsPanel(host: TrainingHost): (HTMLElement | null)[] {
  const tr = host.trainer;
  const st = tr.shown;
  const busy = tr.busy;
  const tests = tr.teachers(host.trainCode());
  const run = h('button', { class: 'primary', onclick: () => tr.lessons(host.teacher, host.lessonCount, host.trainCode(), host.corrected) },
    host.corrected ? `Correct ${plural(host.lessonCount, 'raid')}` : `Give ${plural(host.lessonCount, 'lesson')}`);
  const sofar = st.lessons
    ? `So far: ${plural(st.lessons, 'lesson')} (${TEACHERS.filter((t) => st.teacherCounts[t]).map((t) => `${TEACHER_LABELS[t].toLowerCase()} ${st.teacherCounts[t]!.toLocaleString('en')}`).join(', ')})` +
      (st.corrected ? `, ${st.corrected.toLocaleString('en')} of them corrected raids` : '')
    : 'So far: no lessons yet.';
  const kind = (corrected: boolean, label: string, line: string, card?: Node) =>
    h('label', { class: `pick ${host.corrected === corrected ? 'chosen' : ''}` },
      h('input', { type: 'radio', name: 'lessonKind', checked: host.corrected === corrected, disabled: busy, onchange: () => host.choose({ corrected }) }),
      h('span', { class: 'pick-body' }, h('span', {}, h('strong', {}, label), card ? ' ' : null, card ?? null), h('small', { class: 'muted' }, line)));
  return [
    h('h2', {}, 'Lessons'),
    h('p', { class: 'caption' }, 'A teacher raids the dungeon. At every turn he guesses the teacher\'s next action, sees the real one and learns a little.'),
    h('div', { class: 'group' },
      h('h3', {}, 'Who teaches him? ', host.card('lessons', 'lessons')),
      h('div', { class: 'pick-list', role: 'radiogroup', 'aria-label': 'Teacher' }, ...TEACHERS.map((t) => {
        const n = tests?.[t];
        return h('label', { class: `pick ${host.teacher === t ? 'chosen' : ''}` },
          h('input', { type: 'radio', name: 'teacher', checked: host.teacher === t, disabled: busy, onchange: () => host.choose({ teacher: t }) }),
          h('span', { class: 'pick-body' },
            h('span', { class: 'pick-head' }, h('span', {}, h('strong', {}, TEACHER_LABELS[t]), t === 'pickaxe' ? ' ' : null, t === 'pickaxe' ? host.card('pickaxe', 'teacher') : null), h('span', { class: 'pick-num' }, n ? numbers(n) : '…')),
            h('small', { class: 'muted' }, TEACHER_LINES[t])));
      })),
      h('p', { class: 'muted' }, `The teachers' numbers are their own raids on his test raids (${testsWhere(host)}).`)),
    h('div', { class: 'group' },
      h('h3', {}, 'Give him lessons'),
      h('div', { class: 'pick-list', role: 'radiogroup', 'aria-label': 'Kind of lesson' },
        kind(false, 'The teacher raids', 'He follows the teacher\'s raid and guesses each next action.'),
        kind(true, 'He raids, the teacher corrects', 'He raids himself (the teacher takes over half the turns). At every turn the teacher says what it would do there, and he learns that. A plain lesson comes between raids.', host.card('corrected', 'lessons'))),
      host.corrected ? h('p', { class: 'muted' }, 'An experiment: the teacher steers by a map it remembers and he cannot see, so this often makes him worse. Watch the chart.') : null,
      st.lessons || !host.corrected ? null : h('p', { class: 'muted' }, 'With no lessons yet he wanders at random, so the teacher mostly corrects him near the stairs. A few plain lessons first help.'),
      counts('lessonCount', LESSON_COUNTS, host.lessonCount, busy, (n) => host.choose({ lessonCount: n })),
      jobBox(host, 'lessons', run),
      h('p', { class: 'muted' }, sofar),
      h('div', { class: 'row' },
        h('span', { class: 'muted' }, `His memory: ${MEMORY_LABELS[tr.memory]} (${MEMORY_SIZES[tr.memory]}), ${parameterCount(tr.model).toLocaleString('en')} numbers to learn.`),
        tr.trained ? h('button', { class: 'subtle', disabled: busy, onclick: () => host.startOver() }, 'Start over') : null),
      tr.memory === 'long' ? h('p', { class: 'muted' }, 'A long memory has more to learn: it needs more lessons than a short one.') : null),
    h('div', { class: 'group' }, ...howHeDoes(host, host.teacher)),
    h('div', { class: 'group' },
      h('h3', {}, 'Watch a lesson'),
      h('div', { class: 'row' },
        host.watching
          ? h('button', { onclick: () => host.stopWatch() }, 'Stop watching')
          : h('button', { onclick: () => host.startWatch() }, `Watch the ${TEACHER_LABELS[host.teacher].toLowerCase()}`)),
      host.watchLine,
      h('p', { class: 'muted' }, host.trainCode()
        ? 'This is the lesson he gets next. Watching teaches him nothing; lessons do.'
        : 'A lesson in the dungeon on screen; his lessons are each in a new dungeon. Watching teaches him nothing.')),
  ];
}

export function practicePanel(host: TrainingHost): (HTMLElement | null)[] {
  const tr = host.trainer;
  const st = tr.shown;
  const busy = tr.busy;
  const run = h('button', { class: 'primary', onclick: () => tr.practice(host.judge, host.practiceCount, host.trainCode()) },
    `Practise ${plural(host.practiceCount, 'raid')}`);
  const p = busy ? null : tr.lastPractice;
  const hacked = p && p.judge !== 'goldOut' && p.scoreBefore !== null && p.scoreAfter > p.scoreBefore && p.goldAfter < p.goldBefore - 1;
  return [
    h('h2', {}, 'Practice'),
    h('p', { class: 'caption' }, 'He raids on his own and a judge scores each raid. Actions from raids that scored better than usual become more likely; worse, less likely.'),
    h('div', { class: 'group' },
      h('h3', {}, 'Who judges? ', host.card('practice', 'practice')),
      h('div', { class: 'pick-list', role: 'radiogroup', 'aria-label': 'Judge' }, ...JUDGES.map((j) =>
        h('label', { class: `pick ${host.judge === j ? 'chosen' : ''}` },
          h('input', { type: 'radio', name: 'judge', checked: host.judge === j, disabled: busy, onchange: () => host.choose({ judge: j }) }),
          h('span', { class: 'pick-body' }, h('strong', {}, JUDGE_LABELS[j]), h('small', { class: 'muted' }, JUDGE_LINES[j])))))),
    h('div', { class: 'group' },
      h('h3', {}, 'Let him practise'),
      counts('practiceCount', PRACTICE_COUNTS, host.practiceCount, busy, (n) => host.choose({ practiceCount: n })),
      jobBox(host, 'practice', run),
      h('p', { class: 'muted' }, st.practiceRaids
        ? `So far: ${plural(st.practiceRaids, 'practice raid')} (${JUDGES.filter((j) => st.judgeRaids[j]).map((j) => `${JUDGE_LABELS[j].toLowerCase()} ${st.judgeRaids[j]!.toLocaleString('en')}`).join(', ')})`
        : 'So far: no practice yet.'),
      st.lessons ? null : h('p', { class: 'muted' }, 'He has had no lessons yet. Practice from nothing starts with random guesses and learns slowly.')),
    p ? h('div', { class: `group summary ${hacked ? 'alarm' : ''}` },
      h('p', {}, `${JUDGE_LABELS[p.judge]}: the judge's score went from ${p.scoreBefore === null ? '–' : p.scoreBefore.toFixed(2)} to ${p.scoreAfter.toFixed(2)}. ` +
        `Gold carried out on the test raids: ${gold(p.goldBefore)} → ${gold(p.goldAfter)}.`),
      hacked ? h('p', {}, 'His score went up, but he carries out less gold: he is learning to please the judge, not to raid well.') : null) : null,
    h('div', { class: 'group' },
      h('h3', {}, 'The judge\'s score'),
      scoreChart(st.practiceScore),
      h('p', { class: 'muted' }, `The judge's mean score over every ${LOOP.chunk} practice raids, at boldness ${LOOP.practiceTemperature}.`)),
    h('div', { class: 'group' }, ...howHeDoes(host, tr.mainTeacher())),
  ];
}

/** "the healer", "the old warrior". */
export const theTeacher = (t: TeacherName) => `the ${TEACHER_LABELS[t].toLowerCase()}`;

/** One turn of a watched lesson, in words: "Turn 12: right. The healer heads for gold or something useful." */
export function watchWords(teacher: TeacherName, turn: number, t: Pick<TeacherTurn, 'action' | 'reason'>): string {
  return `Turn ${turn}: ${ACTION_NAMES[t.action]}. ${theTeacher(teacher).replace(/^t/, 'T')} ${REASON_WORDS[t.reason]}.`;
}
