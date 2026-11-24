import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/ui/settings';

describe('UI settings', () => {
  it('defaults as the design says: events on, training in the dungeon on screen, medium memory', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ events: true, newSpots: true, showEvents: false, trainIn: 'shown', memory: 'medium', dim: true, flicker: true, fightMarks: true });
  });
});
