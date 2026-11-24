/** Numbers and words for the Raid alone tab, with no DOM (tested directly). */

/** The boldness dial (sampling temperature): range and step. The default is in `settings.ts`. */
export const BOLDNESS = { min: 0.1, max: 2.5, step: 0.1 } as const;

export type Speed = 'slow' | 'normal' | 'fast';
/** Autoplay speeds: milliseconds a turn, and how long a thought is held compared with `readMs`. */
export const SPEEDS: readonly { id: Speed; label: string; ms: number; read: number }[] = [
  { id: 'slow', label: 'Slow', ms: 600, read: 1.25 },
  { id: 'normal', label: 'Normal', ms: 300, read: 1 },
  { id: 'fast', label: 'Fast', ms: 100, read: 0.6 },
];

/** How long a thought stays up while he plays on: long enough to read, between 1.1 s and 3.5 s. */
export function readMs(lines: readonly string[]): number {
  const chars = lines.reduce((a, l) => a + l.length, 0);
  return Math.min(3500, Math.max(1100, 500 + 45 * chars));
}

/** The next raid number for a dungeon code: 1, 2, 3… (each code counts on its own). */
export function nextRaidNumber(seen: Map<string, number>, code: string): number {
  const n = (seen.get(code) ?? 0) + 1;
  seen.set(code, n);
  return n;
}

/** The action bars' labels, in action order. */
export const ACTION_LABELS = ['Up', 'Right', 'Down', 'Left', 'Pick up', 'Drink', 'Light torch', 'Leave', 'Wait'] as const;
/** A short mark for each action: arrows for the moves, for the bars and the memory strip. */
export const ACTION_MARKS = ['↑', '→', '↓', '←', 'pick', 'drink', 'torch', 'leave', 'wait'] as const;

/** A probability as a percentage: "<1%" for the tiny ones, so a bar never reads as impossible. */
export function percent(p: number): string {
  if (p <= 0) return '0%';
  if (p < 0.005) return '<1%';
  return `${Math.round(p * 100)}%`;
}
