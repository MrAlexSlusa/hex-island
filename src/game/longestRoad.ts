/**
 * Longest-road computation.
 *
 * The route is the longest *trail* through a player's own road segments: an
 * edge may not be reused, but an intersection may be passed more than once
 * (so a closed loop counts for its full length). A route is cut at any
 * intersection carrying an opponent's settlement or city - a path may END on
 * such an intersection but may not continue through it.
 */

import type { Building, EdgeId, GameState, VertexId } from './types';
import { edgeEnds } from './board';

interface Link {
  edge: EdgeId;
  to: VertexId;
}

function buildNetwork(roads: Record<EdgeId, number>, player: number): Map<VertexId, Link[]> {
  const net = new Map<VertexId, Link[]>();
  for (const [edge, owner] of Object.entries(roads)) {
    if (owner !== player) continue;
    const [a, b] = edgeEnds(edge);
    if (!net.has(a)) net.set(a, []);
    if (!net.has(b)) net.set(b, []);
    net.get(a)!.push({ edge, to: b });
    net.get(b)!.push({ edge, to: a });
  }
  return net;
}

export function longestRoadFor(
  roads: Record<EdgeId, number>,
  buildings: Record<VertexId, Building>,
  player: number,
): number {
  const net = buildNetwork(roads, player);
  if (net.size === 0) return 0;

  const blocked = (v: VertexId) => {
    const b = buildings[v];
    return b !== undefined && b.owner !== player;
  };

  const used = new Set<EdgeId>();
  let best = 0;

  const walk = (v: VertexId): number => {
    let longest = 0;
    for (const link of net.get(v) ?? []) {
      if (used.has(link.edge)) continue;
      used.add(link.edge);
      const rest = blocked(link.to) ? 0 : walk(link.to);
      if (1 + rest > longest) longest = 1 + rest;
      used.delete(link.edge);
    }
    return longest;
  };

  for (const start of net.keys()) {
    const length = walk(start);
    if (length > best) best = length;
  }
  return best;
}

export function longestRoadLength(state: GameState, player: number): number {
  return longestRoadFor(state.roads, state.buildings, player);
}

export function allRoadLengths(state: GameState): number[] {
  return state.players.map((_, i) => longestRoadLength(state, i));
}
