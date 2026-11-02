/**
 * Victory points and the two awards.
 */

import { MIN_LARGEST_ARMY, MIN_LONGEST_ROAD, VICTORY_POINTS_TO_WIN } from './constants';
import { allRoadLengths } from './longestRoad';
import type { GameState, Scoreline } from './types';

export function buildingCounts(state: GameState, player: number) {
  let settlements = 0;
  let cities = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.owner !== player) continue;
    if (b.type === 'city') cities++;
    else settlements++;
  }
  return { settlements, cities };
}

export function victoryPointCards(state: GameState, player: number): number {
  return state.players[player].devCards.filter((c) => c.type === 'victoryPoint').length;
}

export function scoreline(state: GameState, player: number): Scoreline {
  const { settlements, cities } = buildingCounts(state, player);
  const devVP = victoryPointCards(state, player);
  const longestRoad = state.longestRoad.owner === player ? 2 : 0;
  const largestArmy = state.largestArmy.owner === player ? 2 : 0;
  const publicTotal = settlements + cities * 2 + longestRoad + largestArmy;
  return {
    player,
    settlements,
    cities,
    devVP,
    longestRoad,
    largestArmy,
    total: publicTotal + devVP,
    publicTotal,
  };
}

export function allScores(state: GameState): Scoreline[] {
  return state.players.map((_, i) => scoreline(state, i));
}

export function totalVictoryPoints(state: GameState, player: number): number {
  return scoreline(state, player).total;
}

/** What opponents can see: hidden victory-point cards are not counted. */
export function publicVictoryPoints(state: GameState, player: number): number {
  return scoreline(state, player).publicTotal;
}

export function hasWon(state: GameState, player: number): boolean {
  return totalVictoryPoints(state, player) >= VICTORY_POINTS_TO_WIN;
}

/**
 * Recomputes Longest Road from the current network.
 *
 * The holder keeps the award while still tied for the lead. If their route is
 * broken and several players tie for the new lead, nobody holds it until one
 * player is strictly longest again.
 */
export function recomputeLongestRoad(state: GameState): { owner: number | null; length: number } {
  const lengths = allRoadLengths(state);
  const best = Math.max(0, ...lengths);
  if (best < MIN_LONGEST_ROAD) return { owner: null, length: best };

  const leaders = lengths.map((l, i) => ({ l, i })).filter((e) => e.l === best);
  const holder = state.longestRoad.owner;

  if (holder !== null && lengths[holder] === best) return { owner: holder, length: best };
  if (leaders.length === 1) return { owner: leaders[0].i, length: best };
  return { owner: null, length: best };
}

/** Largest Army: 3+ knights, strictly more than the current holder to take it. */
export function recomputeLargestArmy(state: GameState): { owner: number | null; size: number } {
  const counts = state.players.map((p) => p.knightsPlayed);
  const best = Math.max(0, ...counts);
  if (best < MIN_LARGEST_ARMY) return { owner: null, size: best };

  const holder = state.largestArmy.owner;
  if (holder !== null && counts[holder] === best) return { owner: holder, size: best };

  const leaders = counts.map((c, i) => ({ c, i })).filter((e) => e.c === best);
  if (leaders.length === 1) return { owner: leaders[0].i, size: best };
  return { owner: holder, size: best };
}
