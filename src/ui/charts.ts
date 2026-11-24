/**
 * Small SVG charts for the Lessons and Practice tabs (modelled on Karkulka's `charts.ts`). The outcome chart is two
 * panels on one x-axis, one test point (20 test raids) per column: gold carried out as a line, and how the test
 * raids ended as stacked columns, with his teacher's numbers on the same raids as dashed lines. Two panels, not
 * two y-axes. The score chart is the judges' scores during practice. Each column and line has a tooltip.
 */
import type { RaidSummary } from '../raids';
import { JUDGE_LABELS, JUDGES, type EvalPoint, type Judge, type ScorePoint } from '../train';
import { h, s } from './dom';

const W = 360;
const LEFT = 34;
/** Room on the right for the last value's label. */
const RIGHT = 30;
const PANEL = 88;
const GAP = 22;
/** The most test points shown; older ones scroll off the left. */
const MAX_POINTS = 40;

/** Chart colours, checked with the dataviz palette validator (light surface). Red is only for knocked out. */
export const CHART = {
  his: '#1f6f9a',
  teacher: '#b07818',
  leftGold: '#3f8f4f',
  leftEmpty: '#a89c7e',
  lockedIn: '#6a4fb0',
  knockedOut: '#c62828',
  grid: '#e4ddcf',
  axis: '#6b655e',
  surface: '#ffffff',
} as const;

const JUDGE_COLORS: Record<Judge, string> = { goldOut: CHART.his, goldPickedUp: CHART.teacher, monstersBeaten: CHART.lockedIn };

/** How a raid ended, bottom to top in a column; each has a colour and a texture (shape plus colour). */
const ENDS = [
  { key: 'left', label: 'Left with gold', color: CHART.leftGold, fill: CHART.leftGold },
  { key: 'leftNoGold', label: 'Left with none', color: CHART.leftEmpty, fill: 'url(#chart-dots)' },
  { key: 'lockedIn', label: 'Locked in', color: CHART.lockedIn, fill: 'url(#chart-hatch-135)' },
  { key: 'knockedOut', label: 'Knocked out', color: CHART.knockedOut, fill: 'url(#chart-hatch-45)' },
] as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmt = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1));

/** The textures, defined once per page so their ids stay unique. */
function ensurePatterns(): void {
  if (document.getElementById('chart-dots')) return;
  const hatch = (id: string, angle: number, color: string) =>
    s('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: `rotate(${angle})` },
      s('rect', { width: 6, height: 6, fill: color }), s('rect', { width: 2, height: 6, fill: '#ffffff', 'fill-opacity': 0.45 }));
  const defs = s('defs', {},
    s('pattern', { id: 'chart-dots', width: 5, height: 5, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: 5, height: 5, fill: CHART.leftEmpty }), s('circle', { cx: 2.5, cy: 2.5, r: 1, fill: '#ffffff', 'fill-opacity': 0.7 })),
    hatch('chart-hatch-135', 135, CHART.lockedIn),
    hatch('chart-hatch-45', 45, CHART.knockedOut));
  // Not display:none, which stops patterns from painting in some browsers.
  document.body.append(s('svg', { width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute' }, defs));
}

const text = (x: number, y: number, str: string, o: Record<string, unknown> = {}) =>
  s('text', { x, y, 'font-size': 10, fill: CHART.axis, ...o }, str);

/** A clean top for a y-axis: 10, 20, 50, 100… at or above `v`. */
function niceMax(v: number): number {
  const steps = [10, 20, 40, 60, 80, 100, 150, 200];
  return steps.find((x) => x >= v) ?? Math.ceil(v / 100) * 100;
}

function swatch(fill: string): SVGSVGElement {
  return s('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' }, s('rect', { width: 14, height: 14, rx: 3, fill }));
}
function lineKey(color: string, dashed = false): SVGSVGElement {
  return s('svg', { width: 18, height: 10, viewBox: '0 0 18 10', 'aria-hidden': 'true' },
    s('line', { x1: 1, y1: 5, x2: 17, y2: 5, stroke: color, 'stroke-width': 2, 'stroke-dasharray': dashed ? '4 3' : undefined, 'stroke-linecap': 'round' }));
}
const legendItem = (key: SVGSVGElement, label: string) => h('span', { class: 'legend-item' }, key, label);

export interface TeacherLine { label: string; tests: RaidSummary }

/**
 * Gold carried out and how the test raids ended, per test point, with the teacher's numbers on the same raids.
 * A line marks where the kind of training changed (lessons, practice).
 */
export function outcomeChart(points: readonly EvalPoint[], teacher?: TeacherLine): HTMLElement {
  ensurePatterns();
  const shown = points.slice(-MAX_POINTS);
  const height = PANEL * 2 + GAP + 30;
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, width: '100%', class: 'chart-svg', role: 'img', 'aria-label': 'How he does on his test raids' });
  const fig = h('figure', { class: 'chart' }, svg);
  const goldTop = 12;
  const endsTop = goldTop + PANEL + GAP;
  svg.append(
    text(LEFT, goldTop - 3, 'Gold carried out', { 'font-weight': 600, fill: '#262321' }),
    text(LEFT, endsTop - 3, 'How the test raids ended', { 'font-weight': 600, fill: '#262321' }));
  if (!shown.length) {
    svg.append(text(W / 2, goldTop + PANEL, 'No test raids yet', { 'text-anchor': 'middle', 'font-size': 12 }));
    fig.append(legend(teacher));
    return fig;
  }
  const plotW = W - LEFT - RIGHT;
  const slot = plotW / Math.max(shown.length, 10);
  const barW = Math.min(24, slot - 2);
  const cx = (k: number) => LEFT + slot * k + slot / 2;

  // Gold panel: gridlines, his line with dots, the teacher's dashed line.
  const top = niceMax(Math.max(10, teacher?.tests.goldOut ?? 0, ...shown.map((p) => p.goldOut)));
  const gy = (v: number) => goldTop + PANEL - (v / top) * PANEL;
  for (const v of [0, top / 2, top]) {
    svg.append(s('line', { x1: LEFT, x2: W - RIGHT, y1: gy(v), y2: gy(v), stroke: CHART.grid, 'stroke-width': 1 }),
      text(LEFT - 4, gy(v) + 3.5, String(v), { 'text-anchor': 'end' }));
  }
  if (teacher) {
    const y = gy(teacher.tests.goldOut);
    svg.append(s('line', { x1: LEFT, x2: W - RIGHT, y1: y, y2: y, stroke: CHART.teacher, 'stroke-width': 2, 'stroke-dasharray': '5 4' },
      s('title', {}, `${teacher.label}: ${fmt(teacher.tests.goldOut)} gold out on the same raids`)));
  }
  const d = shown.map((p, k) => `${k ? 'L' : 'M'} ${cx(k).toFixed(1)} ${gy(p.goldOut).toFixed(1)}`).join(' ');
  svg.append(s('path', { d, stroke: CHART.his, 'stroke-width': 2, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  shown.forEach((p, k) => svg.append(s('circle', { cx: cx(k), cy: gy(p.goldOut), r: 4, fill: CHART.his, stroke: CHART.surface, 'stroke-width': 2 })));
  const last = shown[shown.length - 1];
  svg.append(text(cx(shown.length - 1) + 8, gy(last.goldOut) + 3.5, fmt(last.goldOut), { fill: '#262321', 'font-weight': 600 }));

  // Ends panel: stacked columns with a 2px gap between parts, the teacher's "left with gold" share dashed.
  const ey = (v: number) => endsTop + PANEL - v * PANEL;
  for (const v of [0, 0.5, 1]) {
    svg.append(text(LEFT - 4, ey(v) + 3.5, pct(v), { 'text-anchor': 'end' }));
  }
  shown.forEach((p, k) => {
    const x = cx(k) - barW / 2;
    const parts = ENDS.filter((e) => p[e.key] > 0);
    let at = 0;
    parts.forEach((e, i) => {
      const y0 = ey(at);
      at += p[e.key];
      const gap = i < parts.length - 1 ? 2 : 0;
      const hgt = y0 - ey(at) - gap;
      if (hgt > 0.5) svg.append(s('rect', { x, y: ey(at) + gap, width: barW, height: hgt, fill: e.fill }));
    });
  });
  if (teacher) {
    const y = ey(teacher.tests.left);
    svg.append(s('line', { x1: LEFT, x2: W - RIGHT, y1: y, y2: y, stroke: CHART.teacher, 'stroke-width': 2, 'stroke-dasharray': '5 4' },
      s('title', {}, `${teacher.label}: left with gold in ${pct(teacher.tests.left)} of the same raids`)));
  }

  // Where the kind of training changed.
  shown.forEach((p, k) => {
    if (k === 0 || p.phase === shown[k - 1].phase) return;
    const x = LEFT + slot * k;
    svg.append(s('line', { x1: x, x2: x, y1: goldTop, y2: endsTop + PANEL, stroke: CHART.axis, 'stroke-width': 1 }),
      text(x + 3, endsTop + PANEL + 12, p.phase, { 'font-style': 'italic' }));
  });

  // The x-axis: raids trained so far, and a hover target per column over both panels.
  svg.append(
    s('line', { x1: LEFT, x2: W - RIGHT, y1: ey(0) + 0.5, y2: ey(0) + 0.5, stroke: CHART.axis, 'stroke-width': 1 }),
    text(LEFT, height - 4, String(shown[0].x)),
    text(W - RIGHT, height - 4, `${last.x} raids trained`, { 'text-anchor': 'end' }));
  shown.forEach((p, k) => {
    const tip = `After ${p.x} raids of training (${p.phase}): ${fmt(p.goldOut)} gold out; left with gold ${pct(p.left)}, ` +
      `left with none ${pct(p.leftNoGold)}, locked in ${pct(p.lockedIn)}, knocked out ${pct(p.knockedOut)}`;
    svg.append(s('rect', { x: LEFT + slot * k, y: goldTop, width: slot, height: endsTop + PANEL - goldTop, fill: 'transparent', class: 'hit' },
      s('title', {}, tip)));
  });
  fig.append(legend(teacher));
  return fig;
}

function legend(teacher?: TeacherLine): HTMLElement {
  return h('figcaption', { class: 'chart-legend' },
    legendItem(lineKey(CHART.his), 'Him'),
    teacher ? legendItem(lineKey(CHART.teacher, true), teacher.label) : null,
    ...ENDS.map((e) => legendItem(swatch(e.fill), e.label)));
}

/** The judges' mean scores per 25 practice raids, one line per judge he has practised with. */
export function scoreChart(points: readonly ScorePoint[]): HTMLElement {
  const height = PANEL + 34;
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, width: '100%', class: 'chart-svg', role: 'img', 'aria-label': 'The judge\'s score' });
  const fig = h('figure', { class: 'chart' }, svg);
  const top = 10;
  if (!points.length) {
    svg.append(text(W / 2, top + PANEL / 2, 'No practice yet', { 'text-anchor': 'middle', 'font-size': 12 }));
    return fig;
  }
  const xs = points.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(xMin + 1, ...xs);
  const yMax = Math.max(0.1, ...points.map((p) => p.y));
  const yTop = Math.ceil(yMax * 10) / 10;
  const X = (x: number) => LEFT + ((x - xMin) / (xMax - xMin)) * (W - LEFT - RIGHT);
  const Y = (y: number) => top + PANEL - (y / yTop) * PANEL;
  for (const v of [0, yTop / 2, yTop]) {
    svg.append(s('line', { x1: LEFT, x2: W - RIGHT, y1: Y(v), y2: Y(v), stroke: v ? CHART.grid : CHART.axis, 'stroke-width': 1 }),
      text(LEFT - 4, Y(v) + 3.5, v.toFixed(v < 1 ? 2 : 1), { 'text-anchor': 'end' }));
  }
  const used = JUDGES.filter((j) => points.some((p) => p.judge === j));
  for (const j of used) {
    // A judge's points in runs: a gap where another judge scored.
    let d = '';
    let prev: ScorePoint | null = null;
    for (const p of points) {
      if (p.judge !== j) { prev = null; continue; }
      d += `${prev ? 'L' : 'M'} ${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)} `;
      prev = p;
    }
    svg.append(s('path', { d, stroke: JUDGE_COLORS[j], 'stroke-width': 2, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' },
      s('title', {}, `${JUDGE_LABELS[j]}: the judge's score`)));
  }
  const last = points[points.length - 1];
  svg.append(
    s('circle', { cx: X(last.x), cy: Y(last.y), r: 4, fill: JUDGE_COLORS[last.judge], stroke: CHART.surface, 'stroke-width': 2 },
      s('title', {}, `${JUDGE_LABELS[last.judge]}: ${last.y.toFixed(2)} after ${last.x} practice raids`)),
    text(LEFT, height - 4, String(xMin)),
    text(W - RIGHT, height - 4, `${xMax} practice raids`, { 'text-anchor': 'end' }));
  if (used.length > 1) fig.append(h('figcaption', { class: 'chart-legend' }, ...used.map((j) => legendItem(lineKey(JUDGE_COLORS[j]), JUDGE_LABELS[j]))));
  return fig;
}
