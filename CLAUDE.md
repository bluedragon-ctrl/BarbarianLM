# Barbarian LM

A browser game that shows how language models work: a barbarian raids a dungeon one predicted action at a time, the way a language model writes one predicted token at a time. A follow-on to Red Riding Hood LM (`bluedragon-ctrl/Karkulka`): Karkulka is the entry-level lesson, Barbarian is a fun showcase for older kids and adults curious about AI. Static TypeScript site (Vite), no server, published to GitHub Pages.

**`docs/design.md` is the source of truth for the design.** Read it before changing game behaviour, and update it in the same pull request as the change. Its phase-two ideas and open questions are the backlog.

## Commands

```sh
npm install
npm run dev        # local dev server
npm test           # vitest unit tests
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build to dist/
npm run dungeon -- CODE        # print a dungeon as text (--map: also its map code)
npm run measure:dungeons -- N  # generator numbers over N codes (default 1,000)
npm run measure:compass -- N   # stairs-compass distances over N codes
npm run measure:model -- N     # model speed per example at each memory size
npm run measure:teachers -- N  # each teacher over N codes (--no-wait, --try 'name:{json}', --rules '{json}')
npm run measure:training -- L P T  # L lessons per teacher and memory, P practice raids per judge, T test codes
npm run measure:events -- N    # event spots and what each teacher meets over N codes (--show CODE [teacher] [boldness])
```

Run `npm test` and `npm run build` before every commit. Tool scripts in `tools/` run through Vite (`tools/run.mjs`), so they import the game's modules as the app does.

## How the code fits together

| Module | Purpose |
| --- | --- |
| `src/rng.ts` | Seeded random numbers, one stream per purpose (see `docs/plan.md`) |
| `src/tiles.ts` | Tile kinds, what each shows as in his view, monster kinds and stats |
| `src/dungeon.ts` | Seeded dungeon generator, walking distances, how many steps a dig saves |
| `src/mapCode.ts` | Hand-made dungeons: map codes (`~2…`) and `dungeonFromCode` for any code, painting, limits and checks for the editor |
| `src/world.ts` | A raid's state, `step(state, action, monsterRng)` in the design's turn order, `allowedActions`, his view |
| `src/sight.ts` | The one sight rule for him and the monsters, his 5 × 5 view with dark cells |
| `src/monsters.ts` | What monsters do each turn: hit, notice, chase by shortest path (giving up after a few steps), wander |
| `src/tokens.ts` | What the model reads: pinned buckets, stairs compass, view and memory encoding as sparse one-hot indices, every input in words, `SAVE_VERSION` |
| `src/model.ts` | The network: sparse forward, softmax with temperature, masking, imitation and policy-gradient gradients, lazy Adam and SGD, saves |
| `src/teachers.ts` | The seven teachers (the champion is the dragonslayer): what each has seen, the shared planner (walking, digging, fights, the way back), their rules, `TeacherRaid` and `teacherRaid` |
| `src/raid.ts` | A raid alone: one sampled action a turn from the model (or played back from a script), boldness, "Block impossible actions", events, the per-turn record |
| `src/raids.ts` | Many raids and their counts, events met included |
| `src/explain.ts` | The twelve AI idea cards' words |
| `src/train.ts` | Lessons (imitation, Adam), practice (policy gradient, SGD, the three judges), test raids and the teachers' numbers on them, `runJob` for the worker |
| `src/events.ts`, `src/data/events.json` | Hidden events: the cast, thought and saga lines, places and spots, the five effects, `EventTracker` |
| `src/thoughts.ts` | His thoughts after actions, by how sure he was and what happened |
| `src/saga.ts` | The skald's saga: true sentences from the record, borrowed events, boasts and fantasy by boldness |
| `src/storage.ts` | Saving in the browser (settings, his model packed, the hall of fame), `#dungeon=CODE` links, model files, hall of fame entries and their replay scripts, the dungeon of the day |
| `src/worker.ts`, `src/workerClient.ts` | The Web Worker that runs `runJob`, and the page's side of it |
| `src/marks.ts` | Floor marks for the board: pools where monsters fall, his prints after walking through one |
| `src/ui/` | The page: `app.ts` (tabs, panels, settings, walking him yourself, watching a lesson), `board.ts` (the SVG board, light, effects), `symbols.ts` (the original shapes), `settings.ts` (defaults), `trainer.ts` (his model, its stats and the worker jobs), `training.ts` (the Lessons and Practice panels), `charts.ts` (their charts), `raidAlone.ts` (the Raid alone tab: bars, dial, play, saga), `raidPlay.ts` (its numbers and words, no DOM), `strip.ts` (the memory strip), `editor.ts` (the dungeon editor's panel), `many.ts` (the Many raids tab), `inside.ts` (the Inside the model tab), `aiCard.ts` (the AI badges and their popover cards), `dom.ts` |

## Starting point

Karkulka's core carries over, adapted: `rng.ts` (seeded RNG), `model.ts` (one hidden layer, hand-written, here with 9 outputs), the training worker, charts, and the GitHub Pages deploy workflow. Its thoughts, hidden events and story (`thoughts.ts`, `storyEvents.ts`, `story.ts`) are the models for his thoughts, the dungeon events and the skald's saga.

Phase one is built in the steps of `docs/plan.md`, one pull request each: setup, dungeon generator, world rules, tokens, model, teachers, training and many raids, events, thoughts and saga, UI, tuning.

## Conventions

- **Every feature maps to a language-model idea.** Add it to the mapping table in `docs/design.md`. Explanation stays light: short captions, and an "AI idea" card only for the main ideas.
- **Original art only:** simple symbolic SVG shapes drawn in code. No tile packs, external images or resemblance to existing games.
- **Shape plus colour, never colour alone.** Red is reserved for danger (damage, low HP).
- **Tone:** not horror, but not for small children either. Beaten monsters leave their coins and a faint pool (dark maroon, or teal for a slime), never gore; the barbarian is knocked out and carried out.
- **Deterministic generation:** dungeons come only from the seeded RNG, so a dungeon code always gives the same dungeon. Turn a code into a dungeon with `dungeonFromCode`, never `generateDungeon`, so hand-made map codes work everywhere. Changing the generator changes every existing code, so call that out in the pull request.
- **Hidden events and thoughts have their own randomness, never the raid's:** turning them off, or changing their wording, never changes which actions are sampled, how monsters move or what the dungeon holds. Thoughts change nothing. The few events with an effect change his stats on purpose: the model sees the result but never the cause.
- **Tune with numbers:** when changing the generator, rewards or training, measure across many dungeon codes and put before/after numbers in the pull request.
- Game logic has no DOM dependencies and is tested directly; the UI lives in `src/ui/`.
- Keep UI text plain and short.

## Things to remember

- **Changing the tile kinds, monster flags, pinned tokens or actions changes the model's input or output size and breaks old saves:** bump the save version and update the tests that check sizes.
- **Training runs in the worker**; any main-thread training path must use the same functions.
