# Barbarian LM — Phase one build plan

How phase one of [`design.md`](design.md) gets built. Each step is one pull request into `main`, with its tests, and it updates the design doc wherever the build settles a number or a rule. Steps 1–7 are game logic only (no DOM, tested directly), so the rules can be measured before any UI exists.

## Random streams

Every random number comes from `rng.ts` (Karkulka's mulberry32 and FNV hash), on a separate stream per purpose, so one never shifts another:

| Stream | Seed label (n = raid number) | Used for |
| --- | --- | --- |
| Dungeon | `code` | Layout, contents, monster flags |
| Event spots | `code|events` (fixed) or `code|events|n` (new every raid) | Where the hidden events are |
| Actions | `code|n|act` | Sampling his next action |
| Monsters | `code|n|monsters` | Wandering |
| Events and thoughts | `code|n|story` | Event chances, thought lines, the saga |

A test checks the promise from CLAUDE.md: with events on and off, the same raid takes the same actions up to the first event with an effect.

## Steps

### 0. Project setup

- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` and `.github/workflows/deploy.yml` carried over from Karkulka; `rng.ts` copied as is.
- An empty app shell that builds; `npm test` and `npm run build` pass.
- **Needs you:** in the repository settings, set Pages to deploy from GitHub Actions, and let the `github-pages` environment deploy from `main`.

### 1. Dungeon generator — `src/dungeon.ts`

- 20 × 20 grid, bedrock ring, rooms cut from stone, joined by corridors (a spanning tree plus a few extra links so there are loops).
- Stairs in a room; **depth** = walking distance from the stairs.
- Contents by depth: gold and tougher monsters further away, trolls guarding the deepest rooms, rich flag on about 1 in 4, potions, torches, strength, vigour, spike traps.
- Cracked walls where a short dig saves many steps.
- **Tests:** same code gives the same dungeon; every open tile is reachable from the stairs without digging; bedrock ring intact; one stairs; contents grow with depth.
- **Measure** (a script over 1,000 codes): rooms, open tiles, dead ends, gold total and by depth, monsters by kind, cracked walls and the steps they save. First numbers go into the design doc.
- **Done:** the generator steps and first numbers are in the design doc. `npm run dungeon -- CODE` prints a dungeon as text; a fingerprint test fails whenever the generator changes what a code gives.

### 2. World rules — `src/world.ts`, `src/sight.ts`, `src/monsters.ts`

- State (map, his stats, monsters, time, torch) and `step(state, action)` following the turn order exactly.
- Bump to walk, attack and dig; pickups and full packs; drink; light torch; Leave only on the stairs and ending at once; traps; gold drops (merge, or nearest empty floor in the fixed order).
- One sight function for him and the monsters, tie rule included.
- Monsters: side-only adjacency, notice (range 3 / 5 lit, line of sight), chase by shortest path, wander, where they may step.
- `allowedActions(state)` for "Block impossible actions".
- **Tests:** one per rule, the 5 × 5 sight table cell by cell, sight symmetry over random dungeons, a full scripted raid.

### 3. Tokens — `src/tokens.ts`

- Buckets for the pinned stats, stairs compass with "here", the 5 × 5 view (19 numbers a cell), memory of 1 / 3 / 6 pairs.
- `SAVE_VERSION` lives here or in `storage.ts` from the start.
- **Tests:** sizes 43 / 475 / 484 and 1,002 / 1,970 / 3,422 (485 and 1,003 / 1,973 / 3,428 since step 5 added Wait); every bucket edge; the view with a monster on an item.

### 4. Model — `src/model.ts`

- Karkulka's network with 8 outputs (9 since step 5), softmax with temperature, Adam and SGD, sparse forward and backward.
- **Tests:** gradients against finite differences; learns a toy mapping.

### 5. Teachers — `src/teachers.ts`

- A shared planner over the tiles a teacher has seen this raid: shortest paths with walking, digging (at his real attack, or one blow for the pickaxe dwarf) and fight costs; re-plans every turn; time needed to walk back.
- The six teachers as rule sets on top of the planner.
- **Measure** over 1,000 codes per teacher: gold out, left / knocked out / locked in, turns, potions, torches, digs. This is the main tuning checkpoint for HP, monster stats, time limit and torch length. Target shape: the healer leaves almost always; the warrior earns more but is knocked out more often; the thief earns less but safely; the dwarf beats the healer; the pickaxe dwarf wastes turns when copied; the goblin in disguise loses where trolls are in sight. Settle the "Wait" question here. **Settled:** Wait is the 9th action; the start is 14 HP and 2 potions (see the design).

### 6. Training and evaluation — `src/train.ts`, `src/raid.ts`, `src/raids.ts`, `src/worker.ts`

- `raid.ts`: a raid alone, one sampled action at a time, with boldness and the block option.
- Lessons (imitation from the chosen teacher) and practice (policy gradient, three judges), in the worker, as in Karkulka.
- `raids.ts`: Many raids and its counts. Count "left with no gold" apart from "left": a player that takes Leave on the first turn otherwise looks safe.
- **Measure:** gold out after lessons from each teacher, at each memory size; practice with each judge (gold out should rise; gold picked up should hoard and get locked in; monsters beaten should pick fights). Before/after numbers go into the PR.

### 7. Events, thoughts and saga — `src/events.ts`, `src/data/events.json`, `src/thoughts.ts`, `src/saga.ts`

- About 25 events with Karkulka's shape, places and spots, the five effects with quiet versions.
- Thoughts after actions, by how sure he was and what happened.
- The saga with true sentences, borrowed events, boasts and fantasy by boldness.
- **Tests:** the data file's shape; spot placement rules; the random-stream promise above; the saga never makes up the ending or the gold.

### 8. UI — `src/ui/`

Built in a few PRs:

1. Shell, tabs, board with original SVG symbols (tiles, monsters with HP and gold, dimmed dark cells, wounded shape), settings.
2. Lessons and Practice with progress charts.
3. Raid alone: action bars (blocked ones struck through), memory strip, thought bubble, saga, speed and autoplay, damage and coin pop-ups.
4. Many raids, Inside the model, AI idea cards.
5. Save and links, hall of fame, dungeon of the day.

### 9. Tune and polish

A last pass with numbers across many codes; resolve the remaining open questions; mark the design doc as built.

## Order of risk

The step most likely to send the design back is 5: whether the teachers, seeing only what he sees, play well enough and differently enough. That is why it comes before training and UI, and why it carries the biggest measuring pass.
