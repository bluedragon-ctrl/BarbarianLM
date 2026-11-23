# Barbarian LM

A browser game that shows how language models work: a barbarian raids a dungeon one predicted action at a time, the way a language model writes one predicted token at a time. A follow-on to [Red Riding Hood LM](https://github.com/bluedragon-ctrl/Karkulka).

**Design and plans:** [`docs/design.md`](docs/design.md) is the source of truth for how the game works; [`docs/plan.md`](docs/plan.md) is the build plan for phase one.

## Run it

```sh
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run build   # typecheck + production build to dist/
```

Every push to `main` is tested, built and published to GitHub Pages.
