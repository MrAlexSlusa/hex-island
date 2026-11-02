/**
 * Shared board evaluation used by all three bot tiers.
 *
 * Nothing here looks at hidden information: it reads the same board, the same
 * public buildings and the same open card counts a human can see. (The one
 * exception a Hard bot is allowed is `Player.discardMemory`, which only records
 * cards that were publicly discarded.)
 */

import { pipsFor } from '../game/constants';
import { RESOURCES } from '../game/constants';
import { publicVictoryPoints } from '../game/scoring';
import type { GameState, Resource, ResourceBag, VertexId } from '../game/types';

/** How useful each resource is in the abstract, before board scarcity. */
const BASE_WEIGHT: Record<Resource, number> = {
  wood: 1.0,
  brick: 1.0,
  sheep: 0.8,
  wheat: 1.05,
  ore: 0.95,
};

export function emptyNumberBag(): ResourceBag {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

/** Total pips of each resource present on the island. */
export function resourcePips(state: GameState): ResourceBag {
  const totals = emptyNumberBag();
  for (const id of state.board.landHexIds) {
    const hex = state.board.hexes[id];
    if (!hex.resource) continue;
    totals[hex.resource] += pipsFor(hex.token);
  }
  return totals;
}

/** Base usefulness scaled by how scarce the resource is on this particular board. */
export function resourceWeights(state: GameState): Record<Resource, number> {
  const pips = resourcePips(state);
  const average = RESOURCES.reduce((n, r) => n + pips[r], 0) / RESOURCES.length || 1;
  const weights = {} as Record<Resource, number>;
  for (const r of RESOURCES) {
    const scarcity = pips[r] > 0 ? average / pips[r] : 2;
    weights[r] = BASE_WEIGHT[r] * Math.min(1.8, Math.max(0.6, scarcity));
  }
  return weights;
}

/** Expected pips per resource per roll for a player's current buildings. */
export function production(state: GameState, player: number): ResourceBag {
  const out = emptyNumberBag();
  for (const [vertexId, building] of Object.entries(state.buildings)) {
    if (building.owner !== player) continue;
    const multiplier = building.type === 'city' ? 2 : 1;
    for (const hexId of state.board.vertices[vertexId].hexes) {
      const hex = state.board.hexes[hexId];
      if (!hex.resource) continue;
      out[hex.resource] += pipsFor(hex.token) * multiplier;
    }
  }
  return out;
}

export interface SpotOptions {
  /** Weighted in for bots that care about denying opponents a key corner. */
  blockWeight?: number;
  /** Ignore what the player already produces (used when ranking for others). */
  ignoreDiversity?: boolean;
}

/**
 * Scores an intersection: weighted pip income, plus a bonus for resources the
 * player does not yet produce, plus port access.
 */
export function intersectionValue(
  state: GameState,
  vertex: VertexId,
  player: number,
  opts: SpotOptions = {},
): number {
  const v = state.board.vertices[vertex];
  if (!v) return -Infinity;

  const weights = resourceWeights(state);
  const own = opts.ignoreDiversity ? emptyNumberBag() : production(state, player);

  let score = 0;
  const seen = new Set<Resource>();

  for (const hexId of v.hexes) {
    const hex = state.board.hexes[hexId];
    if (!hex.resource) {
      score += 0.15; // a desert corner is not worthless; it is just quiet
      continue;
    }
    const pips = pipsFor(hex.token);
    score += pips * weights[hex.resource];
    seen.add(hex.resource);
    if (own[hex.resource] === 0) score += 1.6 * weights[hex.resource];
  }

  // Three different resources on one corner is worth more than three of a kind.
  score += (seen.size - 1) * 0.9;

  if (v.portId) {
    const port = state.board.ports.find((p) => p.id === v.portId);
    if (port) {
      if (port.kind === 'generic') {
        score += 1.2;
      } else {
        const supply = own[port.kind] + (seen.has(port.kind) ? 4 : 0);
        score += supply > 3 ? 2.2 : 0.6;
      }
    }
  }

  if (opts.blockWeight) {
    score += opts.blockWeight * bestOpponentValue(state, vertex, player);
  }

  return score;
}

/** What this corner would be worth to the opponent who wants it most. */
export function bestOpponentValue(state: GameState, vertex: VertexId, player: number): number {
  let best = 0;
  for (let i = 0; i < state.players.length; i++) {
    if (i === player) continue;
    const value = intersectionValue(state, vertex, i, {});
    if (value > best) best = value;
  }
  return best;
}

/** Highest victory-point total any opponent is openly showing. */
export function leaderScore(state: GameState, player: number): number {
  let best = 0;
  for (let i = 0; i < state.players.length; i++) {
    if (i === player) continue;
    best = Math.max(best, publicVictoryPoints(state, i));
  }
  return best;
}

export function leaderIndex(state: GameState, player: number): number {
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < state.players.length; i++) {
    if (i === player) continue;
    const score = publicVictoryPoints(state, i);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Cards still missing to afford `cost`. */
export function shortfall(hand: ResourceBag, cost: Partial<ResourceBag>): ResourceBag {
  const out = emptyNumberBag();
  for (const r of RESOURCES) out[r] = Math.max(0, (cost[r] ?? 0) - hand[r]);
  return out;
}

/** Cards above what `cost` needs. */
export function surplus(hand: ResourceBag, cost: Partial<ResourceBag>): ResourceBag {
  const out = emptyNumberBag();
  for (const r of RESOURCES) out[r] = Math.max(0, hand[r] - (cost[r] ?? 0));
  return out;
}
