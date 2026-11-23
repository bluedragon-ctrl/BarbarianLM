# Barbarian LM — Design (draft)

This file is the source of truth for the game's design. Update it in the same pull request as any change to how the game behaves.

**Status:** draft for phase one. Nothing is built yet. Numbers marked *(tune)* are first guesses, to be set by measuring across many dungeon codes.

## Purpose and audience

A browser game that teaches how language models work: a barbarian learns to raid a dungeon one predicted action at a time, the way a language model writes one predicted token at a time. It follows on from Red Riding Hood LM (Karkulka) and adds what that game cannot show: a world that answers back between actions, more kinds of output, actions that use items, and deciding when to stop.

- **Audience:** older kids and adults without a technical background who are curious about AI. A final tab serves technical users.
- **Setting:** a desktop browser, classroom projector or laptop. The UI is in English.
- **Tone:** nothing graphic. Monsters that lose turn into coins; the barbarian is "knocked out" and carried out by the dungeon keeper.
- **A showcase, not a course.** Karkulka is the entry-level lesson; Barbarian is meant to be fun to watch and play with. Explanation stays light: short captions, and an "AI idea" card only for the main ideas (see [Explanation](#explanation-light-touch)). The fun parts (his thoughts, hidden dungeon events, the skald's saga) carry the ideas on their own.

## Core concept

Every action is a token. What he sees around him is an input token, and the action he takes is an output token. His context is the recent alternating sequence of both:

`[HP] [max HP] [attack] [potions] [torches] [torch lit] [gold] [time] [stairs] | [view] [action] [view] [action] [view] → next action?`

The tokens before the bar are **pinned**: they describe him now and never scroll out. The model reads the context and outputs a probability for each of the 8 actions. One is sampled, he takes it, **the dungeon answers** (monsters move and hit, the torch burns down, time passes), he sees a new view, and the loop repeats until he leaves, is knocked out, or the gate closes.

The goal: enter by the stairs, gather gold, and **leave by the stairs** with as much as possible. Gold counts only if he gets out.

### Mapping table

| In the game | In a language model |
| --- | --- |
| A view of his surroundings | An input token |
| An action (8 kinds) | An output token from a vocabulary of 8 |
| Memory strip of recent views and actions | The context window |
| Memory size (short, medium, long) | Context length, fixed before training |
| Thickness of the action bars | Next-token probabilities |
| Boldness dial | Sampling temperature |
| Pinned stats (HP, attack, gold, potions, torches, time) | A system prompt or state that is always in the context |
| Stats in buckets ("HP: low") instead of exact numbers | Numbers are chopped into tokens, which is why models are bad at exact arithmetic |
| "Leave" on the stairs | The end-of-sequence token: deciding when the answer is finished |
| Gold lost if he is knocked out or locked in | An answer that is cut off or goes wrong at the end is worth nothing, however good its start |
| The gate closes at sundown (time limit) | Maximum output length |
| Monsters move and hit back after each action | An agent loop: the model acts, the world (a tool, a user) answers, and the answer joins the context |
| The same "move right" token walks, attacks or digs, depending on what is there | A token's effect depends on its context |
| Pick up, drink a potion, light a torch | Tool calls: outputs that do something instead of moving the answer on |
| Dark cells outside the torchlight | Missing information: tokens the model never got |
| A torch shows more of the dungeon for a while, and he has few of them | Retrieval or a search tool: pays a cost to bring more into the context |
| Actions that cannot work (picking up from bare floor, drinking with no potions, bumping bedrock) | Invalid outputs; with "Block impossible actions", constrained decoding |
| The stairs compass | A hint in the prompt |
| Lessons from a teacher | Pretraining on example text |
| Choice of teacher | Training data and the values of whoever made it |
| The goblin in disguise as a teacher | Data poisoning |
| The dwarf with his own pickaxe (digs in one blow; the barbarian needs several) | Distillation from a stronger model: the student copies moves it cannot really do |
| Teachers remember the whole map they have seen; he remembers only his memory strip | The examples were written by someone who knew more than the context shows |
| Practice judged by gold carried out | Fine-tuning with a reward (reinforcement learning) |
| Practice judged by gold picked up: he hoards and never leaves | Reward hacking |
| Practice judged by monsters beaten: he picks fights | A reward that measures the wrong thing |
| Parameters grow with memory size here | In a real transformer they do not: attention reuses the same weights for any context length |
| A cell in his view is one thing plus flags (a goblin, wounded, rich) | A token's embedding packs several properties at once |
| A lit torch shows more, but monsters notice him from further away | Bringing more into the context is not free: it can pull in trouble too |
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

### Tiles (13 kinds in a view)

| Kind | What it does |
| --- | --- |
| Floor | Walkable |
| Stone wall | Not walkable; 6 HP *(tune)*; bumping it deals his attack as damage; at 0 it becomes floor |
| Cracked wall | A stone wall with 3 HP or less (placed by the generator, or one he has damaged) |
| Bedrock | Unbreakable; bumping it wastes the turn ("Clang!") |
| Stairs | Where he starts; "Leave" works only here |
| Spike trap | Visible; walkable; 2 damage *(tune)* each time he steps on it; monsters walk around it |
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
- **Immobile:** hits him if he is next to it; never moves.
- **Where monsters may step:** floor and any item (in a corridor there is no way round). Never onto spike traps, the stairs (so the way out is never blocked), walls, him or another monster. They never pick anything up.
- **Beaten:** it drops its gold on its tile (rats too: a rat's pile is 1). On bare floor that makes a new pile; on gold the amounts add up (a heap from 6). If the tile holds another item (potion, torch, strength, vigour), the gold goes to the nearest empty floor tile, searched in a fixed order (up, right, down, left, then further out), so nothing is lost and the result is deterministic.

### The barbarian

| Stat | Start | Notes |
| --- | --- | --- |
| HP / max HP | 12 / 12 | 0 HP: knocked out, all gold lost |
| Attack | 2 | Damage to monsters and walls per bump |
| Potions | 1 | Drinking heals 6 *(tune)*, up to max HP |
| Torches | 1 | Lighting one gives 15 turns of light *(tune)* |
| Gold | 0 | Counts only if he leaves |
| Time | 150 turns *(tune)* | At 0 the gate closes: he is locked in, the keeper lets him out in the morning and keeps the gold |

### Actions (8 output tokens)

| Token | Effect |
| --- | --- |
| Up, Right, Down, Left | **Bump:** walk onto an open tile; attack a monster there; damage a wall there; bedrock: nothing |
| Pick up | Takes what lies on his tile; on bare floor, nothing |
| Drink | Drinks a potion; with none, nothing |
| Light torch | Lights a torch; with none, or one already burning, nothing |
| Leave | Works only on the stairs: the trip ends at once and the gold is his. Elsewhere, nothing |

Every action, useful or not, takes one turn.

**Block impossible actions** (a checkbox on Raid alone and Many raids, off by default): before an action is sampled, the ones that would do nothing get probability 0 and the rest are scaled back up to 1. Blocked: picking up on bare floor, or a potion or torch with a full pack; drinking with no potions; lighting a torch with none or one burning; Leave off the stairs; bumping bedrock. Wasteful but possible actions stay allowed (drinking at full HP; bumping a stone wall is digging). The bars still show what the model wanted, with blocked actions struck through. Lessons and practice never block, so he still has to learn not to waste turns, and Many raids can compare wasted actions with the box on and off.

### Turn order

1. He acts. If he left, the trip ends here: no trap, torch, time or monster step follows.
2. Traps: if he stepped onto a spike trap, it hits him.
3. The lit torch burns down a turn; time goes down a turn.
4. Each monster acts, in a fixed order.
5. If his HP is 0: knocked out. If time is 0: locked in.

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
- Monsters notice him by the same rule within a square of 3 tiles around them, or 5 while his torch is lit. So in the dark a goblin can notice him from 3 tiles while he sees only 1: that is the missing information.

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
| Max HP: up to 12, 13–19, 20+ | 3 |
| Attack: 2, 3, 4+ | 3 |
| Potions: 0, 1, 2, 3 | 4 |
| Torches: 0, 1, 2, 3 | 4 |
| Torch: off, burning low (≤ 3 turns), lit | 3 |
| Gold: 0, 1–5, 6–15, 16–30, 31+ | 5 |
| Time left: < 20, 20–49, 50–99, 100+ | 4 |
| Stairs compass: 8 directions or here (on the stairs), plus near / far / very far (none when here) | 12 |
| **Pinned, total** | **43** |
| View now: 25 cells × 19 (one-hot over 17 kinds: 13 tiles and 4 monsters, plus the wounded and rich flags) | 475 |
| Each remembered pair: present flag + view + action | 1 + 475 + 8 = 484 |

HP buckets are absolute so that "can I take this hit?" can be read straight from them against the monsters' attacks.

### Network

One hidden layer, 48 units, tanh, softmax over 8 actions (as in Karkulka, hand-written, no ML library).

| Memory | Remembered pairs | Inputs | Parameters |
| --- | --- | --- | --- |
| Short | 1 | 1,002 | ≈ 48k |
| Medium (default) | 3 | 1,970 | ≈ 95k |
| Long | 6 | 3,422 | ≈ 165k |

The inputs are one-hot, so training only visits the ~100 non-zero inputs per step: size barely affects speed.

### Phase 1: lessons (imitation)

Teachers play the barbarian by hand-written rules. **They see only what he could see**, and remember every tile they have seen on this trip. A teacher who saw the whole map would never need a torch, so torches would never be learned. Each teacher re-plans every turn (shortest paths over the tiles it knows), because monsters move.

| Teacher | How it plays |
| --- | --- |
| Old warrior (greedy) | Nearest gold; fights anything in the way; drinks only when the next hit would knock him out; leaves when time is just enough to walk back |
| Healer (careful) | Fights only what he can beat with HP to spare; drinks below half HP; lights a torch when entering an unseen room; leaves when HP is low or with time to spare |
| Thief (sneaky) | Avoids monsters; takes only gold no monster guards; lights torches often to see danger early |
| Dwarf (digger) | Like the healer, but digs through a wall when digging (at his real attack) costs fewer turns than walking round |
| Dwarf with his own pickaxe | Plans as if every wall falls in one blow; the barbarian cannot, so copying him wastes turns |
| Goblin in disguise | Looks like the warrior until a troll is in sight, then walks into it |

### Phase 2: practice (fine-tuning)

Policy gradient on his own trips, as in Karkulka. Judges:

- **Gold out** (the main one): his score.
- **Gold picked up**: reward hacking. He learns to hoard and run out of time.
- **Monsters beaten**: the wrong measure. He learns to pick fights.

### Tests

- **Raid alone:** step by step, with the action bars, memory strip, his thoughts and the saga at the end.
- **Many raids:** many raids alone. Average gold out; share left / knocked out / locked in; average turns, potions drunk, torches lit, walls dug, wasted actions; with events on, events met and their net effect on gold ("bats took 14 gold over 200 raids").

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

Everything above: one level, 4 monsters with wounded and rich flags, 13 tile kinds, line of sight, 8 actions, 6 teachers, practice with 3 judges, raid alone with thoughts, hidden events and the saga, many raids, inside-the-model tab, save and links.

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

- Is a "Wait" action needed (to let a monster come to him)?
- How rare rich monsters should be, and whether the rich flag makes greedy teachers too reckless.
- Exact numbers for dungeon size, time limit, torch length, monster stats: tune by measuring.
