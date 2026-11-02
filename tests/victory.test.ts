import { describe, expect, it } from 'vitest';
import { reduce } from '../src/game/reducer';
import {
  allScores,
  hasWon,
  publicVictoryPoints,
  scoreline,
  totalVictoryPoints,
} from '../src/game/scoring';
import { deserialize, serialize } from '../src/game/state';
import { findPath, giveCards, playingGame, putBuilding, roadChain } from './helpers';
import type { VertexId } from '../src/game/types';

/** Spreads `n` buildings around the board without touching the distance rule. */
function scatter(state: ReturnType<typeof playingGame>, owner: number, n: number, type: 'settlement' | 'city') {
  const used = new Set<VertexId>();
  let placed = 0;
  for (const v of Object.keys(state.board.vertices)) {
    if (placed >= n) break;
    if (used.has(v) || state.buildings[v]) continue;
    const clash = state.board.vertices[v].adjacent.some((a) => state.buildings[a]);
    if (clash) continue;
    putBuilding(state, v, owner, type);
    used.add(v);
    placed++;
  }
  return [...used];
}

describe('victory points', () => {
  it('counts 1 per settlement and 2 per city', () => {
    const state = playingGame();
    scatter(state, 0, 3, 'settlement');
    expect(totalVictoryPoints(state, 0)).toBe(3);

    const first = Object.keys(state.buildings)[0];
    state.buildings[first].type = 'city';
    expect(totalVictoryPoints(state, 0)).toBe(4);
  });

  it('adds 2 for Longest Road and 2 for Largest Army', () => {
    const state = playingGame();
    scatter(state, 0, 2, 'settlement');
    state.longestRoad = { owner: 0, length: 6 };
    state.largestArmy = { owner: 0, size: 4 };
    expect(totalVictoryPoints(state, 0)).toBe(6);

    state.largestArmy = { owner: 1, size: 5 };
    expect(totalVictoryPoints(state, 0)).toBe(4);
    expect(totalVictoryPoints(state, 1)).toBe(2);
  });

  it('counts victory-point cards for the owner but hides them from opponents', () => {
    const state = playingGame();
    scatter(state, 0, 2, 'settlement');
    state.players[0].devCards = [
      { type: 'victoryPoint', boughtTurn: 1, played: false },
      { type: 'victoryPoint', boughtTurn: 1, played: false },
      { type: 'knight', boughtTurn: 1, played: true },
    ];

    expect(totalVictoryPoints(state, 0)).toBe(4);
    expect(publicVictoryPoints(state, 0)).toBe(2);

    const line = scoreline(state, 0);
    expect(line.devVP).toBe(2);
    expect(line.settlements).toBe(2);
  });

  it('breaks the final score down per source', () => {
    const state = playingGame();
    const spots = scatter(state, 0, 4, 'settlement');
    state.buildings[spots[0]].type = 'city';
    state.buildings[spots[1]].type = 'city';
    state.longestRoad = { owner: 0, length: 7 };
    state.players[0].devCards = [{ type: 'victoryPoint', boughtTurn: 1, played: false }];

    expect(scoreline(state, 0)).toEqual({
      player: 0,
      settlements: 2,
      cities: 2,
      devVP: 1,
      longestRoad: 2,
      largestArmy: 0,
      total: 9,
      publicTotal: 8,
    });
    expect(allScores(state)).toHaveLength(3);
  });
});

describe('winning', () => {
  it('needs 10 points', () => {
    const state = playingGame();
    const spots = scatter(state, 0, 4, 'settlement');
    for (const s of spots) state.buildings[s].type = 'city'; // 8
    state.longestRoad = { owner: 0, length: 5 }; // 10
    expect(hasWon(state, 0)).toBe(true);

    state.longestRoad = { owner: null, length: 0 };
    expect(hasWon(state, 0)).toBe(false);
  });

  it('ends the game the moment the current player reaches 10', () => {
    let state = playingGame();
    const spots = scatter(state, 0, 4, 'settlement');
    for (const s of spots) state.buildings[s].type = 'city'; // 8 points
    state.players[0].devCards = [{ type: 'victoryPoint', boughtTurn: 1, played: false }]; // 9

    // A fifth settlement on one of their own roads takes them to 10.
    const edge = Object.keys(state.board.edges).find((e) => {
      const [a, b] = e.split('|');
      if (state.buildings[a] || state.buildings[b]) return false;
      return (
        !state.board.vertices[a].adjacent.some((v) => state.buildings[v]) ||
        !state.board.vertices[b].adjacent.some((v) => state.buildings[v])
      );
    })!;
    state.roads[edge] = 0;
    const [a, b] = edge.split('|');
    const target = state.board.vertices[a].adjacent.some((v) => state.buildings[v]) ? b : a;

    giveCards(state, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
    state = reduce(state, { type: 'PLACE_SETTLEMENT', vertex: target });

    expect(state.winner).toBe(0);
    expect(state.phase).toBe('gameOver');
    expect(state.events.some((e) => e.type === 'gameOver')).toBe(true);
  });

  it('can be won by taking Longest Road on your own turn', () => {
    let state = playingGame();
    const spots = scatter(state, 0, 4, 'settlement');
    for (const s of spots) state.buildings[s].type = 'city'; // 8 points

    const path = findPath(state, 5);
    roadChain(state, path.slice(0, 5), 0);
    giveCards(state, 0, { wood: 1, brick: 1 });

    const last = path[4];
    const closing = state.board.vertices[last].edges.find(
      (e) => state.roads[e] === undefined && e.includes(path[5]),
    );
    if (closing) {
      state = reduce(state, { type: 'PLACE_ROAD', edge: closing });
      expect(state.longestRoad.owner).toBe(0);
      expect(state.winner).toBe(0);
    }
  });

  it('does not end the game for a player who is not on turn', () => {
    const state = playingGame();
    const spots = scatter(state, 1, 5, 'settlement');
    for (const s of spots) state.buildings[s].type = 'city'; // player 1 has 10
    const next = reduce(state, { type: 'CANCEL_TRADE' });
    expect(totalVictoryPoints(next, 1)).toBe(10);
    expect(next.winner).toBeNull();
  });
});

describe('save and load', () => {
  it('round-trips a game through JSON', () => {
    let state = playingGame(4242);
    scatter(state, 0, 2, 'settlement');
    giveCards(state, 0, { wood: 3, ore: 1 });
    state = reduce(state, { type: 'CANCEL_TRADE' });

    const restored = deserialize(serialize(state));

    expect(restored.board).toEqual(state.board);
    expect(restored.players).toEqual(state.players);
    expect(restored.buildings).toEqual(state.buildings);
    expect(restored.rngSeed).toBe(state.rngSeed);
    expect(restored.events).toEqual([]);
  });

  it('rejects a save from an unknown version', () => {
    const state = playingGame();
    const bad = JSON.parse(serialize(state));
    bad.version = 999;
    expect(() => deserialize(JSON.stringify(bad))).toThrow();
  });
});
