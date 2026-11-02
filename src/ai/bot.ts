/**
 * Bot opponents.
 *
 * `nextBotAction(state)` returns the single next action any bot should take -
 * whoever that bot is. The driver loops on it with a delay between steps so a
 * human can watch what happens. Returning null means it is the human's move.
 *
 * All three tiers share the evaluation in `evaluate.ts` and go through exactly
 * the same reducer as the human: there is no peeking at hidden cards and no
 * extra resources. The only private knowledge a Hard bot uses is the public
 * discard pile recorded in `Player.discardMemory`.
 */

import type { Action } from '../game/actions';
import { edgeEnds } from '../game/board';
import {
  COSTS,
  MIN_LARGEST_ARMY,
  RESOURCES,
  VICTORY_POINTS_TO_WIN,
  bagTotal,
  canAfford,
  pipsFor,
} from '../game/constants';
import { Rng } from '../game/rng';
import {
  canBuyDevCard,
  handSize,
  playableDevCards,
  robberTargets,
  tradeRatios,
  validCitySpots,
  validRoadSpots,
  validSettlementSpots,
} from '../game/rules';
import { longestRoadLength } from '../game/longestRoad';
import { publicVictoryPoints, totalVictoryPoints } from '../game/scoring';
import type {
  Difficulty,
  EdgeId,
  GameState,
  HexId,
  Resource,
  ResourceBag,
  VertexId,
} from '../game/types';
import {
  emptyNumberBag,
  intersectionValue,
  leaderIndex,
  leaderScore,
  production,
  resourceWeights,
  shortfall,
  surplus,
} from './evaluate';

type Target = 'city' | 'settlement' | 'road' | 'devCard';

/** Deterministic per-decision randomness, so saved games replay the same way. */
function botRng(state: GameState, player: number, salt = 0): Rng {
  const mixed =
    (state.rngSeed ^ Math.imul(state.turn + 1, 2654435761) ^ Math.imul(player + 1, 40503) ^
      Math.imul(salt + 1, 2246822519)) >>>
    0;
  return new Rng(mixed);
}

function difficultyOf(state: GameState, player: number): Difficulty {
  return state.players[player].difficulty ?? 'normal';
}

/* ================================================================== *
 * Entry point
 * ================================================================== */

export function nextBotAction(state: GameState): Action | null {
  if (state.phase === 'gameOver') return null;

  // 1. Any bot that owes a discard clears it first, whoever is on turn.
  if (state.phase === 'discard') {
    for (const [key, owed] of Object.entries(state.pendingDiscards)) {
      const player = Number(key);
      if (!state.players[player].isBot) continue;
      return { type: 'DISCARD', player, resources: chooseDiscard(state, player, owed) };
    }
    return null;
  }

  // 2. Bots answer an open offer before anything else moves.
  if (state.tradeOffer) {
    const offer = state.tradeOffer;
    for (const player of offer.to) {
      if (!state.players[player].isBot) continue;
      if (offer.responses[player]) continue;
      return respondToOffer(state, player);
    }
  }

  // 3. The robber may be held by a bot that is not the current player
  //    (it never is today, but keep the check honest).
  const actor =
    state.phase === 'moveRobber' || state.phase === 'selectVictim'
      ? state.robberMover ?? state.current
      : state.current;

  if (!state.players[actor].isBot) return null;
  return actForCurrent(state, actor);
}

function actForCurrent(state: GameState, me: number): Action | null {
  const level = difficultyOf(state, me);
  switch (state.phase) {
    case 'setupSettlement':
      return { type: 'PLACE_SETTLEMENT', vertex: chooseSetupSettlement(state, me, level) };
    case 'setupRoad':
      return { type: 'PLACE_ROAD', edge: chooseSetupRoad(state, me, level) };
    case 'rollDice':
      return beforeRoll(state, me, level);
    case 'moveRobber':
      return { type: 'MOVE_ROBBER', hex: chooseRobberHex(state, me, level) };
    case 'selectVictim':
      return { type: 'STEAL', victim: chooseVictim(state, me, level) };
    case 'roadBuilding': {
      const edge = chooseFreeRoad(state, me, level);
      return edge ? { type: 'PLACE_ROAD', edge } : null;
    }
    case 'main':
      return mainPhase(state, me, level);
    default:
      return null;
  }
}

/* ================================================================== *
 * Setup
 * ================================================================== */

function chooseSetupSettlement(state: GameState, me: number, level: Difficulty): VertexId {
  const spots = validSettlementSpots(state, me, { setup: true });
  if (spots.length === 0) throw new Error('No legal setup settlement');

  const blockWeight = level === 'hard' ? 0.22 : 0;
  const ranked = spots
    .map((v) => ({ v, score: intersectionValue(state, v, me, { blockWeight }) }))
    .sort((a, b) => b.score - a.score);

  if (level === 'easy') {
    // "Mostly random": pick anywhere in the better half, so Easy still ends up
    // with a playable island but never with the best corner by design.
    const pool = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
    return botRng(state, me, state.setupIndex).pick(pool).v;
  }

  // Normal/Hard take the best spot, breaking ties with a stable shuffle.
  const best = ranked[0].score;
  const tied = ranked.filter((r) => r.score > best - 0.001);
  return botRng(state, me, state.setupIndex).pick(tied).v;
}

function chooseSetupRoad(state: GameState, me: number, level: Difficulty): EdgeId {
  const anchor = state.setupSettlement!;
  const options = validRoadSpots(state, me, { setup: anchor });
  if (options.length === 0) throw new Error('No legal setup road');

  if (level === 'easy') return botRng(state, me, state.setupIndex + 50).pick(options);

  const ranked = options
    .map((e) => ({ e, score: roadExpansionValue(state, e, me, anchor, level) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0].e;
}

/** How promising the ground beyond this road is. */
function roadExpansionValue(
  state: GameState,
  edge: EdgeId,
  me: number,
  from: VertexId | null,
  level: Difficulty,
): number {
  const [a, b] = edgeEnds(edge);
  const far = from === a ? b : from === b ? a : b;
  const blockWeight = level === 'hard' ? 0.18 : 0;

  let best = 0;
  const candidates = [far, ...state.board.vertices[far].adjacent];
  for (const v of candidates) {
    if (state.buildings[v]) continue;
    const reachable = state.board.vertices[v].adjacent.every((n) => !state.buildings[n]);
    const value = intersectionValue(state, v, me, { blockWeight });
    best = Math.max(best, reachable ? value : value * 0.35);
  }
  return best;
}

/* ================================================================== *
 * Before the roll
 * ================================================================== */

function beforeRoll(state: GameState, me: number, level: Difficulty): Action {
  const playable = playableDevCards(state, me);
  const knight = playable.find((c) => c.type === 'knight');

  if (knight) {
    if (level === 'easy') {
      if (botRng(state, me, 3).next() < 0.25) return { type: 'PLAY_KNIGHT' };
    } else {
      // Clear the robber off our own land before collecting, and grab Largest
      // Army when it is actually in reach.
      const robberHurtsMe = hexTouchesPlayer(state, state.board.robber, me);
      const army = state.players[me].knightsPlayed + 1;
      const takesArmy =
        army >= MIN_LARGEST_ARMY && army > (state.largestArmy.owner === me ? Infinity : state.largestArmy.size);
      if (robberHurtsMe || takesArmy) return { type: 'PLAY_KNIGHT' };
    }
  }

  return { type: 'ROLL_DICE' };
}

function hexTouchesPlayer(state: GameState, hexId: HexId, player: number): boolean {
  for (const [vertexId, building] of Object.entries(state.buildings)) {
    if (building.owner !== player) continue;
    if (state.board.vertices[vertexId].hexes.includes(hexId)) return true;
  }
  return false;
}

/* ================================================================== *
 * Robber
 * ================================================================== */

function chooseRobberHex(state: GameState, me: number, level: Difficulty): HexId {
  const targets = robberTargets(state);
  if (level === 'easy') return botRng(state, me, 7).pick(targets);

  const leader = leaderIndex(state, me);
  let best = targets[0];
  let bestScore = -Infinity;

  for (const hexId of targets) {
    const hex = state.board.hexes[hexId];
    const pips = pipsFor(hex.token);
    let score = 0;
    let hitsMe = false;

    for (const [vertexId, building] of Object.entries(state.buildings)) {
      if (!state.board.vertices[vertexId].hexes.includes(hexId)) continue;
      const weight = building.type === 'city' ? 2 : 1;
      if (building.owner === me) {
        hitsMe = true;
        continue;
      }
      const victoryPoints = publicVictoryPoints(state, building.owner);
      let value = pips * weight * (1 + victoryPoints * 0.18);
      if (building.owner === leader) value *= level === 'hard' ? 1.8 : 1.35;
      if (handSize(state, building.owner) > 0) value += 1.5;
      score += value;
    }

    if (hitsMe) score -= 1000; // never rob ourselves
    if (score > bestScore) {
      bestScore = score;
      best = hexId;
    }
  }

  return best;
}

function chooseVictim(state: GameState, me: number, level: Difficulty): number | null {
  const candidates = state.victimCandidates;
  if (candidates.length === 0) return null;
  if (level === 'easy') return botRng(state, me, 9).pick(candidates);

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const player of candidates) {
    const score =
      handSize(state, player) * 0.6 +
      publicVictoryPoints(state, player) * (level === 'hard' ? 1.4 : 0.9);
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return best;
}

/* ================================================================== *
 * Discarding
 * ================================================================== */

function chooseDiscard(state: GameState, me: number, owed: number): Partial<ResourceBag> {
  const level = difficultyOf(state, me);
  const hand = { ...state.players[me].resources };
  const out = emptyNumberBag();

  if (level === 'easy') {
    const rng = botRng(state, me, 13);
    for (let i = 0; i < owed; i++) {
      const pool: Resource[] = [];
      for (const r of RESOURCES) for (let n = 0; n < hand[r]; n++) pool.push(r);
      const pick = rng.pick(pool);
      hand[pick]--;
      out[pick]++;
    }
    return out;
  }

  // Keep what the next build needs; shed the rest, most plentiful first.
  const target = chooseTarget(state, me, level);
  const keep = COSTS[target === 'devCard' ? 'devCard' : target];
  const weights = resourceWeights(state);

  for (let i = 0; i < owed; i++) {
    let worst: Resource = RESOURCES[0];
    let worstScore = Infinity;
    for (const r of RESOURCES) {
      if (hand[r] <= 0) continue;
      const needed = Math.max(0, (keep[r] ?? 0) - out[r]);
      const score = weights[r] * (needed > 0 ? 6 : 1) - hand[r] * 0.5;
      if (score < worstScore) {
        worstScore = score;
        worst = r;
      }
    }
    hand[worst]--;
    out[worst]++;
  }
  return out;
}

/* ================================================================== *
 * Main phase
 * ================================================================== */

function mainPhase(state: GameState, me: number, level: Difficulty): Action {
  // Finish any offer we put on the table before doing anything else.
  if (state.tradeOffer && state.tradeOffer.from === me) {
    return resolveOwnOffer(state, me, level);
  }

  if (level === 'easy') return easyMainPhase(state, me);

  const myPoints = totalVictoryPoints(state, me);
  const threat = leaderScore(state, me);
  const endgame = level === 'hard' && (myPoints >= VICTORY_POINTS_TO_WIN - 2 || threat >= VICTORY_POINTS_TO_WIN - 2);

  // A dev card other than a knight is worth playing when it unblocks a build.
  const support = supportingDevCard(state, me, level);
  if (support) return support;

  // 1. Cities are the densest victory points available.
  const cities = validCitySpots(state, me);
  if (cities.length > 0) {
    return { type: 'PLACE_CITY', vertex: bestCitySpot(state, cities) };
  }

  // 2. Settlements: a point plus new production.
  const settlements = validSettlementSpots(state, me);
  if (settlements.length > 0) {
    const ranked = rankSpots(state, me, settlements, level);
    return { type: 'PLACE_SETTLEMENT', vertex: ranked[0] };
  }

  // 3. A development card: always worth it in the endgame, otherwise when the
  //    ore/wheat/sheep are spare.
  if (canBuyDevCard(state, me) && (endgame || hasSpareFor(state, me, 'devCard'))) {
    return { type: 'BUY_DEV_CARD' };
  }

  // 4. Roads, if they open ground or chase Longest Road.
  const road = chooseUsefulRoad(state, me, level);
  if (road) return { type: 'PLACE_ROAD', edge: road };

  // 5. Convert spare cards at the bank towards the next target.
  const target = chooseTarget(state, me, level);
  const bank = bankTradeToward(state, me, target);
  if (bank) return bank;

  // 6. Ask the table once a turn; repeating a refused offer just stalls play.
  if (state.offersMadeThisTurn < 1) {
    const offer = proposeTrade(state, me, target, level);
    if (offer) return offer;
  }

  // 7. Spend leftovers on a card rather than ending the turn rich.
  if (canBuyDevCard(state, me)) return { type: 'BUY_DEV_CARD' };

  return { type: 'END_TURN' };
}

function easyMainPhase(state: GameState, me: number): Action {
  const rng = botRng(state, me, 21);

  const cities = validCitySpots(state, me);
  const settlements = validSettlementSpots(state, me);
  const roads = validRoadSpots(state, me);
  const options: Action[] = [];
  if (cities.length) options.push({ type: 'PLACE_CITY', vertex: rng.pick(cities) });
  if (settlements.length) options.push({ type: 'PLACE_SETTLEMENT', vertex: rng.pick(settlements) });
  if (roads.length) options.push({ type: 'PLACE_ROAD', edge: rng.pick(roads) });
  if (canBuyDevCard(state, me)) options.push({ type: 'BUY_DEV_CARD' });

  if (options.length > 0) return rng.pick(options);

  // Rarely, shuffle some cards at the bank.
  if (rng.next() < 0.15) {
    const ratios = tradeRatios(state, me);
    const rich = RESOURCES.filter((r) => state.players[me].resources[r] >= ratios[r]);
    if (rich.length > 0) {
      const give = rng.pick(rich);
      const want = rng.pick(RESOURCES.filter((r) => r !== give));
      return { type: 'BANK_TRADE', give, receive: want };
    }
  }

  return { type: 'END_TURN' };
}

/** Plays Year of Plenty / Monopoly / Road Building when they actually help. */
function supportingDevCard(state: GameState, me: number, level: Difficulty): Action | null {
  const playable = playableDevCards(state, me);
  if (playable.length === 0) return null;
  const hand = state.players[me].resources;
  const target = chooseTarget(state, me, level);
  const cost = COSTS[target];
  const missing = shortfall(hand, cost);
  const missingTotal = bagTotal(missing);

  if (playable.some((c) => c.type === 'yearOfPlenty') && missingTotal > 0 && missingTotal <= 2) {
    const picks: Resource[] = [];
    for (const r of RESOURCES) for (let i = 0; i < missing[r]; i++) picks.push(r);
    while (picks.length < 2) picks.push(mostWantedResource(state, me));
    return { type: 'PLAY_YEAR_OF_PLENTY', resources: [picks[0], picks[1]] };
  }

  if (playable.some((c) => c.type === 'monopoly')) {
    const pick = bestMonopoly(state, me);
    if (pick && pick.count >= (level === 'hard' ? 3 : 4)) {
      return { type: 'PLAY_MONOPOLY', resource: pick.resource };
    }
  }

  if (playable.some((c) => c.type === 'roadBuilding')) {
    const chasingRoad =
      state.longestRoad.owner !== me &&
      longestRoadLength(state, me) + 2 > Math.max(4, state.longestRoad.length);
    const needsSpace = validSettlementSpots(state, me, { ignoreCost: true }).length === 0;
    if (chasingRoad || needsSpace) return { type: 'PLAY_ROAD_BUILDING' };
  }

  // Knights get played in the main phase too if the robber is sitting on us.
  if (playable.some((c) => c.type === 'knight') && hexTouchesPlayer(state, state.board.robber, me)) {
    return { type: 'PLAY_KNIGHT' };
  }

  return null;
}

function mostWantedResource(state: GameState, me: number): Resource {
  const mine = production(state, me);
  const weights = resourceWeights(state);
  let best: Resource = 'wheat';
  let bestScore = -Infinity;
  for (const r of RESOURCES) {
    const score = weights[r] / (1 + mine[r] * 0.25);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function bestMonopoly(state: GameState, me: number): { resource: Resource; count: number } | null {
  let best: { resource: Resource; count: number } | null = null;
  for (const r of RESOURCES) {
    let count = 0;
    for (let i = 0; i < state.players.length; i++) {
      if (i === me) continue;
      count += state.players[i].resources[r];
    }
    if (!best || count > best.count) best = { resource: r, count };
  }
  return best;
}

function bestCitySpot(state: GameState, spots: VertexId[]): VertexId {
  let best = spots[0];
  let bestScore = -Infinity;
  const weights = resourceWeights(state);
  for (const v of spots) {
    let score = 0;
    for (const hexId of state.board.vertices[v].hexes) {
      const hex = state.board.hexes[hexId];
      if (!hex.resource) continue;
      score += pipsFor(hex.token) * weights[hex.resource];
    }
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

function rankSpots(state: GameState, me: number, spots: VertexId[], level: Difficulty): VertexId[] {
  const blockWeight = level === 'hard' ? 0.25 : 0;
  return spots
    .map((v) => ({ v, score: intersectionValue(state, v, me, { blockWeight }) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.v);
}

function chooseUsefulRoad(state: GameState, me: number, level: Difficulty): EdgeId | null {
  if (!canAfford(state.players[me].resources, COSTS.road)) return null;
  const options = validRoadSpots(state, me);
  if (options.length === 0) return null;

  const roadsBuilt = Object.values(state.roads).filter((o) => o === me).length;
  const wantsLongest =
    state.longestRoad.owner !== me && roadsBuilt + 1 >= Math.max(3, state.longestRoad.length - 1);

  let best: EdgeId | null = null;
  let bestScore = 0;
  for (const edge of options) {
    let score = roadExpansionValue(state, edge, me, null, level) * 0.35;
    if (wantsLongest) score += level === 'hard' ? 2.2 : 1.4;
    if (score > bestScore) {
      bestScore = score;
      best = edge;
    }
  }

  // Only lay a road when it is clearly going somewhere.
  return bestScore >= 2.2 ? best : null;
}

function chooseFreeRoad(state: GameState, me: number, level: Difficulty): EdgeId | null {
  const options = validRoadSpots(state, me, { ignoreCost: true });
  if (options.length === 0) return null;
  if (level === 'easy') return botRng(state, me, 33).pick(options);

  let best = options[0];
  let bestScore = -Infinity;
  for (const edge of options) {
    const score = roadExpansionValue(state, edge, me, null, level) + 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = edge;
    }
  }
  return best;
}

/* ================================================================== *
 * What to save up for
 * ================================================================== */

export function chooseTarget(state: GameState, me: number, level: Difficulty): Target {
  const player = state.players[me];
  const mine = production(state, me);
  const canCity = validCitySpots(state, me, { ignoreCost: true }).length > 0 && player.piecesLeft.city > 0;
  const openSpots = validSettlementSpots(state, me, { ignoreCost: true }).length > 0;
  const endgame =
    totalVictoryPoints(state, me) >= VICTORY_POINTS_TO_WIN - 2 ||
    leaderScore(state, me) >= VICTORY_POINTS_TO_WIN - 2;

  if (canCity && (mine.ore > 0 || endgame)) return 'city';
  if (openSpots && player.piecesLeft.settlement > 0) return 'settlement';
  if (player.piecesLeft.road > 0 && validRoadSpots(state, me, { ignoreCost: true }).length > 0) {
    // Roads only make sense while there is ground left worth reaching.
    const reachable = validSettlementSpots(state, me, { ignoreCost: true }).length === 0;
    if (reachable || (level === 'hard' && state.longestRoad.owner !== me)) return 'road';
  }
  if (canCity) return 'city';
  return 'devCard';
}

function hasSpareFor(state: GameState, me: number, target: Target): boolean {
  const left = surplus(state.players[me].resources, COSTS[target]);
  return bagTotal(left) >= 2;
}

/* ================================================================== *
 * Trading
 * ================================================================== */

function bankTradeToward(state: GameState, me: number, target: Target): Action | null {
  const hand = state.players[me].resources;
  const cost = COSTS[target];
  const missing = shortfall(hand, cost);
  if (bagTotal(missing) === 0) return null;

  const ratios = tradeRatios(state, me);
  const want = RESOURCES.find((r) => missing[r] > 0)!;

  // Only spend cards the target does not need.
  let bestGive: Resource | null = null;
  let bestSpare = 0;
  for (const r of RESOURCES) {
    if (r === want) continue;
    const spare = hand[r] - (cost[r] ?? 0);
    if (spare >= ratios[r] && spare > bestSpare) {
      bestSpare = spare;
      bestGive = r;
    }
  }
  if (!bestGive) return null;
  return { type: 'BANK_TRADE', give: bestGive, receive: want };
}

function proposeTrade(
  state: GameState,
  me: number,
  target: Target,
  level: Difficulty,
): Action | null {
  const hand = state.players[me].resources;
  const cost = COSTS[target];
  const missing = shortfall(hand, cost);
  if (bagTotal(missing) === 0) return null;

  const spare = surplus(hand, cost);
  const want = RESOURCES.find((r) => missing[r] > 0)!;
  const weights = resourceWeights(state);

  // Offer the least useful card we can spare.
  let give: Resource | null = null;
  let giveScore = Infinity;
  for (const r of RESOURCES) {
    if (r === want || spare[r] <= 0) continue;
    const score = weights[r] - spare[r] * 0.3;
    if (score < giveScore) {
      giveScore = score;
      give = r;
    }
  }
  if (!give) return null;

  // Hard bots pay a little over the odds when they are close to a build.
  const quantity = level === 'hard' && spare[give] >= 2 && bagTotal(missing) === 1 ? 2 : 1;
  const to = state.players.map((_, i) => i).filter((i) => i !== me);
  if (to.length === 0) return null;

  return { type: 'OFFER_TRADE', give: { [give]: quantity }, receive: { [want]: 1 }, to };
}

function resolveOwnOffer(state: GameState, me: number, level: Difficulty): Action {
  const offer = state.tradeOffer!;
  const accepted = offer.to.filter((p) => offer.responses[p] === 'accept');
  if (accepted.length > 0) {
    // Prefer trading with whoever is furthest from winning.
    const partner = accepted.sort(
      (a, b) => publicVictoryPoints(state, a) - publicVictoryPoints(state, b),
    )[0];
    return { type: 'ACCEPT_TRADE', player: partner };
  }

  const counters = offer.to.filter((p) => offer.responses[p] === 'counter' && offer.counters[p]);
  for (const partner of counters) {
    const terms = offer.counters[partner];
    // The counter is stated from the proposer's side, so evaluate it as ours.
    const value = tradeValue(state, me, terms.receive, terms.give, level);
    if (value > 0) return { type: 'ACCEPT_TRADE', player: partner, useCounter: true };
  }

  return { type: 'CANCEL_TRADE' };
}

/**
 * Worth of receiving `incoming` in exchange for `outgoing`, measured in the
 * bot's own currency of "cards I need for my next build".
 */
function tradeValue(
  state: GameState,
  me: number,
  incoming: Partial<ResourceBag>,
  outgoing: Partial<ResourceBag>,
  level: Difficulty,
): number {
  const hand = state.players[me].resources;
  const target = chooseTarget(state, me, level);
  const cost = COSTS[target];
  const missing = shortfall(hand, cost);
  const weights = resourceWeights(state);
  const ratios = tradeRatios(state, me);

  let value = 0;
  for (const r of RESOURCES) {
    const got = incoming[r] ?? 0;
    const gave = outgoing[r] ?? 0;
    if (got) value += got * weights[r] * (missing[r] > 0 ? 2.1 : 1);
    if (gave) {
      const spare = Math.max(0, hand[r] - (cost[r] ?? 0));
      const scarcityPenalty = gave > spare ? 2.4 : 1;
      // A card we could dump at the bank anyway is cheaper to part with.
      const bankable = hand[r] >= ratios[r] ? 0.85 : 1;
      value -= gave * weights[r] * scarcityPenalty * bankable;
    }
  }
  return value;
}

export function respondToOffer(state: GameState, me: number): Action {
  const offer = state.tradeOffer!;
  const level = difficultyOf(state, me);
  const proposer = offer.from;

  // We receive what they offer and hand over what they asked for.
  const incoming = offer.give;
  const outgoing = offer.receive;

  if (!canAfford(state.players[me].resources, outgoing)) {
    return { type: 'RESPOND_TRADE', player: me, response: 'reject' };
  }

  if (level === 'easy') {
    const rng = botRng(state, me, 41);
    const naive = bagTotal(incoming) >= bagTotal(outgoing) && rng.next() < 0.6;
    return { type: 'RESPOND_TRADE', player: me, response: naive ? 'accept' : 'reject' };
  }

  // Never help a player who is one good turn from winning.
  if (level === 'hard' && wouldArmTheLeader(state, me, proposer, outgoing)) {
    return { type: 'RESPOND_TRADE', player: me, response: 'reject' };
  }

  const value = tradeValue(state, me, incoming, outgoing, level);
  const threshold = level === 'hard' ? 0.7 : 0.15;

  if (value > threshold) {
    return { type: 'RESPOND_TRADE', player: me, response: 'accept' };
  }

  // Close but not quite: ask for one more card.
  if (value > -1.6 && bagTotal(incoming) < 3) {
    const bump = RESOURCES.find((r) => (incoming[r] ?? 0) > 0);
    if (bump) {
      const counter = {
        give: { ...incoming, [bump]: (incoming[bump] ?? 0) + 1 },
        receive: { ...outgoing },
      };
      if (canAfford(state.players[proposer].resources, counter.give)) {
        return { type: 'RESPOND_TRADE', player: me, response: 'counter', counter };
      }
    }
  }

  return { type: 'RESPOND_TRADE', player: me, response: 'reject' };
}

/**
 * Hard bots refuse to hand the leader the cards that finish their next build.
 */
function wouldArmTheLeader(
  state: GameState,
  me: number,
  proposer: number,
  theyReceive: Partial<ResourceBag>,
): boolean {
  const points = publicVictoryPoints(state, proposer);
  if (points < VICTORY_POINTS_TO_WIN - 3) return false;
  if (proposer === me) return false;

  const after = { ...state.players[proposer].resources };
  for (const r of RESOURCES) after[r] += theyReceive[r] ?? 0;

  const couldCity =
    canAfford(after, COSTS.city) && validCitySpots(state, proposer, { ignoreCost: true }).length > 0;
  const couldSettle =
    canAfford(after, COSTS.settlement) &&
    validSettlementSpots(state, proposer, { ignoreCost: true }).length > 0;

  const gainsPoints = (couldCity ? 1 : 0) + (couldSettle ? 1 : 0);
  return points + gainsPoints >= VICTORY_POINTS_TO_WIN - 1;
}
