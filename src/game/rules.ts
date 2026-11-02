/**
 * Pure rule predicates: what may legally be built, traded or targeted.
 * Nothing here mutates state.
 */

import { edgeEnds } from './board';
import { COSTS, RESOURCES, canAfford } from './constants';
import type {
  EdgeId,
  GameState,
  HexId,
  Resource,
  ResourceBag,
  VertexId,
} from './types';

export function hand(state: GameState, player: number): ResourceBag {
  return state.players[player].resources;
}

export function handSize(state: GameState, player: number): number {
  const r = state.players[player].resources;
  return RESOURCES.reduce((n, k) => n + r[k], 0);
}

/* ------------------------------------------------------------------ *
 * Settlements
 * ------------------------------------------------------------------ */

/** The distance rule: no settlement may sit next to another settlement/city. */
export function respectsDistanceRule(state: GameState, vertex: VertexId): boolean {
  const v = state.board.vertices[vertex];
  if (!v) return false;
  if (state.buildings[vertex]) return false;
  return v.adjacent.every((n) => state.buildings[n] === undefined);
}

/** During normal play a settlement must also sit on one of the player's roads. */
export function touchesOwnRoad(state: GameState, player: number, vertex: VertexId): boolean {
  const v = state.board.vertices[vertex];
  if (!v) return false;
  return v.edges.some((e) => state.roads[e] === player);
}

export function canPlaceSettlement(
  state: GameState,
  player: number,
  vertex: VertexId,
  opts: { setup?: boolean; ignoreCost?: boolean } = {},
): boolean {
  if (state.players[player].piecesLeft.settlement <= 0) return false;
  if (!respectsDistanceRule(state, vertex)) return false;
  if (opts.setup) return true;
  if (!touchesOwnRoad(state, player, vertex)) return false;
  if (!opts.ignoreCost && !canAfford(state.players[player].resources, COSTS.settlement)) return false;
  return true;
}

export function validSettlementSpots(
  state: GameState,
  player: number,
  opts: { setup?: boolean; ignoreCost?: boolean } = {},
): VertexId[] {
  return Object.keys(state.board.vertices).filter((v) => canPlaceSettlement(state, player, v, opts));
}

/* ------------------------------------------------------------------ *
 * Cities
 * ------------------------------------------------------------------ */

export function canPlaceCity(
  state: GameState,
  player: number,
  vertex: VertexId,
  opts: { ignoreCost?: boolean } = {},
): boolean {
  if (state.players[player].piecesLeft.city <= 0) return false;
  const b = state.buildings[vertex];
  if (!b || b.owner !== player || b.type !== 'settlement') return false;
  if (!opts.ignoreCost && !canAfford(state.players[player].resources, COSTS.city)) return false;
  return true;
}

export function validCitySpots(
  state: GameState,
  player: number,
  opts: { ignoreCost?: boolean } = {},
): VertexId[] {
  return Object.keys(state.buildings).filter((v) => canPlaceCity(state, player, v, opts));
}

/* ------------------------------------------------------------------ *
 * Roads
 * ------------------------------------------------------------------ */

/**
 * A road may be laid on an empty edge that touches either one of the player's
 * own buildings, or an intersection where the player already has a road and no
 * opponent building sits in the way.
 */
export function roadConnects(state: GameState, player: number, edge: EdgeId): boolean {
  const [a, b] = edgeEnds(edge);
  for (const v of [a, b]) {
    const building = state.buildings[v];
    if (building?.owner === player) return true;
    if (building && building.owner !== player) continue; // cannot build through
    const vertex = state.board.vertices[v];
    if (!vertex) continue;
    if (vertex.edges.some((e) => e !== edge && state.roads[e] === player)) return true;
  }
  return false;
}

export function canPlaceRoad(
  state: GameState,
  player: number,
  edge: EdgeId,
  opts: { setup?: VertexId | null; ignoreCost?: boolean } = {},
): boolean {
  if (!state.board.edges[edge]) return false;
  if (state.roads[edge] !== undefined) return false;
  if (state.players[player].piecesLeft.road <= 0) return false;

  if (opts.setup) {
    const [a, b] = edgeEnds(edge);
    return a === opts.setup || b === opts.setup;
  }

  if (!roadConnects(state, player, edge)) return false;
  if (!opts.ignoreCost && !canAfford(state.players[player].resources, COSTS.road)) return false;
  return true;
}

export function validRoadSpots(
  state: GameState,
  player: number,
  opts: { setup?: VertexId | null; ignoreCost?: boolean } = {},
): EdgeId[] {
  return Object.keys(state.board.edges).filter((e) => canPlaceRoad(state, player, e, opts));
}

/* ------------------------------------------------------------------ *
 * Ports and trading
 * ------------------------------------------------------------------ */

/** Best bank-trade ratio per resource, taking the player's ports into account. */
export function tradeRatios(state: GameState, player: number): Record<Resource, number> {
  const ratios: Record<Resource, number> = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
  for (const port of state.board.ports) {
    const owned = port.vertices.some((v) => state.buildings[v]?.owner === player);
    if (!owned) continue;
    if (port.kind === 'generic') {
      for (const r of RESOURCES) ratios[r] = Math.min(ratios[r], 3);
    } else {
      ratios[port.kind] = Math.min(ratios[port.kind], 2);
    }
  }
  return ratios;
}

export function ownedPorts(state: GameState, player: number) {
  return state.board.ports.filter((p) => p.vertices.some((v) => state.buildings[v]?.owner === player));
}

export function canBankTrade(
  state: GameState,
  player: number,
  give: Resource,
  receive: Resource,
): boolean {
  if (give === receive) return false;
  const ratio = tradeRatios(state, player)[give];
  return state.players[player].resources[give] >= ratio;
}

/** Validates a player-to-player offer: both sides must be able to pay. */
export function canSettleTrade(
  state: GameState,
  from: number,
  to: number,
  give: Partial<ResourceBag>,
  receive: Partial<ResourceBag>,
): boolean {
  if (from === to) return false;
  let gave = 0;
  let got = 0;
  for (const r of RESOURCES) {
    const g = give[r] ?? 0;
    const v = receive[r] ?? 0;
    if (g < 0 || v < 0) return false;
    if (g > 0 && v > 0) return false; // no trading a resource for itself
    if (state.players[from].resources[r] < g) return false;
    if (state.players[to].resources[r] < v) return false;
    gave += g;
    got += v;
  }
  return gave > 0 && got > 0;
}

/* ------------------------------------------------------------------ *
 * Robber
 * ------------------------------------------------------------------ */

export function robberTargets(state: GameState): HexId[] {
  return state.board.landHexIds.filter((id) => id !== state.board.robber);
}

/** Opponents with at least one card who have a building on `hexId`. */
export function victimsOn(state: GameState, hexId: HexId, robberOwner: number): number[] {
  const victims = new Set<number>();
  for (const [vid, building] of Object.entries(state.buildings)) {
    if (building.owner === robberOwner) continue;
    if (!state.board.vertices[vid].hexes.includes(hexId)) continue;
    if (handSize(state, building.owner) === 0) continue;
    victims.add(building.owner);
  }
  return [...victims].sort((a, b) => a - b);
}

export function canBuyDevCard(state: GameState, player: number): boolean {
  if (state.devDeck.length === 0) return false;
  return canAfford(state.players[player].resources, COSTS.devCard);
}

/** Dev cards this player may play right now (bought on an earlier turn, unplayed). */
export function playableDevCards(state: GameState, player: number) {
  if (state.playedDevThisTurn) return [];
  return state.players[player].devCards.filter(
    (c) => !c.played && c.type !== 'victoryPoint' && c.boughtTurn < state.turn,
  );
}
