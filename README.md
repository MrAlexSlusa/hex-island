# Hex Island

A hexagonal island of settlers, roads and trade, playable in the browser against
one to four bots. Vite + TypeScript, HTML5 Canvas for the board, plain DOM for
the panels, no backend — everything runs client-side.

> **A personal fan project.** Hex Island is inspired by classic hex-and-resource
> board games. It is not affiliated with, endorsed by, or connected to any board
> game publisher, and carries no third-party branding.

---

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (http://localhost:5173 by default).

Other scripts:

```bash
npm test
```

```bash
npm run build
```

`npm run build` type-checks with `tsc --noEmit` and then produces a static bundle
in `dist/` which can be served from anywhere (it uses relative asset paths).

---

## How the game plays

### Goal

First player to **10 victory points** on their own turn wins. Points come from:

| Source | Points |
| --- | --- |
| Settlement | 1 |
| City | 2 |
| Victory-point development card | 1 (hidden until the game ends) |
| Longest Road (5+ segments) | 2 |
| Largest Army (3+ knights) | 2 |

### The board

19 land hexes — 4 forest (wood), 4 pasture (sheep), 4 fields (wheat), 3 hills
(brick), 3 mountains (ore) and 1 desert — ringed by 18 ocean hexes. The 18
number tokens (2–12, no 7) are dealt out in the standard frequency, with 6 and 8
printed in red; **no two red numbers ever end up on adjacent hexes**. Nine ports
sit on the ocean ring: four generic 3:1 ports and one 2:1 port per resource.

### Setup

A snake draft: players 1…N place a settlement and a road, then N…1 do the same.
The **second** settlement immediately pays out one card for each resource hex it
touches. Setup pieces are free, and the setup settlement is exempt from the
"must sit on your own road" rule.

### A turn

1. **Roll** two dice. Every settlement (1 card) or city (2 cards) on a corner of
   a hex showing that number produces — unless the robber is sitting on it.
2. **Roll a 7** and anyone holding more than 7 cards discards half, rounded
   down. The roller then moves the robber to any other land hex and steals one
   random card from a player with a building there.
3. **Trade and build** in any order: with the bank, at your ports, or with the
   other players.
4. **End turn.**

A development card may be played before or after the roll — at most one
non-victory-point card per turn, and never on the turn it was bought.

### Costs

| | Cost |
| --- | --- |
| Road | 1 wood + 1 brick |
| Settlement | 1 wood + 1 brick + 1 sheep + 1 wheat |
| City | 2 wheat + 3 ore (replaces one of your settlements) |
| Development card | 1 sheep + 1 wheat + 1 ore |

Supply per player: 15 roads, 5 settlements, 4 cities.

### Placement rules

- **Distance rule** — a settlement may not be built next to any other building
  (at least two edges apart).
- **Roads** must join your own network, and may not be built *through* an
  intersection occupied by an opponent's settlement or city.
- Outside setup, a new settlement must sit on one of **your own** roads.

### Development deck (25 cards)

14 Knight, 5 Victory Point, 2 Road Building, 2 Year of Plenty, 2 Monopoly.

- **Knight** — move the robber and steal; counts towards Largest Army.
- **Road Building** — place 2 roads for free.
- **Year of Plenty** — take any 2 resources from the bank.
- **Monopoly** — name a resource; every other player hands you all of theirs.
- **Victory Point** — worth 1 point, never "played", hidden until someone wins.

### The two awards

- **Longest Road** — the longest continuous route of 5 or more of your own road
  segments. An edge may not be reused, but an intersection may be passed through
  twice, so a closed loop counts for its full length. An opponent's building
  cuts a route at that intersection. The holder keeps the card while tied; if
  their route is broken and several players tie for the new lead, nobody holds
  it until one player is strictly longest again.
- **Largest Army** — 3 or more knights played, and strictly more than the
  current holder.

### Trading

- **Bank:** 4:1 always, 3:1 at a generic port you have settled, 2:1 at the
  matching resource port. The best ratio you own applies.
- **Players:** build any offer and send it to the table. Bots evaluate it and
  accept, decline, or come back with a counter-offer. Bots make offers of their
  own too, which arrive as a dialog you can accept, decline or counter.

### The bank

The bank holds 19 cards of each resource. If a roll would pay out more of a
resource than the bank has left and more than one player is owed it, nobody
receives any; if only one player is owed, they take whatever remains. (The
original brief did not mention bank limits — this is the standard rule rather
than a simplification, and it is noted here so the behaviour is not a surprise.)

---

## The three bot tiers

All bots go through exactly the same reducer as you do, see only public
information, and get no extra resources. There is no cheating and no
hidden-card peeking.

**Shared core** (`src/ai/evaluate.ts`) — every bot scores an intersection by the
weighted pip count of its hexes, where each resource's weight is its intrinsic
usefulness scaled by how scarce it is *on this particular board*, plus a bonus
for resources the player does not yet produce, plus a bonus for resource
variety, plus port access.

### Easy

- Setup placement is picked at random from the better half of the ranked
  intersections — "mostly random", but not self-defeating.
- Builds whatever it can afford, chosen at random among the legal options.
- Trades rarely (roughly a 15% chance of a bank shuffle when it cannot build),
  and accepts an offer only on a crude card-count comparison, about 60% of the
  time.
- Moves the robber to a random hex and robs a random victim.
- Plays a knight about a quarter of the time it holds one.

### Normal

- Places settlements on the best-scoring intersection, and setup roads pointing
  at the most promising ground beyond.
- Priority order: city → settlement → development card (when the ore/wheat/sheep
  are genuinely spare) → a road that opens new ground → bank trade towards the
  next build → an offer to the table → end turn.
- Plays Year of Plenty to finish a build, Monopoly when 4+ cards are out there,
  Road Building when it is boxed in.
- Puts the robber where it costs opponents the most expected income, weighted by
  how far ahead they are, and never on its own hexes.
- Accepts a trade whose expected value is positive in terms of what it still
  needs for its next build; counters when an offer is close but not enough.

### Hard

Everything Normal does, plus:

- **Denial** — intersection scores include what the corner would be worth to the
  opponent who wants it most, so Hard takes key corners away from people.
- **Trade denial** — refuses any trade that would hand a player within a few
  points of winning the cards to finish a city or settlement.
- **Timing** — plays a knight before rolling when the robber is on its own land
  or when that knight takes Largest Army; a tighter trade threshold; pays over
  the odds only when one card away from a build.
- **Contested awards** — chases Longest Road when it is in reach and weighs
  roads higher when someone else holds the card.
- **Endgame** — once anyone is within 2 points of winning, it rushes victory
  points: cities first, then development cards regardless of surplus.
- Hard bots may also read `Player.discardMemory`, which records cards that were
  publicly discarded — information a human at the table can also track.

---

## Project layout

```
src/
  game/        Pure rules engine - no DOM, no canvas, no ambient randomness
    types.ts       Data shapes for board, players, state, events
    constants.ts   Terrain mix, token pool, costs, dev deck, colours
    rng.ts         Seeded mulberry32 PRNG
    board.ts       Hex geometry, board generation, intersection graph, ports
    rules.ts       Legality predicates (what can be built / traded / robbed)
    longestRoad.ts Longest-trail search with opponent blocking
    scoring.ts     Victory points and the two awards
    state.ts       Game construction, clone, (de)serialisation, localStorage
    actions.ts     The action union
    reducer.ts     reduce(state, action) -> new state + events
  ai/
    evaluate.ts    Shared board evaluation
    bot.ts         nextBotAction(state) for all three tiers
  render/
    assets.ts      Loads the SVG art pack
    layout.ts      World <-> screen mapping and hit-testing
    pieces.ts      Procedurally drawn settlements, cities and roads
    animations.ts  Tiny tween registry
    renderer.ts    Canvas frame painter
  ui/
    dom.ts         Element helpers, modals, toasts
    menu.ts        Main menu and new-game screen
    panels.ts      Player cards, log, hand, dice, action bar
    modals.ts      Discard, robbery, trade, dev cards, victory, how-to-play
    game.ts        The controller: input, dispatch, bot pacing, animations
tests/           Vitest suites for the rules engine and the bots
tools/art.mjs    Generates the resource, card and dice art
tools/icons.mjs  Generates the home-screen and favicon art
public/assets/   The SVG art pack
public/sw.js     Service worker, for offline play once installed
```

### Design notes

**Hex coordinates.** Hexes use axial `(q, r)` coordinates in a pointy-top
layout. Corners are addressed on an exact *integer* lattice — a hex centre maps
to `(2q + r, 3r)` and each corner adds a fixed integer offset — so two hexes
sharing a corner always produce the identical id. No floating-point rounding is
involved anywhere in the board graph. A radius-2 island yields exactly 54
intersections and 72 edges, which the tests assert.

**Purity and determinism.** `reduce(state, action)` deep-clones, applies and
returns; it never mutates its input and throws `RuleViolation` on an illegal
action rather than failing quietly. The RNG seed lives inside the state, so a
saved game resumes identically and the bot self-play tests are reproducible.

**Rendering.** Tiles, number tokens, dice, resource cards and the robber come
from the SVG art pack. Player pieces are drawn procedurally from the same
geometry, which means any player colour works (the pack ships four, and a fifth
seat gets green) and ghost previews are just a matter of alpha.

**Bot pacing.** `nextBotAction(state)` returns one action at a time rather than a
whole turn, so the UI can space moves out with a delay and animate each one.

---

## Tests

```bash
npm test
```

The suite covers the rules engine rather than the UI:

- **board** — terrain and token distribution, the no-adjacent-red-numbers rule,
  the 54/72 intersection graph, the nine ports landing on 18 distinct coastal
  corners, the robber starting on the desert.
- **production** — settlement vs city payouts, the robber blocking a hex, the
  bank running short, dice distribution and seeded reproducibility.
- **robber** — discarding half (rounded down) above 7 cards, the discard gate
  before the robber moves, auto-steal vs choosing a victim, empty-handed
  neighbours being skipped.
- **longestRoad** — straight chains, branches, closed loops, figure-eights,
  opponent settlements cutting a route, and the award's tie and break rules.
- **building** — the distance rule, road connectivity and the no-building-through
  rule, costs, piece limits, cities, free roads from Road Building, and the
  setup snake draft.
- **devcards** — deck composition, the can't-play-the-turn-you-bought rule, one
  non-VP card per turn, and each card's effect.
- **victory** — the score breakdown, hidden VP cards, winning only on your own
  turn, and save/load round-tripping.
- **ai** — full bot-only games at every difficulty mix (including a 5-seat
  table) played to a winner with no rule violations, Hard beating Easy over
  repeated games, and determinism for a given seed.
- **layout** — the one piece of render code that is pure enough to test: the
  grab radii, that a fingertip is forgiven a near-miss a cursor is not, that
  neither pointer can click the middle of a tile, and that zooming holds its
  focus — through one big step, through twenty small ones the way a real
  pinch arrives, and at both ends of the zoom range.

---

## Controls

- **Click** a highlighted corner or edge to place; **Esc** cancels a build mode.
- **Drag** the board to pan, **scroll** to zoom towards the cursor.
- On a touchscreen, **pinch** to zoom and **drag with two fingers** to pan.
- **Save** stores the game in `localStorage`; **Continue saved game** on the main
  menu restores it. The game also auto-saves during your turn.

## Playing on a phone

Every push to `main` runs the tests, builds, and publishes `dist/` to GitHub
Pages via `.github/workflows/deploy-pages.yml`. Open that URL on a phone and the
layout stacks: the sidebar drops below the board and the action bar goes
single-column. The canvas takes touch input through pointer events, and
`touch-action: none` keeps the browser from stealing a drag.

A fingertip is blunter than a cursor, so while one is on the board the grab
radius widens — corners from 0.42 to 0.62 of a hex circumradius, roads from
0.3 to 0.52 — and a tap gets 14px of travel rather than 6 before it reads as
the start of a pan. This cannot misfire: every pick is handed the legal spots
and returns the nearest, so the radius only decides how far off a tap may land
before it is ignored, never which spot wins. Corners sit one circumradius
apart and a tile's centre is a full radius from each of its corners, so even
the wider radius cannot jump a corner or make the middle of a tile clickable.
`tests/layout.test.ts` pins all of that down.

Which radius applies follows the pointer actually in use (`event.pointerType`),
not the device, so a hybrid machine switching between mouse and touchscreen
mid-game gets the right one each time, and a pen counts as precise.

Pinching zooms, and two fingers dragging together pan. Every pointer currently
down is tracked by id, and a second one arriving turns whatever was happening
into a pinch; the zoom follows the gap between the fingers and the pan follows
their midpoint. A pinch ends one finger at a time, so both lifts are barred
from registering as a tap, and if one finger stays down it continues as a pan.
`Layout.zoomAround` does the anchoring: because `fit` rebuilds the origin from
the zoom each frame and only the pan survives, holding a point under the
fingers means moving the pan by `f(1 - r) + r·pan`, for a scale change `r`
about a focus `f` from the canvas centre. The wheel goes through the same
call, so it now zooms towards the cursor rather than the middle of the board.

One-finger panning measures its delta from the tracked position rather than
`event.movementX`, which older Safari leaves unset for touch pointers.

Opening it in the browser is enough to play. To get a home-screen icon instead
of a browser tab, use **Add to Home Screen** — Share menu on iOS Safari, the
⋮ menu on Android Chrome. `public/manifest.webmanifest` then takes over:
`display: standalone` drops the browser chrome, and the service worker caches
the game so later openings work with no signal. Saved games were already local
— `localStorage`, not a server — so nothing about them changes.

Three things to know about that:

- The service worker is only registered in a production build. In dev it would
  sit in front of Vite's module server and hand back stale code.
- Caching takes two passes. `sw.js` precaches the shell when it installs, but
  it cannot know Vite's hashed bundle names, and on a first visit it only takes
  control *after* the bundle and the art have already gone past it to the
  network. So once the art has loaded the page posts the worker the list of
  files it actually fetched, and the worker stores whatever it is missing.
  Without that, installing and immediately going offline would find the shell
  cached with nothing to run in it.
- `vite.config.ts` sets `base: './'`, so every path in the build is relative.
  That is what lets the same `dist/` work at a domain root *and* under a Pages
  project subpath (`user.github.io/hex-island/`), which is also what scopes the
  service worker to the game rather than the whole host. Absolute paths would
  404 under the subpath.

The icons are generated, not drawn: `tools/icons.mjs` (`npm run icons`) renders
the three-hex mark into a supersampled buffer and writes the PNGs with a small
hand-rolled encoder, so the repo carries no binary art that nobody can diff. It
emits the 192/512 icons, a 512 maskable variant with the cluster pulled inside
Android's crop, an `apple-touch-icon.png`, and both an SVG and a 32px favicon.

---

## Artwork

Everything lives in `public/assets/svg` and is served as-is, so it stays sharp
at any board size. The tile, token, port and robber art is hand-made; the five
resource symbols, their cards and the dice are generated by `tools/art.mjs`
(`npm run art`), which draws each symbol once and reuses it at three sizes:

- `icon_*.svg` — a round badge, used in the hand, on build-button price tags,
  in the activity log and trade offers, and for the chips that fly from a hex
  to a player when a roll pays out. Full card art loses its detail below about
  90px, which is why the small places get their own file.
- `card_*.svg` — the full card, used in the trade, discard and monopoly dialogs.
- `die_*.svg` — the six faces, each with its own bevel and drop shadow.

If a file is missing the renderer falls back to drawing the shape procedurally,
so the game still runs.
