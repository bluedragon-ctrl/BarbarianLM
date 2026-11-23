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
```

Run `npm test` and `npm run build` before every commit.

## Starting point

Karkulka's core carries over, adapted: `rng.ts` (seeded RNG), `model.ts` (one hidden layer, hand-written, here with 8 outputs), the training worker, charts, and the GitHub Pages deploy workflow. Its thoughts, hidden events and story (`thoughts.ts`, `storyEvents.ts`, `story.ts`) are the models for his thoughts, the dungeon events and the skald's saga.

Phase one is built in the steps of `docs/plan.md`, one pull request each: setup, dungeon generator, world rules, tokens, model, teachers, training and many raids, events, thoughts and saga, UI, tuning.

## Conventions

- **Every feature maps to a language-model idea.** Add it to the mapping table in `docs/design.md`. Explanation stays light: short captions, and an "AI idea" card only for the main ideas.
- **Original art only:** simple symbolic SVG shapes drawn in code. No tile packs, external images or resemblance to existing games.
- **Shape plus colour, never colour alone.** Red is reserved for danger (damage, low HP).
- **Child-friendly outcomes:** nothing graphic. Monsters turn into coins; the barbarian is knocked out and carried out.
- **Deterministic generation:** dungeons come only from the seeded RNG, so a dungeon code always gives the same dungeon. Changing the generator changes every existing code, so call that out in the pull request.
- **Hidden events and thoughts have their own randomness, never the raid's:** turning them off, or changing their wording, never changes which actions are sampled, how monsters move or what the dungeon holds. Thoughts change nothing. The few events with an effect change his stats on purpose: the model sees the result but never the cause.
- **Tune with numbers:** when changing the generator, rewards or training, measure across many dungeon codes and put before/after numbers in the pull request.
- Game logic has no DOM dependencies and is tested directly; the UI lives in `src/ui/`.
- Keep UI text plain and short.

## Things to remember

- **Changing the tile kinds, monster flags, pinned tokens or actions changes the model's input or output size and breaks old saves:** bump the save version and update the tests that check sizes.
- **Training runs in the worker**; any main-thread training path must use the same functions.
