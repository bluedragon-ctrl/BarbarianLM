/** The player's settings and their defaults (see "Visuals" and the open questions in docs/design.md). */
import type { MemoryName } from '../tokens';

export interface Settings {
  /** How much he remembers: fixed before lessons, since it sets the model's size. */
  memory: MemoryName;
  /** Lessons and practice in the dungeon on screen (with its treasure, or new treasure every raid), or a new dungeon every raid. */
  trainIn: 'shown' | 'treasure' | 'new';
  /** Hidden events on raids alone and many raids (the code keeps them off unless asked). */
  events: boolean;
  /** New event spots every raid, or the same ones for every raid of a dungeon code. */
  newSpots: boolean;
  /** Draw the event spots on the board. */
  showEvents: boolean;
  /** His thoughts on a raid alone. */
  thoughts: boolean;
  /** The boldness dial on a raid alone: the sampling temperature. */
  boldness: number;
  /** "Block impossible actions" on a raid alone: constrained decoding. */
  block: boolean;
  /** Dim and hatch the cells he does not see. */
  dim: boolean;
  /** The torchlight flickers. */
  flicker: boolean;
  /** Pools where monsters are beaten and the prints he leaves after walking through one. */
  fightMarks: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  memory: 'medium',
  trainIn: 'shown',
  events: true,
  newSpots: true,
  showEvents: false,
  thoughts: true,
  boldness: 0.5,
  block: false,
  dim: true,
  flicker: true,
  fightMarks: true,
};
