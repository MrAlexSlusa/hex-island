/**
 * The rules engine.
 *
 * `reduce(state, action)` is pure: it deep-clones the state, applies the
 * action, and returns the new state with `events` describing what just
 * happened (the renderer turns those into animations, the UI into log lines).
 * Illegal actions throw a RuleViolation rather than failing quietly.
 */

import { RuleViolation, type Action } from './actions';
import { hexVertexIds } from './board';
import {
  COSTS,
  DEV_CARD_LABEL,
  HAND_LIMIT_BEFORE_DISCARD,
  RESOURCES,
  RESOURCE_LABEL,
  VICTORY_POINTS_TO_WIN,
  bagTotal,
  canAfford,
  emptyBag,
} from './constants';
import { Rng } from './rng';
import {
  canBuyDevCard,
  canPlaceCity,
  canPlaceRoad,
  canPlaceSettlement,
  canSettleTrade,
  handSize,
  playableDevCards,
  tradeRatios,
  victimsOn,
} from './rules';
import { recomputeLargestArmy, recomputeLongestRoad, totalVictoryPoints } from './scoring';
import { cloneState } from './state';
import type {
  GameEvent,
  GameState,
  Player,
  ProductionGain,
  Resource,
  ResourceBag,
  VertexId,
} from './types';

/** Cards of each resource the bank starts with. */
export const BANK_PER_RESOURCE = 19;

function emit(state: GameState, event: GameEvent) {
  state.events.push(event);
}

function log(
  state: GameState,
  player: number | null,
  text: string,
  bags?: Partial<ResourceBag>[],
) {
  state.log.push({ turn: state.turn, player, text, ...(bags ? { bags } : {}) });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

/** Folds production gains into the `{amount per resource}` shape the log wants. */
function bagOf(gains: ProductionGain[]): Partial<ResourceBag> {
  const bag: Partial<ResourceBag> = {};
  for (const g of gains) bag[g.resource] = (bag[g.resource] ?? 0) + g.amount;
  return bag;
}

function playerName(state: GameState, index: number): string {
  return state.players[index].name;
}

/** Resources currently held by all players; the rest is in the bank. */
export function bankStock(state: GameState): ResourceBag {
  const bank = emptyBag();
  for (const r of RESOURCES) bank[r] = BANK_PER_RESOURCE;
  for (const p of state.players) {
    for (const r of RESOURCES) bank[r] -= p.resources[r];
  }
  return bank;
}

function pay(player: Player, cost: Partial<ResourceBag>) {
  for (const r of RESOURCES) player.resources[r] -= cost[r] ?? 0;
}

function gain(player: Player, bag: Partial<ResourceBag>) {
  for (const r of RESOURCES) player.resources[r] += bag[r] ?? 0;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function reduce(state: GameState, action: Action): GameState {
  const next = cloneState(state);
  next.events = [];

  switch (action.type) {
    case 'ROLL_DICE':
      rollDice(next);
      break;
    case 'PLACE_SETTLEMENT':
      placeSettlement(next, action.vertex);
      break;
    case 'PLACE_CITY':
      placeCity(next, action.vertex);
      break;
    case 'PLACE_ROAD':
      placeRoad(next, action.edge);
      break;
    case 'BUY_DEV_CARD':
      buyDevCard(next);
      break;
    case 'PLAY_KNIGHT':
      playKnight(next);
      break;
    case 'PLAY_ROAD_BUILDING':
      playRoadBuilding(next);
      break;
    case 'PLAY_YEAR_OF_PLENTY':
      playYearOfPlenty(next, action.resources);
      break;
    case 'PLAY_MONOPOLY':
      playMonopoly(next, action.resource);
      break;
    case 'MOVE_ROBBER':
      moveRobber(next, action.hex);
      break;
    case 'STEAL':
      stealFrom(next, action.victim);
      break;
    case 'DISCARD':
      discard(next, action.player, action.resources);
      break;
    case 'BANK_TRADE':
      bankTrade(next, action.give, action.receive);
      break;
    case 'OFFER_TRADE':
      offerTrade(next, action.give, action.receive, action.to);
      break;
    case 'RESPOND_TRADE':
      respondTrade(next, action.player, action.response, action.counter);
      break;
    case 'ACCEPT_TRADE':
      acceptTrade(next, action.player, action.useCounter ?? false);
      break;
    case 'CANCEL_TRADE':
      next.tradeOffer = null;
      break;
    case 'END_TURN':
      endTurn(next);
      break;
    default: {
      const exhaustive: never = action;
      throw new RuleViolation(`Unknown action ${JSON.stringify(exhaustive)}`);
    }
  }

  checkWin(next);
  return next;
}

/* ------------------------------------------------------------------ *
 * Setup and building
 * ------------------------------------------------------------------ */

function placeSettlement(state: GameState, vertex: VertexId) {
  const setup = state.phase === 'setupSettlement';
  if (!setup && state.phase !== 'main') {
    throw new RuleViolation(`Cannot build a settlement during ${state.phase}`);
  }
  const player = state.current;
  if (!canPlaceSettlement(state, player, vertex, { setup })) {
    throw new RuleViolation(`Illegal settlement at ${vertex}`);
  }

  state.buildings[vertex] = { type: 'settlement', owner: player };
  state.players[player].piecesLeft.settlement--;
  emit(state, { type: 'build', player, kind: 'settlement', at: vertex });

  if (setup) {
    state.setupSettlement = vertex;
    state.phase = 'setupRoad';
    log(state, player, `${playerName(state, player)} founded a settlement.`);
    // The second settlement of the snake draft pays out its surrounding hexes.
    if (state.setupIndex >= state.players.length) {
      grantSetupResources(state, player, vertex);
    }
  } else {
    pay(state.players[player], COSTS.settlement);
    log(state, player, `${playerName(state, player)} built a settlement.`);
  }

  refreshAwards(state);
}

function grantSetupResources(state: GameState, player: number, vertex: VertexId) {
  const gains: ProductionGain[] = [];
  for (const hexId of state.board.vertices[vertex].hexes) {
    const hex = state.board.hexes[hexId];
    if (!hex.resource) continue;
    state.players[player].resources[hex.resource] += 1;
    gains.push({ player, resource: hex.resource, amount: 1, hexId, vertexId: vertex });
  }
  if (gains.length) {
    emit(state, { type: 'production', gains });
    log(state, player, `${playerName(state, player)} collected {0}.`, [bagOf(gains)]);
  }
}

function placeCity(state: GameState, vertex: VertexId) {
  if (state.phase !== 'main') throw new RuleViolation(`Cannot build a city during ${state.phase}`);
  const player = state.current;
  if (!canPlaceCity(state, player, vertex)) throw new RuleViolation(`Illegal city at ${vertex}`);

  state.buildings[vertex] = { type: 'city', owner: player };
  state.players[player].piecesLeft.city--;
  state.players[player].piecesLeft.settlement++;
  pay(state.players[player], COSTS.city);
  emit(state, { type: 'build', player, kind: 'city', at: vertex });
  log(state, player, `${playerName(state, player)} upgraded to a city.`);
}

function placeRoad(state: GameState, edge: string) {
  const player = state.current;
  const setupVertex = state.phase === 'setupRoad' ? state.setupSettlement : null;
  const free = state.phase === 'roadBuilding' || state.phase === 'setupRoad';

  if (state.phase !== 'main' && state.phase !== 'setupRoad' && state.phase !== 'roadBuilding') {
    throw new RuleViolation(`Cannot build a road during ${state.phase}`);
  }
  if (!canPlaceRoad(state, player, edge, { setup: setupVertex, ignoreCost: free })) {
    throw new RuleViolation(`Illegal road at ${edge}`);
  }

  state.roads[edge] = player;
  state.players[player].piecesLeft.road--;
  if (!free) pay(state.players[player], COSTS.road);
  emit(state, { type: 'build', player, kind: 'road', at: edge });
  log(state, player, `${playerName(state, player)} built a road.`);

  if (state.phase === 'setupRoad') {
    advanceSetup(state);
  } else if (state.phase === 'roadBuilding') {
    state.freeRoadsRemaining--;
    const stillPlaceable =
      state.freeRoadsRemaining > 0 &&
      state.players[player].piecesLeft.road > 0 &&
      Object.keys(state.board.edges).some((e) => canPlaceRoad(state, player, e, { ignoreCost: true }));
    if (!stillPlaceable) {
      state.freeRoadsRemaining = 0;
      state.phase = state.resumePhase ?? 'main';
      state.resumePhase = null;
    }
  }

  refreshAwards(state);
}

function advanceSetup(state: GameState) {
  state.setupSettlement = null;
  state.setupIndex++;
  if (state.setupIndex < state.setupOrder.length) {
    state.current = state.setupOrder[state.setupIndex];
    state.phase = 'setupSettlement';
  } else {
    state.current = state.setupOrder[0];
    state.phase = 'rollDice';
    state.turn = 1;
    log(state, null, 'Setup complete. Let the trading begin!');
  }
}

/* ------------------------------------------------------------------ *
 * Dice and production
 * ------------------------------------------------------------------ */

function rollDice(state: GameState) {
  if (state.phase !== 'rollDice') throw new RuleViolation(`Cannot roll during ${state.phase}`);
  const rng = new Rng(state.rngSeed);
  const d1 = rng.range(1, 6);
  const d2 = rng.range(1, 6);
  state.rngSeed = rng.seed;
  state.dice = [d1, d2];
  const sum = d1 + d2;
  emit(state, { type: 'diceRolled', player: state.current, dice: [d1, d2] });
  log(state, state.current, `${playerName(state, state.current)} rolled ${sum}.`);

  if (sum === 7) {
    startRobberPhase(state, 'main');
    return;
  }

  produce(state, sum);
  state.phase = 'main';
}

export function produce(state: GameState, roll: number) {
  const demand: Record<Resource, { player: number; amount: number; hexId: string; vertexId: string }[]> = {
    wood: [],
    brick: [],
    sheep: [],
    wheat: [],
    ore: [],
  };

  let blockedHex: string | null = null;
  for (const hexId of state.board.landHexIds) {
    const hex = state.board.hexes[hexId];
    if (hex.token !== roll || !hex.resource) continue;
    if (state.board.robber === hexId) {
      blockedHex = hexId;
      continue;
    }
    for (const vertexId of hexVertexIds(state.board, hexId)) {
      const building = state.buildings[vertexId];
      if (!building) continue;
      demand[hex.resource].push({
        player: building.owner,
        amount: building.type === 'city' ? 2 : 1,
        hexId,
        vertexId,
      });
    }
  }

  if (blockedHex) emit(state, { type: 'blocked', hexId: blockedHex });

  const bank = bankStock(state);
  const gains: ProductionGain[] = [];

  for (const resource of RESOURCES) {
    const claims = demand[resource];
    if (claims.length === 0) continue;
    const totalWanted = claims.reduce((n, c) => n + c.amount, 0);
    const distinctPlayers = new Set(claims.map((c) => c.player));

    if (totalWanted <= bank[resource]) {
      for (const c of claims) {
        state.players[c.player].resources[resource] += c.amount;
        gains.push({ player: c.player, resource, amount: c.amount, hexId: c.hexId, vertexId: c.vertexId });
      }
    } else if (distinctPlayers.size === 1) {
      // Only one claimant: they take whatever is left in the bank.
      let left = bank[resource];
      for (const c of claims) {
        const give = Math.min(left, c.amount);
        if (give <= 0) break;
        left -= give;
        state.players[c.player].resources[resource] += give;
        gains.push({ player: c.player, resource, amount: give, hexId: c.hexId, vertexId: c.vertexId });
      }
      log(state, null, 'The bank ran short of {0}.', [{ [resource]: 0 }]);
    } else {
      log(state, null, 'Not enough {0} in the bank - nobody collects any.', [
        { [resource]: 0 },
      ]);
    }
  }

  if (gains.length) {
    emit(state, { type: 'production', gains });
    const perPlayer = new Map<number, ProductionGain[]>();
    for (const g of gains) perPlayer.set(g.player, [...(perPlayer.get(g.player) ?? []), g]);
    for (const [player, own] of perPlayer) {
      log(state, player, `${playerName(state, player)} collected {0}.`, [bagOf(own)]);
    }
  } else {
    log(state, null, 'No resources were produced.');
  }
}

/* ------------------------------------------------------------------ *
 * Robber
 * ------------------------------------------------------------------ */

function startRobberPhase(state: GameState, resume: GameState['phase']) {
  state.robberMover = state.current;
  state.resumePhase = resume;
  state.pendingDiscards = {};

  for (let i = 0; i < state.players.length; i++) {
    const size = handSize(state, i);
    if (size > HAND_LIMIT_BEFORE_DISCARD) {
      state.pendingDiscards[i] = Math.floor(size / 2);
    }
  }

  if (Object.keys(state.pendingDiscards).length > 0) {
    state.phase = 'discard';
    log(state, null, 'Seven! Players holding more than 7 cards must discard half.');
  } else {
    state.phase = 'moveRobber';
    log(state, state.current, `${playerName(state, state.current)} moves the robber.`);
  }
}

function discard(state: GameState, player: number, resources: Partial<ResourceBag>) {
  if (state.phase !== 'discard') throw new RuleViolation('Nothing to discard right now');
  const owed = state.pendingDiscards[player];
  if (owed === undefined) throw new RuleViolation(`${playerName(state, player)} owes no discard`);
  if (bagTotal(resources) !== owed) {
    throw new RuleViolation(`Must discard exactly ${owed} card(s)`);
  }
  if (!canAfford(state.players[player].resources, resources)) {
    throw new RuleViolation('Cannot discard cards you do not hold');
  }

  pay(state.players[player], resources);
  for (const r of RESOURCES) {
    const n = resources[r] ?? 0;
    for (const other of state.players) other.discardMemory[r] += n;
  }
  delete state.pendingDiscards[player];
  log(state, player, `${playerName(state, player)} discarded {0}.`, [resources]);

  if (Object.keys(state.pendingDiscards).length === 0) {
    state.phase = 'moveRobber';
    const mover = state.robberMover ?? state.current;
    log(state, mover, `${playerName(state, mover)} moves the robber.`);
  }
}

function moveRobber(state: GameState, hexId: string) {
  if (state.phase !== 'moveRobber') throw new RuleViolation(`Cannot move the robber during ${state.phase}`);
  if (!state.board.hexes[hexId]?.isLand) throw new RuleViolation('The robber only moves to land');
  if (hexId === state.board.robber) throw new RuleViolation('The robber must move to a different hex');

  state.board.robber = hexId;
  emit(state, { type: 'robberMoved', hexId });
  const mover = state.robberMover ?? state.current;
  log(state, mover, `${playerName(state, mover)} moved the robber.`);

  const victims = victimsOn(state, hexId, mover);
  if (victims.length === 0) {
    finishRobber(state);
  } else if (victims.length === 1) {
    performSteal(state, mover, victims[0]);
    finishRobber(state);
  } else {
    state.victimCandidates = victims;
    state.phase = 'selectVictim';
  }
}

function stealFrom(state: GameState, victim: number | null) {
  if (state.phase !== 'selectVictim') throw new RuleViolation('No steal is pending');
  const mover = state.robberMover ?? state.current;
  if (victim !== null) {
    if (!state.victimCandidates.includes(victim)) throw new RuleViolation('That player cannot be robbed');
    performSteal(state, mover, victim);
  }
  state.victimCandidates = [];
  finishRobber(state);
}

function performSteal(state: GameState, thief: number, victim: number) {
  const pool: Resource[] = [];
  for (const r of RESOURCES) {
    for (let i = 0; i < state.players[victim].resources[r]; i++) pool.push(r);
  }
  if (pool.length === 0) {
    emit(state, { type: 'stolen', from: victim, to: thief, resource: null });
    return;
  }
  const rng = new Rng(state.rngSeed);
  const taken = pool[rng.int(pool.length)];
  state.rngSeed = rng.seed;
  state.players[victim].resources[taken]--;
  state.players[thief].resources[taken]++;
  emit(state, { type: 'stolen', from: victim, to: thief, resource: taken });
  log(
    state,
    thief,
    `${playerName(state, thief)} stole a card from ${playerName(state, victim)}.`,
  );
}

function finishRobber(state: GameState) {
  state.phase = state.resumePhase ?? 'main';
  state.resumePhase = null;
  state.robberMover = null;
  state.victimCandidates = [];
}

/* ------------------------------------------------------------------ *
 * Development cards
 * ------------------------------------------------------------------ */

function buyDevCard(state: GameState) {
  if (state.phase !== 'main') throw new RuleViolation(`Cannot buy a card during ${state.phase}`);
  const player = state.current;
  if (!canBuyDevCard(state, player)) throw new RuleViolation('Cannot afford a development card');

  pay(state.players[player], COSTS.devCard);
  const card = state.devDeck.shift()!;
  state.players[player].devCards.push({ type: card, boughtTurn: state.turn, played: false });
  emit(state, { type: 'devBought', player, card });
  log(state, player, `${playerName(state, player)} bought a development card.`);
}

function consumeDevCard(state: GameState, type: string) {
  const player = state.current;
  if (state.phase !== 'main' && state.phase !== 'rollDice') {
    throw new RuleViolation(`Cannot play a development card during ${state.phase}`);
  }
  const card = playableDevCards(state, player).find((c) => c.type === type);
  if (!card) throw new RuleViolation(`No playable ${type} card`);
  const slot = state.players[player].devCards.find(
    (c) => c.type === type && !c.played && c.boughtTurn < state.turn,
  )!;
  slot.played = true;
  state.playedDevThisTurn = true;
  emit(state, { type: 'devPlayed', player, card: slot.type });
  log(state, player, `${playerName(state, player)} played ${DEV_CARD_LABEL[slot.type]}.`);
}

function playKnight(state: GameState) {
  const resume = state.phase === 'rollDice' ? 'rollDice' : 'main';
  consumeDevCard(state, 'knight');
  state.players[state.current].knightsPlayed++;
  refreshAwards(state);
  state.robberMover = state.current;
  state.resumePhase = resume;
  state.phase = 'moveRobber';
}

function playRoadBuilding(state: GameState) {
  const resume = state.phase === 'rollDice' ? 'rollDice' : 'main';
  consumeDevCard(state, 'roadBuilding');
  const player = state.current;
  const placeable = Object.keys(state.board.edges).filter((e) =>
    canPlaceRoad(state, player, e, { ignoreCost: true }),
  );
  const allowance = Math.min(2, state.players[player].piecesLeft.road, placeable.length);
  if (allowance === 0) {
    log(state, player, `${playerName(state, player)} had nowhere to build.`);
    return;
  }
  state.freeRoadsRemaining = allowance;
  state.resumePhase = resume;
  state.phase = 'roadBuilding';
}

function playYearOfPlenty(state: GameState, picks: [Resource, Resource]) {
  consumeDevCard(state, 'yearOfPlenty');
  const bank = bankStock(state);
  const taken: Resource[] = [];
  for (const r of picks) {
    if (bank[r] > 0) {
      bank[r]--;
      state.players[state.current].resources[r]++;
      taken.push(r);
    }
  }
  if (taken.length < picks.length) log(state, null, 'The bank could not supply every card.');
  if (taken.length) {
    const bag: Partial<ResourceBag> = {};
    for (const r of taken) bag[r] = (bag[r] ?? 0) + 1;
    log(state, state.current, `${playerName(state, state.current)} took {0}.`, [bag]);
  }
}

function playMonopoly(state: GameState, resource: Resource) {
  consumeDevCard(state, 'monopoly');
  let total = 0;
  for (let i = 0; i < state.players.length; i++) {
    if (i === state.current) continue;
    const amount = state.players[i].resources[resource];
    if (amount <= 0) continue;
    state.players[i].resources[resource] = 0;
    total += amount;
  }
  state.players[state.current].resources[resource] += total;
  log(state, state.current, `${playerName(state, state.current)} monopolised {0}.`, [
    { [resource]: total },
  ]);
}

/* ------------------------------------------------------------------ *
 * Trading
 * ------------------------------------------------------------------ */

function bankTrade(state: GameState, give: Resource, receive: Resource) {
  if (state.phase !== 'main') throw new RuleViolation(`Cannot trade during ${state.phase}`);
  const player = state.current;
  if (give === receive) throw new RuleViolation('Pick two different resources');
  const ratio = tradeRatios(state, player)[give];
  if (state.players[player].resources[give] < ratio) {
    throw new RuleViolation(`Need ${ratio} ${RESOURCE_LABEL[give]} for that trade`);
  }
  if (bankStock(state)[receive] <= 0) throw new RuleViolation('The bank is out of that resource');

  state.players[player].resources[give] -= ratio;
  state.players[player].resources[receive] += 1;
  emit(state, { type: 'trade', from: player, to: 'bank' });
  log(state, player, `${playerName(state, player)} traded {0} for {1}.`, [
    { [give]: ratio },
    { [receive]: 1 },
  ]);
}

function offerTrade(
  state: GameState,
  give: Partial<ResourceBag>,
  receive: Partial<ResourceBag>,
  to: number[],
) {
  if (state.phase !== 'main') throw new RuleViolation(`Cannot trade during ${state.phase}`);
  if (bagTotal(give) === 0 || bagTotal(receive) === 0) {
    throw new RuleViolation('An offer needs something on both sides');
  }
  if (!canAfford(state.players[state.current].resources, give)) {
    throw new RuleViolation('You do not hold the cards you are offering');
  }
  state.tradeOffer = { from: state.current, to, give, receive, responses: {}, counters: {} };
  state.offersMadeThisTurn++;
  log(state, state.current, `${playerName(state, state.current)} proposed a trade.`);
}

function respondTrade(
  state: GameState,
  player: number,
  response: 'accept' | 'reject' | 'counter',
  counter?: { give: Partial<ResourceBag>; receive: Partial<ResourceBag> },
) {
  const offer = state.tradeOffer;
  if (!offer) throw new RuleViolation('No trade is on the table');
  if (!offer.to.includes(player)) throw new RuleViolation('That offer was not made to you');
  offer.responses[player] = response;
  if (response === 'counter' && counter) offer.counters[player] = counter;
}

function acceptTrade(state: GameState, partner: number, useCounter: boolean) {
  const offer = state.tradeOffer;
  if (!offer) throw new RuleViolation('No trade is on the table');
  const terms = useCounter ? offer.counters[partner] : { give: offer.give, receive: offer.receive };
  if (!terms) throw new RuleViolation('No counter-offer from that player');

  if (!canSettleTrade(state, offer.from, partner, terms.give, terms.receive)) {
    throw new RuleViolation('Neither side can cover that trade any more');
  }

  pay(state.players[offer.from], terms.give);
  gain(state.players[offer.from], terms.receive);
  pay(state.players[partner], terms.receive);
  gain(state.players[partner], terms.give);

  emit(state, { type: 'trade', from: offer.from, to: partner });
  log(
    state,
    offer.from,
    `${playerName(state, offer.from)} gave {0} to ${playerName(state, partner)} for {1}.`,
    [terms.give, terms.receive],
  );
  state.tradeOffer = null;
}

/* ------------------------------------------------------------------ *
 * Turn flow and awards
 * ------------------------------------------------------------------ */

function endTurn(state: GameState) {
  if (state.phase !== 'main') throw new RuleViolation(`Cannot end the turn during ${state.phase}`);
  state.tradeOffer = null;
  state.playedDevThisTurn = false;
  state.freeRoadsRemaining = 0;
  state.offersMadeThisTurn = 0;
  state.dice = null;
  state.current = (state.current + 1) % state.players.length;
  state.turn++;
  state.phase = 'rollDice';
}

export function refreshAwards(state: GameState) {
  const road = recomputeLongestRoad(state);
  if (road.owner !== state.longestRoad.owner) {
    state.longestRoad = road;
    emit(state, { type: 'awardChanged', award: 'longestRoad', owner: road.owner });
    log(
      state,
      road.owner,
      road.owner === null
        ? 'Longest Road is up for grabs.'
        : `${playerName(state, road.owner)} now holds Longest Road (${road.length}).`,
    );
  } else {
    state.longestRoad = road;
  }

  const army = recomputeLargestArmy(state);
  if (army.owner !== state.largestArmy.owner) {
    state.largestArmy = army;
    emit(state, { type: 'awardChanged', award: 'largestArmy', owner: army.owner });
    log(
      state,
      army.owner,
      army.owner === null
        ? 'Largest Army is up for grabs.'
        : `${playerName(state, army.owner)} now holds Largest Army (${army.size}).`,
    );
  } else {
    state.largestArmy = army;
  }
}

function checkWin(state: GameState) {
  if (state.winner !== null || state.phase === 'gameOver') return;
  const player = state.current;
  if (totalVictoryPoints(state, player) >= VICTORY_POINTS_TO_WIN) {
    state.winner = player;
    state.phase = 'gameOver';
    emit(state, { type: 'gameOver', winner: player });
    log(state, player, `${playerName(state, player)} wins the island!`);
  }
}
