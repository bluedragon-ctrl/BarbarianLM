# Barbarian LM — Design (draft)

This file is the source of truth for the game's design. Update it in the same pull request as any change to how the game behaves.

**Status:** draft for phase one. Built so far: the dungeon generator, the world rules (`src/world.ts`, `src/sight.ts`, `src/monsters.ts`), the tokens (`src/tokens.ts`), the model (`src/model.ts`), the teachers (`src/teachers.ts`) and training and evaluation (`src/raid.ts`, `src/train.ts`, `src/raids.ts`, `src/worker.ts`). Numbers marked *(tune)* are first guesses, to be set by measuring across many dungeon codes.

## Purpose and audience

A browser game that teaches how language models work: a barbarian learns to raid a dungeon one predicted action at a time, the way a language model writes one predicted token at a time. It follows on from Red Riding Hood LM (Karkulka) and adds what that game cannot show: a world that answers back between actions, more kinds of output, actions that use items, and deciding when to stop.

- **Audience:** older kids and adults without a technical background who are curious about AI. A final tab serves technical users.
- **Setting:** a desktop browser, classroom projector or laptop. The UI is in English.
- **Tone:** nothing graphic. Monsters that lose turn into coins; the barbarian is "knocked out" and carried out by the dungeon keeper.
- **A showcase, not a course.** Karkulka is the entry-level lesson; Barbarian is meant to be fun to watch and play with. Explanation stays light: short captions, and an "AI idea" card only for the main ideas (see [Explanation](#explanation-light-touch)). The fun parts (his thoughts, hidden dungeon events, the skald's saga) carry the ideas on their own.

## Core concept

Every action is a token. What he sees around him is an input token, and the action he takes is an output token. His context is the recent alternating sequence of both:

`[HP] [max HP] [attack] [potions] [torches] [torch lit] [gold] [time] [stairs] | [view] [action] [view] [action] [view] → next action?`

The tokens before the bar are **pinned**: they describe him now and never scroll out. The model reads the context and outputs a probability for each of the 9 actions. One is sampled, he takes it, **the dungeon answers** (monsters move and hit, the torch burns down, time passes), he sees a new view, and the loop repeats until he leaves, is knocked out, or the gate closes.

The goal: enter by the stairs, gather gold, and **leave by the stairs** with as much as possible. Gold counts only if he gets out.

### Mapping table

| In the game | In a language model |
| --- | --- |
| A view of his surroundings | An input token |
| An action (9 kinds) | An output token from a vocabulary of 9 |
| Memory strip of recent views and actions | The context window |
| Memory size (short, medium, long) | Context length, fixed before training |
| Thickness of the action bars | Next-token probabilities |
| Boldness dial | Sampling temperature |
| Pinned stats (HP, attack, gold, potions, torches, time) | A system prompt or state that is always in the context |
| Stats in buckets ("HP: low") instead of exact numbers | Numbers are chopped into tokens, which is why models are bad at exact arithmetic |
| "Leave" on the stairs | The end-of-sequence token: deciding when the answer is finished |
| "Wait": stand still and let the monster come to him | An agent's output that does nothing itself but lets the world answer first |
| Gold lost if he is knocked out or locked in | An answer that is cut off or goes wrong at the end is worth nothing, however good its start |
| The gate closes at sundown (time limit) | Maximum output length |
| Monsters move and hit back after each action | An agent loop: the model acts, the world (a tool, a user) answers, and the answer joins the context |
| The same "move right" token walks, attacks or digs, depending on what is there | A token's effect depends on its context |
| Pick up, drink a potion, light a torch | Tool calls: outputs that do something instead of moving the answer on |
| Dark cells outside the torchlight | Missing information: tokens the model never got |
| A torch shows more of the dungeon for a while, and he has few of them | Retrieval or a search tool: pays a cost to bring more into the context |
| Actions that cannot work (picking up from bare floor, drinking with no potions, bumping bedrock) | Invalid outputs; with "Block impossible actions", constrained decoding |
| The stairs compass | A hint in the prompt |
| Each memory slot has its own inputs, so the newest pair always sits next to the view now | Position information: a model must be told where in the context each token is |
| Lessons from a teacher | Pretraining on example text |
| Choice of teacher | Training data and the values of whoever made it |
| The goblin in disguise as a teacher | Data poisoning |
| The champion gathers strength and vigour before taking on trolls | An agent gathering tools or context before a hard task |
| The dwarf with his own pickaxe (digs in one blow; the barbarian needs several) | Distillation from a stronger model: the student copies moves it cannot really do |
| Teachers remember the whole map they have seen; he remembers only his memory strip | The examples were written by someone who knew more than the context shows |
| Practice judged by gold carried out | Fine-tuning with a reward (reinforcement learning) |
| Practice judged by gold picked up: he hoards and never leaves | Reward hacking |
| Practice judged by monsters beaten: he picks fights | A reward that measures the wrong thing |
| Training in one dungeon, or each raid in a new one | Training on one text (memorising it) or a broad corpus (learning to generalise) |
| Parameters grow with memory size here | In a real transformer they do not: attention reuses the same weights for any context length |
| A cell in his view is one thing plus flags (a goblin, wounded, rich) | A token's embedding packs several properties at once |
| A lit torch shows more, but monsters notice him from further away | Bringing more into the context is not free: it can pull in trouble too |
| Each input that is on adds its own row of weights to the hidden layer | An embedding table: a token picks out its own row of numbers |
| His thoughts ("Goblin to the east! Smash!"), made up after the action is picked | Models narrating their reasons: an account of why is not the real cause |
| Hidden dungeon events: he cannot see them and no judge scores them | What is not in the input and not rewarded never changes what a model does |
| The events that do change his stats (a bat snatches a coin) | Things outside the model's view still change how its answer turns out |
| The skald's saga after a raid: true parts from the raid, made-up parts by boldness | Hallucination: invented details told as confidently as facts |

## Dungeon and rules

### The dungeon

- **Size:** 20 × 20 *(tune)*, rooms joined by corridors, from a seeded generator: a dungeon code always gives the same dungeon.
- **Bedrock** rings the edge and cannot be broken. Inside, rooms are cut out of **stone wall**.
- **Stairs:** one, in a room. He starts on them.
- **Riches grow with distance:** rooms far from the stairs hold more gold and tougher monsters, so going deep is a real risk.
- **Cracked walls** are placed where a short dig saves many steps (the dwarf's shortcuts).

**How the generator builds it** (`src/dungeon.ts`; numbers *(tune)*):

1. Up to 8 rooms of 3–5 × 3–5 tiles, never touching (at least one wall between two rooms).
2. Corridors: an L-shaped corridor joins each room to its nearest already joined room (a spanning tree), then 2 extra corridors between nearby rooms make loops.
3. Stairs inside one of the rooms that reach deepest, so there is always a long way to go.
4. Cracked walls (3 HP), up to 3, at least 4 tiles apart, each where digging through saves at least 8 steps: first walls that already part two places far apart on foot; then *shortcut corridors* between two rooms that are close but far apart on foot, blocked in the middle by a cracked wall. Until it is dug, both halves are dead ends.
5. Contents by room depth (a room's average walking distance from the stairs, as a share of the deepest tile). The stairs room stays empty.
   - Near third: a pile of 3 gold, a rat half the time.
   - Middle third: two piles of 3, a goblin, a rat half the time.
   - Far third: a heap of 10 and a pile of 3, a slime, a goblin half the time.
   - The deepest room: a troll standing next to the heap of 10 it guards, and a second heap.
   - 1 monster in 4 is rich. No monster starts within 5 steps of the stairs; monsters start on bare floor.
   - 2 potions in mid-depth rooms, 2 torches (one near, one mid). 2 strength (one in the middle, depth 0.3–0.7, one deep, 0.6–1) and 2 vigour (0.2–0.6 and 0.5–1), never in the troll's room. One of each is closer and one deeper, so he weighs a longer, riskier trip for both against a shorter one for one; with both he can take on a slime or a troll. *(Two of each since step 6, from one; this changed every dungeon code.)* A later dungeon editor may set more or fewer.
   - 4 spike traps in corridors, at least 3 steps from the stairs and never side by side.

**First numbers** (1,000 codes, `npm run measure:dungeons`; mean, with min–max):

| | |
| --- | --- |
| Rooms | 7.9 (5–8) |
| Open tiles | 147 (102–180), of them corridor 30 (11–60) |
| Dead ends | 2.6 (0–6) |
| Deepest tile (steps from the stairs) | 30 (20–49) |
| Gold in the dungeon | 113 (57–170): 62 in piles, 50 on monsters |
| Gold by depth (near / middle / far third) | 6 / 35 / 72 |
| Monsters | 2.2 rats, 3.8 goblins, 1.5 slimes, 1 troll; 2.1 rich |
| Nearest monster from the stairs | 9 steps (5–19) |
| Cracked walls | 1.8 (0–3); none in 9% of dungeons; each saves 23 steps (8–52) |

Walking to the deepest tile and back takes about 60 of the 200 turns, before any fight or detour.

### Tiles (13 kinds in a view)

| Kind | What it does |
| --- | --- |
| Floor | Walkable |
| Stone wall | Not walkable; 6 HP *(tune)*; bumping it deals his attack as damage; at 0 it becomes floor |
| Cracked wall | A stone wall with 3 HP or less (placed by the generator, or one he has damaged) |
| Bedrock | Unbreakable; bumping it wastes the turn ("Clang!") |
| Stairs | Where he starts; "Leave" works only here |
| Spike trap | Visible; walkable; 2 damage *(tune)* to whoever steps on it, each time: him, or a monster chasing him |
| Small gold | A pile of 3 gold; "Pick up" adds it |
| Gold heap | A heap of 10 gold *(tune)*; "Pick up" adds it |
| Potion | "Pick up" puts it in his pack (at most 3) |
| Torch | "Pick up" puts it in his pack (at most 3) |
| Strength | "Pick up": +1 attack, for the rest of the trip |
| Vigour | "Pick up": +4 max HP *(tune)* and full HP |
| Dark | Out of sight (see [Sight and torches](#sight-and-torches)) |

One thing per tile, plus at most one monster on top. A monster standing on an item hides it in his view. Gold piles hold any amount: a pile shows as small gold below 6 and as a heap from 6, and the board shows the exact amount on every pile.

### Monsters (4 kinds, each with two flags)

Each kind has fixed numbers. Damage is fixed: **attack is the damage dealt**, no dice.

| Monster | Attack | HP | Gold (normal / rich) | Moves |
| --- | --- | --- | --- | --- |
| Rat | 1 | 2 | 1 / 3 | Mobile |
| Goblin | 2 | 4 | 3 / 9 | Mobile |
| Slime | 3 | 6 | 5 / 15 | Immobile |
| Troll | 4 | 12 | 12 / 36 | Immobile (guards the rich rooms) |

*(All tune.)* Each monster has two flags the model sees:

- **Wounded:** at or below half HP (so a goblin at 2 of 4 shows as wounded).
- **Rich:** carries three times the usual gold (about 1 monster in 4 *(tune)*; drawn with a loot sack). So kind plus flag tells exactly what it is worth.

**Monsters show what they are worth.** The board draws each monster with its HP (bar and number) and its gold (coin and number).

- **Next to** means sharing a side (up, down, left or right), never a diagonal: monsters hit and step only in the 4 directions he can.
- **Mobile:** if next to him, it hits him. Otherwise, if it **notices** him, it steps towards him; otherwise it wanders (seeded). It notices him within 3 tiles, or **5 tiles while his torch is lit** *(tune)*, and only with a clear line of sight (below).
  - **Stepping towards him:** by a shortest path over tiles a chasing monster may step on, where a spike trap counts as 2 steps (other monsters are ignored, since they move). So it goes round a trap when the way round is just as short, and otherwise steps on and takes the 2 damage. Of its free side neighbours on a shortest way it takes the first in the order up, right, down, left. If none is free (no way to him, or the way is taken by another monster), it waits.
  - **Losing interest** *(tune)*: after 5 steps of chasing him, it gives up and wanders for 6 turns, not noticing him (it still hits him if he stands next to it). Losing sight of him ends a chase too, and the count starts again. Before this a rat or goblin that noticed him followed him for good, so every chase ended in a fight; now he can walk away. The teachers measure the same either way (with these stats a rat or goblin costs at most 2 HP to beat, so they fight it rather than run), but a student who runs is not chased forever. Added with the teachers' review for the buffs.
  - **Wandering:** one draw from the monster stream per wandering monster per turn: up, right, down, left or stay, one in 5 each. If that tile is not free for it (traps included), it stays. Wanderers stay put about 4 times in 10, so monsters linger in rooms; if they turn out too easy to dodge, draw only among the free tiles instead.
  - **Beaten by a trap:** it runs off and drops no gold (gold drops only when he beats it). Like him, it is hurt only when it steps onto the trap, not while it stands there.
- **Immobile:** hits him if he is next to it; never moves.
- **Acting order:** the order the generator placed them in, fixed for the raid. Each acts on what the ones before it left, so the first to move takes a tile two want.
- **Where monsters may step:** floor and any item (in a corridor there is no way round); spike traps only while chasing him. Never onto the stairs (so the way out is never blocked), walls, him or another monster. They never pick anything up. Traps in corridors used to wall monsters off from 41% of the dungeon: so a trap slows a chase and can hurt the chaser, but never makes a safe zone.
- **Beaten:** it drops its gold on its tile (rats too: a rat's pile is 1). On bare floor that makes a new pile; on gold the amounts add up (a heap from 6). If the tile holds another item (potion, torch, strength, vigour), the gold goes to the nearest empty floor tile, searched in a fixed order (up, right, down, left, then further out), so nothing is lost and the result is deterministic. "Nearest" is breadth-first over open tiles from the monster's tile, and "empty" means bare floor: gold never lands on stairs, traps or other items, but may land under him or another monster.

### The barbarian

| Stat | Start | Notes |
| --- | --- | --- |
| HP / max HP | 14 / 14 *(tuned in step 5, from 12)* | 0 HP: knocked out, all gold lost |
| Attack | 2 | Damage to monsters and walls per bump |
| Potions | 2 *(tuned in step 5, from 1)* | Drinking heals 6 *(tune)*, up to max HP |
| Torches | 1 | Lighting one gives 15 turns of light *(tune)*, the turn it is lit included |
| Gold | 0 | Counts only if he leaves |
| Time | 200 turns *(tuned with the buffs, from 150)* | At 0 the gate closes: he is locked in, the keeper lets him out in the morning and keeps the gold |

### Actions (9 output tokens)

| Token | Effect |
| --- | --- |
| Up, Right, Down, Left | **Bump:** walk onto an open tile; attack a monster there; damage a wall there; bedrock: nothing |
| Pick up | Takes what lies on his tile; on bare floor (or the stairs, or a trap), nothing; a potion or torch with that one full in his pack, nothing |
| Drink | Drinks a potion; with none, nothing |
| Light torch | Lights a torch; with none, or one already burning, nothing |
| Leave | Works only on the stairs: the trip ends at once and the gold is his. Elsewhere, nothing |
| Wait | Does nothing on purpose: the turn passes (torch, time, monsters) while he stands still. Never blocked |

Every action, useful or not, takes one turn. An action that does nothing is a **wasted action**; these are exactly the ones "Block impossible actions" blocks. Digging is never wasted: every blow takes HP off the wall.

**Block impossible actions** (a checkbox on Raid alone and Many raids, off by default): before an action is sampled, the ones that would do nothing get probability 0 and the rest are scaled back up to 1. Blocked: picking up on bare floor, or a potion or torch with a full pack; drinking with no potions; lighting a torch with none or one burning; Leave off the stairs; bumping bedrock. Wait is never blocked: it does what it says. Wasteful but possible actions stay allowed (drinking at full HP; bumping a stone wall is digging). The bars still show what the model wanted, with blocked actions struck through. Lessons and practice never block, so he still has to learn not to waste turns, and Many raids can compare wasted actions with the box on and off.

### Turn order

1. He acts. If he left, the trip ends here: no trap, torch, time or monster step follows.
2. Traps: if he stepped onto a spike trap, it hits him.
3. The lit torch burns down a turn; time goes down a turn.
4. Each monster acts, in a fixed order.
5. If his HP is 0: knocked out. If time is 0: locked in. Knocked out wins when both happen.

HP never drops below 0. A trap that knocks him out at step 2 does not end the turn early: the torch, time and monsters still go, and the trip ends at step 5. The model is never asked for an action after the end.

### Sight and torches

- **Without light** he sees 1 tile around him (3 × 3).
- **With a lit torch** he sees 2 tiles around him (5 × 5).
- His view is always 5 × 5 to the model; whatever he cannot see is **dark** (one token for both "out of the light" and "behind a wall"). The view includes his own tile, so he can see what he is standing on.
- **One sight rule** for him and the monsters: a cell is seen if a line from tile centre to tile centre reaches it without passing through a wall (stone, cracked or bedrock; monsters do not block). Stepping along the line one tile at a time, where it passes exactly halfway between two tiles either may be taken, and one open is enough. The rule works the same both ways, so he and a monster differ only in range. In his 5 × 5 it gives: his 8 neighbours are always seen, and an outer-ring cell is seen if the cells between it and him are open:

| Outer cell (dx, dy) | Seen through |
| --- | --- |
| (±2, 0), (0, ±2) | the cell between, (±1, 0) or (0, ±1) |
| (±2, ±2) | the diagonal cell (±1, ±1) |
| (±2, ±1), (±1, ±2) | either of the two cells next to the line (one is enough) |

  A wall cell itself is seen when the line reaches it, so he sees the wall that blocks him.
- **Exactly:** for a line of n steps (n = the larger of |dx| and |dy|), at each step k between the ends the line sits at k/n of the way; on the axis where that is not a whole tile it takes the nearest tile, or both when it is exactly halfway (one open is enough at that step). Cells off the map are dark. "Within a square of r tiles" means at most r along each axis.
- Monsters notice him by the same rule within a square of 3 tiles around them, or 5 while his torch is lit. So in the dark a goblin can notice him from 3 tiles while he sees only 1: that is the missing information.
- **The torch** is lit while it has turns left. Lighting gives it 16, and step 3 of the turn order burns one off each turn, the turn it is lit included: so it is lit for the monsters' moves and his views on 15 turns, the one he lights it in included, and goes out at step 3 of the 16th. The turns left after step 3 are the lit views still to come, this one included, which is what the "burning low (≤ 3)" token reads. He can light a new one on the turn after it goes out.

### End of a trip and score

| End | Gold kept |
| --- | --- |
| Left by the stairs | All of it |
| Knocked out (HP 0) | None |
| Locked in (time 0) | None |

**Score** = gold carried out.

## Model and learning

### Input

| Part | Numbers |
| --- | --- |
| HP: 1–3, 4–6, 7–10, 11–15, 16+ | 5 |
| Max HP: up to 14 (the start), 15–19 (after vigour), 20+ | 3 |
| Attack: 2, 3, 4+ | 3 |
| Potions: 0, 1, 2, 3 | 4 |
| Torches: 0, 1, 2, 3 | 4 |
| Torch: off, burning low (≤ 3 turns), lit | 3 |
| Gold: 0, 1–5, 6–15, 16–30, 31+ | 5 |
| Time left: < 20, 20–49, 50–99, 100–149, 150+ (the last added with the 200-turn day) | 5 |
| Stairs compass: 8 directions or here (on the stairs), plus near / far / very far (none when here) | 12 |
| **Pinned, total** | **44** |
| View now: 25 cells × 19 (one-hot over 17 kinds: 13 tiles and 4 monsters, plus the wounded and rich flags) | 475 |
| Each remembered pair: present flag + view + action | 1 + 475 + 9 = 485 |

HP buckets are absolute so that "can I take this hit?" can be read straight from them against the monsters' attacks.

**How the tokens are built** (`src/tokens.ts`):

- **Bucket edges** are as in the table; a value below the first bucket counts in it (HP 0 never reaches the model, since the trip has ended). The torch reads its turns left after step 3 of the turn order, the lit views still to come with this one included: off at 0, low at 1–3, lit at 4+. So a fresh torch reads lit on 12 views, then low on 3.
- **Compass direction:** the nearest of the 8 compass directions to the straight line from his tile to the stairs, by angle (sectors of 45°, north up the screen). Sector edges lie at tan 22.5° = √2 − 1, which no whole-tile offset hits, so there are no ties. "Here" when he stands on the stairs, and then no distance.
- **Compass distance:** walking steps to the stairs over the raid's own map (dug walls count as floor; monsters and traps do not block): **near** under 10, **far** 10–19, **very far** 20+. Walking, not straight-line, because what he needs to know is how long the way back takes: over 1,000 codes the walk is 1.8 times the straight line on average and at least twice it on 28% of open tiles (`npm run measure:compass`). These edges split open tiles 29% / 40% / 30%, and they line up with the time buckets: very far with under 20 turns left means he cannot make it. The raid keeps these distances in its state (`stairsDist`), worked out at the start and again only when a wall is dug through, so the teachers' way back uses the same numbers.
- **Order of the inputs:** pinned (HP, max HP, attack, potions, torches, torch, gold, time, compass: 9 directions then near / far / very far), then the remembered pairs from oldest to newest, then the view now. A view is its 25 cells row by row from the top-left, each 17 kinds then wounded then rich. A pair is its present flag, its view, then the action he took on it (one-hot over 9).
- **Memory:** after each action, the view it was taken on and the action join the strip; once it is full the oldest pair drops out. The newest pair always sits in the last slot, next to the view now, so a slot always means the same number of turns ago. Slots not yet filled at the start of a raid are all zero, present flag included.
- **Sparse:** every input is 0 or 1, so an input is passed as the list of the ones that are 1, in increasing order: 9 or 10 pinned, about 27 per view, 29 per pair: about 115 for the medium memory.
- **Save version:** `SAVE_VERSION` in `src/tokens.ts`, bumped whenever these sizes or this order change: 2 since step 5 (Wait and the max-HP buckets).

### Network

One hidden layer, 48 units, tanh, softmax over 9 actions (as in Karkulka, hand-written, no ML library: `src/model.ts`).

| Memory | Remembered pairs | Inputs | Parameters | Active inputs (mean) |
| --- | --- | --- | --- | --- |
| Short | 1 | 1,004 | 48,681 | 62 |
| Medium (default) | 3 | 1,974 | 95,241 | 113 |
| Long | 6 | 3,429 | 165,081 | 187 |

Parameters are inputs × 48 + 48 + 48 × 9 + 9. Active inputs are measured on random walks through real dungeons (`npm run measure:model`).

- **Sparse:** the first layer is stored one row of 48 weights per input. Every input is 0 or 1, so the hidden layer is tanh of the bias plus the rows of the active inputs, and the backward pass adds to those rows only: the cost follows the ~100 active inputs, not the input size. Gradients are summed over a batch, remembering which rows were touched; the optimiser step visits and clears only those.
- **Starting weights:** from the seeded stream `model|<seed>`, so the same seed gives the same network. First layer uniform in ±0.1 (with ~113 inputs on, each hidden unit starts with a spread of about 0.6, in tanh's steep middle), second layer uniform in ±½·√(6 / (48 + 9)) ≈ ±0.16 (half Glorot, as in Karkulka), biases 0. The first probabilities are near even.
- **Probabilities:** softmax of the logits divided by the temperature (the boldness dial; at least 0.001, where it is argmax in all but name). **Block impossible actions** sets the blocked actions (`allowedActions`) to 0 and scales the rest back up to 1; the action bars still show the unmasked probabilities, struck through where blocked. Lessons and practice never mask.
- **Lessons:** loss −log p(teacher's action) at temperature 1, gradient p − one-hot. Adam, learning rate 0.01, β₁ 0.9, β₂ 0.999, ε 10⁻⁸, on the batch's mean gradient, no clipping. Adam keeps two moments per weight (760 KB at the medium memory) but is **lazy**: a first-layer row with no gradient in a batch is left alone, moments included, and each row is bias-corrected by its own count of updates, so a row first seen late in training gets the same careful first step as one seen at the start. The biases and the second layer get a gradient from every example and use the global count.
- **Practice:** loss −advantage · log p(sampled action), at temperature 1 (the sampling temperature only changes which actions get tried), gradient advantage · (p − one-hot). Plain SGD, learning rate 0.05, on the batch's mean gradient, shortened to length 1 when longer (Karkulka's). The advantage, its baseline and its clipping are the training loop's (see [Phase 2](#phase-2-practice-fine-tuning)).
- **Saves:** a plain object with `SAVE_VERSION`, inputs, hidden units, actions and the four weight arrays, each number kept to 9 significant digits (exact for 32-bit floats). Loading rejects another save version, another number of actions, an input size other than the memory size expects, or arrays that do not fit.
- **Speed** (one core, per example, a batch of 32 per optimiser step): forward 8 / 10 / 16 µs; a lesson example with its share of the Adam step 17 / 26 / 36 µs; a practice example with SGD 16 / 22 / 31 µs, for the short / medium / long memory. A raid of 200 turns trains in about 5 ms.

### Phase 1: lessons (imitation)

Teachers play the barbarian by hand-written rules (`src/teachers.ts`). **They see only what he could see**: the cells of his view that are not dark, turn by turn, and they remember every tile they have seen on this trip, as it was when last seen. A teacher who saw the whole map would never need a torch, so torches would never be learned. What it knows of a seen tile is what the board shows for it: the exact gold, wall HP and monster HP. A tile under a monster keeps what was known of it (or counts as floor if never seen). An immobile monster is remembered until its tile is seen empty; a mobile one for 4 turns out of sight, or until one of the same kind turns up close enough to be it. Teachers have no randomness: ties go to the direction order up, right, down, left and to tiles by index, so the same raid gives the same actions.

**The shared planner** finds the cheapest way from his tile to every known tile (Dijkstra), re-planned every turn because monsters move. Unseen tiles and bedrock are closed. A step costs turns + a weight × damage:

| Entering | Turns | Damage |
| --- | --- | --- |
| Floor, item, stairs | 1 | 0 |
| Spike trap | 1 | 2 |
| A wall (only teachers that dig) | 1 + blows: wall HP ÷ his attack, rounded up; 1 for the pickaxe dwarf | 0 |
| A monster he may fight | 1 + blows: its HP ÷ his attack, rounded up | its attack × (blows − 1): it hits after every blow but the last |
| Any tile next to a monster | | that monster's attack (so stepping next to one he will fight costs the approach hit) |

The HP weight grows as HP falls (weight × max HP ÷ HP), and a tile whose own hits would knock him out is closed. The plan does not remember fights on the way, so a monster beaten earlier on a path still counts past it: a little careful, never reckless. **The way back** is the same planner run from the stairs, counting turns and trap damage but ignoring monsters (they move). A teacher goes for something only if, from there, it can still get out with turns to spare and with HP left after the traps on the way, potions counted.

**Each turn**, the first rule that applies:

1. Heading home and on the stairs: Leave.
2. Goblin in disguise, a troll in sight: step towards it (it fights it, and nothing else matters).
3. Next to a slime or troll it will not fight, and not on the way home: step to the free tile next to him where the fewest hits land.
4. Its potion rule (below): Drink.
5. Next to a monster it will fight: strike the one it beats in the fewest blows.
6. A mobile monster it would fight, two steps away and coming: **Wait**, so it steps next to him and he strikes first (not twice in a row; the warrior never waits).
7. A torch would show enough unseen tiles at distance 2: Light torch.
8. Standing on gold or a useful item, and no monster would hit him for it: Pick up.
9. Go home if the time or HP left says so (below), else to the nearest gold or item worth having that passes the checks above (the warrior, and the champion once buffed, also count a monster they can beat as gold; an item a teacher goes out of its way for counts as that many turns nearer), else to the nearest tile next to unseen ones (diggers also to cracked walls with unseen tiles behind), else home.

A fight is one it **may** have if the damage (`fightDamage`: the hits above, plus the approach hit when it has to step next to the monster) is affordable and still leaves enough for the traps on the way back. **Buffed** means he has taken at least one strength and one vigour.

| Teacher | How it plays | Rules *(tune)* |
| --- | --- | --- |
| Old warrior (reckless) | Nearest gold, monsters' gold included; fights anything in the way he can beat counting his potions; likes strength; drinks only when the next hit would knock him out; leaves when time is just enough to walk back | HP weight 1; never waits; drinks when a monster next to him or two steps away hits as hard as his HP; strength and vigour count 10 turns nearer; 5 turns to spare; heads home at ¼ HP with no potions |
| Healer (careful) | Fights only what he can beat with HP to spare; drinks below half HP; lights a torch when entering an unseen room; leaves when HP is low or with time to spare | HP weight 2; a fight must leave ⅓ of max HP, potions not counted; waits; torch when it shows 5+ unseen tiles; 20 turns to spare; heads home at ½ HP with no potions |
| Thief (sneaky, the safest) | Gold and items without a fight: avoids monsters, goes out of his way for potions, torches, strength and vigour no monster guards; lights torches often to see danger early | As the healer, but HP weight 10; never plans through a monster (strikes back only at a mobile one next to him); gold or an item within 2 tiles of a slime or troll, or with a monster on or next to it, is guarded; potions, torches, strength and vigour count 10 turns nearer; torch when it shows 2+ unseen tiles |
| Dwarf (digger) | Like the healer, but digs through a wall when digging (at his real attack) costs fewer turns than walking round | As the healer, digging in the planner |
| Dwarf with his own pickaxe | Plans as if every wall falls in one blow; the barbarian cannot, so copying him wastes turns | As the dwarf, a wall costing 1 blow. His lessons are played with his pickaxe (`step(…, { pickaxe: true })`): there every wall does fall in one blow |
| Goblin in disguise | Looks like the warrior until a troll is in sight, then walks into it | The warrior's rules, plus rule 2 |
| Champion (gets stronger first) | Goes out of his way for strength and vigour; careful like the healer until buffed, then counts his potions in a fight and hunts monsters for their gold, slimes and trolls included | As the healer, but strength and vigour count 20 turns nearer; once buffed, potions count as HP in a fight and monsters' gold as gold; a fight must leave 0.1 of max HP; 10 turns to spare |

**Measured** (`npm run measure:teachers -- 1000`; 1,000 codes, raid 0 of each, every teacher on the same codes; the pickaxe dwarf also "copied": his plans carried out at the barbarian's real attack; 200 turns, two strength and two vigour in every dungeon, chases that end after 5 steps):

| Teacher | Gold out | Left | Left with no gold | Knocked out | Locked in | Turns | Potions | Torches | Dig blows | Walls dug | Waits | HP lost | Beaten | Strength | Vigour | Trolls beaten |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Old warrior | 62.5 | 88% | 0% | 11% | 1% | 161 | 2.2 | 2.6 | 0 | 0 | 0 | 37.2 | 6.4 | 1.47 | 1.54 | 0.40 |
| Healer | 61.8 | 99% | 0% | 1% | 0% | 170 | 2.1 | 2.6 | 0 | 0 | 2.0 | 26.8 | 6.1 | 1.55 | 1.64 | 0.10 |
| Thief | 48.4 | 99% | 1% | 0% | 0% | 173 | 0.9 | 2.7 | 0 | 0 | 1.9 | 16.6 | 5.2 | 1.39 | 1.59 | 0 |
| Dwarf | 65.7 | 100% | 0% | 0% | 0% | 174 | 1.7 | 2.6 | 8.2 | 4.2 | 2.0 | 24.2 | 6.1 | 1.59 | 1.63 | 0.16 |
| Dwarf, own pickaxe | 67.7 | 100% | 0% | 0% | 0% | 175 | 1.7 | 2.6 | 6.5 | 6.5 | 2.0 | 24.3 | 6.2 | 1.60 | 1.66 | 0.18 |
| … copied | 65.3 | 100% | 0% | 0% | 0% | 176 | 1.6 | 2.5 | 12.9 | 6.1 | 2.0 | 23.3 | 6.0 | 1.58 | 1.64 | 0.15 |
| Goblin in disguise | 37.3 | 46% | 0% | 53% | 1% | 139 | 0.9 | 2.6 | 0 | 0 | 0 | 31.3 | 6.0 | 1.41 | 1.49 | 0.28 |
| Champion | 60.4 | 98% | 0% | 2% | 0% | 159 | 2.8 | 2.6 | 0 | 0 | 1.9 | 33.5 | 6.3 | 1.49 | 1.53 | 0.37 |

The shape holds, thinly in places: the healer leaves almost always; the warrior earns most of the non-diggers (0.7 gold more than the healer) and is knocked out 11 times as often; the thief earns least of the honest teachers but is the safest, never knocked out and losing least HP; the dwarf beats the healer; copied, the pickaxe dwarf strikes 12.9 blows for 6.1 walls; the goblin in disguise is knocked out in 65% of the raids where a troll comes in sight (8% for the warrior). The champion earns about what the healer does, as safely, and beats almost four times as many trolls (0.37 a raid, the warrior 0.40 at five times the knock-outs).

**Retuned with the buffs** (this round). The second strength and vigour made a longer, riskier trip for both worth weighing; the teachers were reviewed to give each its own aim:

- **Seeking the buffs barely works at 150 turns.** An item can now count as some turns nearer than it is (the thief's 10, the warrior's 10 for strength and vigour, the champion's 20), but with 150 turns each teacher still took about 1.2 strength and 1.3 vigour whatever the bonus. A third of the buffs were never even seen: the unseen ones lie about 19 steps from the stairs, and the teachers ran out of time exploring the nearer rooms. Heading for deeper rooms first, or leaving far gold for later, did not help either.
- **So the day is 200 turns** (from 150). Each teacher now takes about 1.5 of each, gold out rises by 10–20, and trolls beaten go up: the warrior 0.18 → 0.40, the champion 0.14 → 0.37. At 250 turns the healer (70.8) and dwarf (79.0) overtook the warrior (66.5): there his risks stop paying, so 200.
- **Chases end** (see Monsters). Ending them after 3, 5 or 8 steps measured the same for every teacher as chases that never end.
- **A thief that slips away** from a rat or goblin instead of striking back did much worse: 12–27 gold where striking back gives 47, with more HP lost and up to 13% knocked out. A rat falls in one blow without hitting back, and a goblin costs 2 HP; running from them only invites hits and blocks corridors. Dropped.
- **Fixed: a flee loop on the way home.** Rule 3 (step away from a slime or troll he will not fight) no longer applies on the way home. Going home past a slime, a teacher stepped aside, then the way home stepped back next to it, and again, until he was knocked out: most of the thief's and healer's knock-outs. The way home is planned with the hits counted, so now he just takes it. Thief 47.0 → 48.4 gold, knocked out 3% → 0%; healer 61.2 → 61.8, 2% → 1%.
- **The thief as the safest teacher:** after the fix he already is, so his rules stay. More time to spare (25–35 turns) or fights that must leave half his HP only cost gold (42–46) with no fewer knock-outs.
- **At 150 turns** (same code, before the time change and the flee fix): warrior 50.4 (7% knocked out, 0.18 trolls), healer 44.2, thief 36.7, dwarf 46.4, pickaxe dwarf 47.6 (copied 46.0), goblin 35.8, champion 47.9 (1% knocked out, 0.14 trolls).

**With one strength and one vigour** (step 5, before the second of each): warrior 43.3 gold (11% knocked out, 0.04 trolls beaten a raid), healer 41.4, thief 37.4, dwarf 44.0, pickaxe dwarf 45.4 (copied 43.6), goblin 28.0 (knocked out in 97% of the raids with a troll in sight). The warrior's lead over the healer was thin (1.9 gold); the second strength and vigour widened it to 5.9 at 150 turns (before the teachers were retuned), since buffs help most the one who fights.

**Wait** (the open question, settled in step 5): a monster that steps next to him does not hit that turn, so whoever closes the gap is hit first. Every step he or a chasing monster takes changes the distance between them by one, so from two steps away no move of his can make the monster close the gap: only standing still does. Without Wait, the only ways to stand still were wasted actions, which "Block impossible actions" takes away. The careful teachers wait about twice a raid; with Wait the healer loses 1.8 HP less per raid and carries out 1.2 more gold (40.2 without), the dwarf 1.2 HP less and 0.6 more gold.

**Start tuned in step 5:** 14 HP and 2 potions instead of 12 and 1. With the old start (same teachers, same codes) the warrior earned 38.5 and the healer 38.6, so the warrior's risks never paid; the healer was knocked out 2%, the warrior 12%, the goblin 39%. More HP and potions help the warrior most, since he spends HP for gold. The max-HP buckets moved with it (up to 14, 15–19, 20+), so vigour still shows.

**How lessons run** (`src/train.ts`, step 6). One lesson is one raid by the teacher, played through the same `step` as his own raids (the pickaxe dwarf with his own pickaxe, so the student copies blows he cannot strike), on the raid's monster stream `code|n|monsters`. Each turn's input is encoded as on his own raids, memory strip included (the teacher's last views and actions), and paired with the teacher's action. The turns of a lesson are shuffled and go to Adam in batches of 32 turns (a batch can span two lessons; the last one of a job is stepped short). Lessons happen in **one dungeon** (raid numbers 0, 1, 2… in turn) or, with no code, **each in a new dungeon** from the job's random stream. Every 25 raids (at most about 20 times a job) 20 test raids are played at boldness 0.5: the 20 fixed codes of `codes|eval`, or raids 0–19 of the one dungeon.

**Measured after lessons** (`npm run measure:training -- 1000 0 200`; 1,000 lessons per teacher, each in a new dungeon; then 200 other codes at boldness 0.5, block off; a fresh network each time):

| Teacher | Short: gold out | left / k.o. / locked | Medium: gold out | left / k.o. / locked | Long: gold out | left / k.o. / locked |
| --- | --- | --- | --- | --- | --- | --- |
| (untrained) | | | 0.0 | 0% (58% left with none) / 15% / 27% | | |
| Old warrior | 6.6 | 42% / 30% / 26% | 5.0 | 40% / 34% / 17% | 5.8 | 48% / 34% / 8% |
| Healer | 4.7 | 35% / 39% / 23% | 5.5 | 45% / 32% / 13% | 2.8 | 29% / 36% / 14% |
| Thief | 5.7 | 49% / 20% / 22% | 4.3 | 42% / 34% / 12% | 2.6 | 25% / 43% / 25% |
| Dwarf | 3.0 | 28% / 27% / 38% | 2.6 | 30% / 20% / 38% | 1.4 | 19% / 32% / 35% |
| Dwarf, own pickaxe | 5.2 | 48% / 19% / 19% | 1.9 | 27% / 28% / 24% | 4.0 | 35% / 35% / 15% |
| Goblin in disguise | 2.4 | 26% / 37% / 28% | 2.8 | 30% / 40% / 24% | 1.6 | 19% / 41% / 30% |

The rest of the "left" share is leaving with no gold (4–21%). The student is far behind his teachers (about 5 gold where they carry out 37–50). The teachers remember the whole map they have seen and walk back by it; he has his memory strip and the compass. Once he strays from what a teacher would do, he is in places no lesson showed (the imitation loss after 1,000 lessons is still 0.6–0.9). Even so, the teachers show through. The diggers' students dig most (2.7–3.9 walls) and waste the most turns striking walls (21.5 wasted actions for the dwarf's at the medium memory, 28.1 at the long one). The goblin's student is knocked out more than the healer's. "Block impossible actions" helps most where the student wastes most: the dwarf's student goes from 2.6 to 4.3 gold at the medium memory, and from 38% to 21% locked in. The long memory mostly does worst after 1,000 lessons: it has 165,033 parameters to fill.

**In one dungeon** the student does much better, since there he can learn the map (`--dungeon`, medium memory, 1,000 lessons, test raids 0–99 of that dungeon):

| Teacher | BCDEFG: gold out | left | QWERTY: gold out | left |
| --- | --- | --- | --- | --- |
| Old warrior | 11.6 | 34% | 17.8 | 49% |
| Healer | 23.4 | 81% | 28.3 | 71% |
| Thief | 23.5 | 85% | 23.6 | 72% |
| Dwarf | 42.1 | 83% | 11.8 | 32% |
| Dwarf, own pickaxe | 40.1 | 79% | 30.4 | 75% |
| Goblin in disguise | 11.6 | 34% | 26.9 | 58% |

Which teacher is best depends on the dungeon. In BCDEFG no troll comes in sight on these raids, so the goblin plays exactly like the warrior.

### Phase 2: practice (fine-tuning)

Policy gradient on his own trips, as in Karkulka. Judges:

- **Gold out** (the main one): his score. Pays gold ÷ 50 on the last turn, if he left (a good raid scores about 0.9).
- **Gold picked up**: reward hacking. Pays gold ÷ 50 at each pickup, kept or not. He learns to hoard and run out of time.
- **Monsters beaten**: the wrong measure. Pays 0.05 per point of the beaten monster's full HP, so tougher ones pay more: rat 0.1, goblin 0.2, slime 0.3, troll 0.6. He should learn to pick fights.

**How practice runs** (`src/train.ts`, step 6; numbers *(tune)*):

- A practice raid is his own, at boldness 1, never blocked and with no events. Boldness 1 is the temperature the gradient is taken at, so he learns from his own choices; at 0.7 (Karkulka's) the policy drifted towards wasted actions.
- **Reward to go:** each turn is credited with the judge's rewards from that turn to the end of the raid.
- **Baseline** (settled in step 6): for each turn number, a running average of the reward to go at that turn, over the judge's raids that reached it; the first raid to reach a turn sets it, then it moves 5% of the way each raid. Each judge has its own. Karkulka's baseline, one running average of whole-raid scores, made every late turn look bad when a judge pays along the way (gold picked up, monsters beaten), and those judges then broke him in a few hundred raids.
- **Advantage** = reward to go − baseline, clipped to ±1; one SGD step per raid on the mean gradient of its turns (learning rate 0.05, the whole gradient shortened to length 1). Batches of 8 raids at learning rate 0.2 did no better.

**Measured** (`npm run measure:training -- 1000 3000 100 --dungeon CODE`; a medium-memory model after 1,000 healer lessons, then 3,000 practice raids; 100 test raids at boldness 0.5):

| | Gold out | Left | Knocked out | Locked in | Gold picked up | Beaten |
| --- | --- | --- | --- | --- | --- | --- |
| BCDEFG, before practice | 23.4 | 81% | 13% | 6% | 28.5 | 4.7 |
| … gold out | **26.5** | 89% | 6% | 5% | 29.4 | 4.8 |
| … gold picked up | 16.6 | 53% | 16% | **31%** | **30.2** | 4.8 |
| … monsters beaten | 17.6 | 58% | 16% | 26% | 30.3 | 4.8 |
| QWERTY, before practice | 28.3 | 71% | 12% | 17% | 37.3 | 6.1 |
| … gold out | **35.4** | 86% | 4% | 10% | 39.5 | 6.0 |
| … gold picked up | 34.2 | 83% | 5% | 12% | 39.5 | 6.1 |
| … monsters beaten | 17.4 | 43% | 17% | **40%** | 37.2 | 6.4 |
| 200 new codes, before | 5.5 | 45% | 32% | 13% | 16.8 | 2.5 |
| … gold out | 6.0 | 43% | 38% | 15% | 18.5 | 2.6 |
| … gold picked up | 0.5 | 6% | 47% | **48%** | 20.5 | 2.9 |
| … monsters beaten | 0.3 | 3% | 44% | **54%** | 17.7 | 2.9 |

**In one dungeon** the gold-out judge does what fine-tuning should: gold out rises from 23.4 to 26.5 in BCDEFG and from 28.3 to 35.4 in QWERTY, and he leaves more often. With the earlier dungeons (one strength, one vigour) the healer's student started lower in BCDEFG, and there practice took him from 8.6 to 22. The gold-picked-up judge makes him pick up a little more, but he is locked in five times as often and carries out less (BCDEFG). The monsters-beaten judge does the same damage with hardly any more fights: 4.7 to 4.8 beaten in BCDEFG, 6.1 to 6.4 in QWERTY. Before the dungeon change, a flat 0.2 a monster, 0.1 per HP, and HP to the power 1.5 all measured the same.

**Practice from other teachers' lessons** (`--practice-from NAME`; 200 turns, the retuned teachers, BCDEFG, 1,000 lessons then 3,000 practice raids, medium memory, 100 test raids):

| Lessons from | Before: gold out | left / k.o. / locked | beaten | Gold out judge: gold out | left | Monsters-beaten judge: gold out | k.o. / locked | beaten |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Healer | 7.0 | 18% / 19% / 63% | 4.7 | 28.3 | 75% | 12.8 | 28% / 45% | 5.1 |
| Champion | 13.9 | 40% / 11% / 49% | 4.9 | **28.7** | 87% | 20.0 | 33% / 15% | **5.8** |
| Old warrior | 3.4 | 11% / 79% / 10% | 4.6 | 19.1 | 70% | 2.0 | 70% / 26% | 5.2 |

The monsters-beaten judge now picks more fights when practice starts from the champion's lessons: 4.9 to 5.8 beaten (the healer's, 4.7 to 5.1). The champion's student fights once his lessons show the fights won, as hoped, though the gain is still small, and being knocked out triples. The warrior's student is knocked out in most raids before practice and stays that way. With the gold-out judge, the champion's lessons end best: 28.7 gold, 87% left.

**Lessons in one dungeon are noisy.** In BCDEFG, after 1,000 lessons (medium memory): at 200 turns the healer's student carries out 7.0 gold (63% locked in), the champion's 13.9, the warrior's 3.4, the thief's 10.6; at 150 turns, on the same code, the healer's 18.1, the champion's 8.4 (69% locked in), the warrior's 10.6. In QWERTY at 200 turns: healer 12.4, champion 5.5 (15.2 with the block on). Which teacher does best changes with the dungeon and the day length, and a lone run says little; the step 6 table above (healer 23.4 in BCDEFG) was at 150 turns with the earlier teachers.

**Over new dungeons**, 3,000 raids are not enough for gold out to rise. The two bad judges break him: he is locked in about half the time and carries out almost nothing.

### Tests

- **Raid alone:** step by step, with the action bars, memory strip, his thoughts and the saga at the end.
- **Raid alone** (`src/raid.ts`): each turn he reads his input, the model gives the probabilities at the boldness, "Block impossible actions" masks them when on, one number from `code|n|act` picks the action (one a turn, block or not, so the box never shifts the stream), and `step` answers with `code|n|monsters`. Each turn's record keeps the input, the unmasked and the sampled probabilities, what was allowed, the action and what it did.
- **Many raids** (`src/raids.ts`): many raids alone, raids 0, 1, 2… of one dungeon or raid 0 of many codes. Average gold out; share left with gold, left with no gold (counted apart, or a player that leaves on the first turn looks safe), knocked out, locked in; average turns, potions drunk, torches lit, walls dug, wasted actions, waits, gold picked up and monsters beaten (what the judges see); with the block option on or off; with events on, events met and their net effect on gold ("bats took 14 gold over 200 raids").
- **In the worker** (`src/worker.ts` runs `runJob` from `src/train.ts`, as in Karkulka): a request is `lessons` (model, stats, count, seed, teacher, optional dungeon and Adam state, which comes back so lessons can go on where they stopped), `practice` (judge instead of teacher) or `raids` (a plan, boldness, block). It answers `progress` every 25 raids, then `done` (model, stats, Adam) or `raidsDone` (counts), or `error`. `src/workerClient.ts` is the page's side.

## His thoughts

On a raid alone he thinks out loud, in a speech bubble, after some actions. As in Karkulka, a thought is **made up after the action is picked**, from what he saw and how sure he was; it never changes what he does. He speaks in compass words (up the screen is north).

- **How sure he sounds** follows the probability of the action he took: sure ("East. Obviously."), likely ("East, I think."), unsure ("Hmm… east? Fine.").
- **What he talks about,** first match wins: a hit taken ("Ow! Tough little rat."), a monster beaten ("Ha! Goblin down. Coins!"), a monster in sight ("Troll to the north. Too big. Not today."), gold in sight ("Gold heap east! Mine!"), a wall dug through ("Wall? What wall?"), the torch lit or going out ("Let there be light!" / "Torch is dying…"), low HP ("Need a potion…"), little time left ("Sun's going down. Stairs!"), a wasted action ("Nothing here to pick up. Hmph.").
- **Pace:** at most one thought every 2 actions, except hits, beaten monsters and events, which always get one.
- Lines live in a data file with the events, so they can be added without code changes.

## Dungeon events and the skald's saga

### Hidden events

The dungeon is full of little events he cannot see: a bat colony, an old skeleton telling a joke, a dripping echo. As in Karkulka, they are **hidden**: not in his view, not scored by any judge, so they never change what the model learns. Walking onto a spot sets it off (or hearing it, when it comes into his view); each spot happens once per raid.

- **Data file:** `src/data/events.json`, with Karkulka's shape: `id`, `name`, `fits`, `trigger` (`step` / `hear`), `versions` (saga sentences), `thoughts`, `popup`, optional `chance` and `effect`. A test checks the file.
- **Places:** `anywhere`, `room`, `corridor`, `deadEnd`, `nearStairs` (within 4 steps), `nearGuard` (within 2 of an immobile monster), `nearTrap`, `deep` (far from the stairs).
- **Spots:** about 12 per dungeon, none within another's 5 × 5; fixed per dungeon code, or new every raid (a setting, on by default).
- **Events with an effect** (step only; each has quiet versions for when nothing can change):

| Effect | Example | What it does |
| --- | --- | --- |
| `takeGold` | A bat snatches a shiny coin | −1 gold |
| `giveGold` | Coins hidden in a crack | +3 gold |
| `giveTorch` | A friendly ghost hands him a torch | +1 torch (if under 3) |
| `heal` | A cold spring | +3 HP (up to max) |
| `drainTorch` | A gust of wind | A lit torch loses 5 turns |

  These change his pinned tokens, so the model sees the result but never the cause.
- **Starter cast** (about 25 kinds, most harmless): bat colony, dripping echo, old skeleton with a joke, spider weaving, mushroom glow, rumbling deep below, rats squeaking behind a wall, a carved warning ("Turn back!"), an empty treasure chest, a goblin's lost sock, a sleeping dragon's snore far away (never met), a rusty sword stuck in stone, wall paintings of a hero, a dwarf's forgotten lunch, a cold draught from the stairs, and so on.
- Events happen on Raid alone and Many raids, both following the same "Events" checkbox (on by default), so the numbers describe the game you watch. Lessons and practice never have them, so the model is never trained on them. "Show events (for testing)" draws the spots.
- **Their own randomness:** the dungeon, his action sampling, monster wandering, and events and thoughts each draw from a separate seeded stream. Turning events off or changing their wording never changes which actions are sampled, how monsters move or what the dungeon holds; only an effect, once it happens, changes his stats and so what follows.

### The skald's saga

After every raid alone a skald (a storyteller of old) sings **the saga of the raid**: true sentences from the raid record (the start, fights, gold, digging, the events he met, the ending) mixed with **made-up** ones, more the bolder the skald.

- **Marks:** true sentences start with a small rune stone, made-up ones with a grey dashed cloud and italics. A line under it counts them ("6 true, 2 made up").
- **What may be made up:** only happenings in the middle. The ending and the gold carried out are always true.
- **How much, by boldness** (Karkulka's scale): nothing below 0.5; borrowed events (ones placed in this dungeon that he did not meet) up to 1.2; from 1.2, boasting and pure fantasy too ("He wrestled a dragon and won."), a growing share as boldness rises.
- **Boasts** are a made-up kind Karkulka lacks: a true happening with inflated numbers ("He felled a dozen goblins" after one goblin). They are the sneakiest hallucination: built on a real event, wrong in the detail.
- "Sing it again" tells the same raid again at the boldness set now.

## Explanation (light touch)

- Each panel gets at most one short caption.
- **AI idea cards** (a small "AI" badge opens one) only for the main ideas, about 12: tokens and the context window, probabilities and boldness, pinned stats, numbers as buckets, the agent loop, end-of-sequence (Leave), tool calls (pick up, drink, torch), torchlight as retrieval, lessons and teachers, the dwarf's pickaxe (distillation), practice and reward hacking, the saga (hallucination). Each is 2–3 sentences, ending with how a real chatbot does it.
- No pulsing hints except the first time a card is relevant.
- The Inside the model tab stays for those who want the details.

## Showcase extras

- **Speed control** and **autoplay** on raids alone, with damage numbers and coin pop-ups.
- **Hall of fame:** the best raids in this browser (gold, dungeon code, teacher, settings), replayable.
- **Dungeon of the day:** a code made from today's date, the same for everyone.
- Later: sound effects made in code, off by default.

## Visuals

- Original symbolic SVG shapes drawn in code; no tile packs, no resemblance to existing games.
- **Shape plus colour, never colour alone.** Red is reserved for danger (damage, low HP).
- The user sees the whole dungeon; dark cells are shown dimmed so it is clear what he does not see.
- Monsters show their HP as a small bar plus a number; wounded ones also change shape (a crack or bandage), since the model only knows healthy / wounded.

## Scope

### Phase one

Everything above: one level, 4 monsters with wounded and rich flags, 13 tile kinds, line of sight, 9 actions, 7 teachers, practice with 3 judges, raid alone with thoughts, hidden events and the saga, many raids, inside-the-model tab, save and links.

### Phase two ideas

- Model size dial (e.g. 24 / 48 / 96 hidden units): scaling, and that more parameters need more lessons.
- Learned tile embeddings shared across cells instead of one-hot: token embeddings.
- A mimic that looks like gold: look-alike tokens.
- Hidden traps: he cannot avoid what is not in his input.
- Deeper levels: "go down or leave".
- New items, each a pinned token and an action: key and door, bomb, shield.
- Teacher correcting his own trips (on-policy lessons, RLHF-like).
- Mobile monsters with more flags: fast, slow, cowardly (runs when wounded).

### Open questions

- Whether "burning low" should be 1–3 turns (now) or 1–4. Each torch gives only 3 low views; if the step 5 teachers act on it and the model does not pick it up, widen it. Changing it changes no sizes but does change what a saved model learned, so after step 8 it needs a save-version bump.
- The present flag of a remembered pair is redundant (an empty slot has no cell kind set) but kept: it makes "this slot is empty" one visible number for the Inside the model tab, at 1 input per pair.
- How rare rich monsters should be, and whether the rich flag makes greedy teachers too reckless. (The step 5 warrior counts a rich monster's gold like any other.)
- **Risk against reward** (settled for now). Gold out is an average, so a knock-out already counts as 0: the score is neither careful nor reckless, but ranking teachers by it alone hides the risk each takes. Wherever teachers or students are compared (the teacher picker, the many-raids counts, step 8's UI), show the share that left with gold next to gold out, e.g. "warrior: 62 gold, knocked out 1 raid in 9"; "thief: 48 gold, never knocked out". The thief is now the safest teacher. A risk-averse judge (gold out with a penalty for a knock-out) is the bigger step, left for later.
- Teachers still find only about 1.5 of the 2 strength and 2 vigour at 200 turns; the rest are mostly never seen. If the champion should reliably gather all four, the buffs could sit nearer, or the generator could put the deeper ones on the main way rather than in side rooms.
- Teachers judge "the next hit" and "a fight he can afford" from monsters they can see; most of the warrior's knock-outs left are a slime or troll first seen when it is already next to him in the dark. That is the torch's lesson, but it makes the warrior's numbers noisy.
- Exact numbers for dungeon size, time limit, torch length, monster stats: tune by measuring.
- **The student is far behind his teachers** (step 6): about 5 gold out over new dungeons after 1,000 lessons, where the teachers carry out 37–50; 12–42 in a dungeon he trains in. Most of the gap is the teachers' map memory and his drifting off their paths. The phase-two idea "teacher correcting his own trips" (the teacher's action as the lesson on the student's own raids) goes straight at the drift and may belong in phase one. A cheaper help: show the teachers' numbers next to his, so the gap reads as a lesson (the examples were written by someone who knew more) and not as a bug.
- Should lessons and practice default to one dungeon (the code on screen) or a new one each raid? In one dungeon both work well enough to watch; over new dungeons practice shows no gain in 3,000 raids. Step 8 picks the default; this doc suggests the code on screen, with "new dungeon every raid" as a setting.
- The monsters-beaten judge picks only a few more fights, even from the champion's lessons (4.9 to 5.8 beaten in BCDEFG; 4.7 to 5.1 from the healer's). Starting from lessons with fights won helps a little; paying per blow struck is still untried.
- After lessons, the long memory does worse than the medium one: 1,000 lessons do not fill 165,081 parameters. The UI may need to suggest more lessons for the long memory.
