import { describe, expect, it } from 'vitest';
import { longestRoadFor, longestRoadLength } from '../src/game/longestRoad';
import { recomputeLongestRoad } from '../src/game/scoring';
import { edgeId, hexVertexIds } from '../src/game/board';
import { findPath, playingGame, putBuilding, putRoad, roadChain } from './helpers';
import type { Building, EdgeId, VertexId } from '../src/game/types';

/** Builds a tiny graph by hand so the shapes under test are unambiguous. */
function graph(edges: [string, string][], owner = 0) {
  const roads: Record<EdgeId, number> = {};
  for (const [a, b] of edges) roads[edgeId(a, b)] = owner;
  return roads;
}

describe('longest road', () => {
  it('counts a straight chain', () => {
    const roads = graph([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
    ]);
    expect(longestRoadFor(roads, {}, 0)).toBe(4);
  });

  it('returns 0 for a player with no roads', () => {
    expect(longestRoadFor(graph([['a', 'b']]), {}, 1)).toBe(0);
  });

  it('ignores branches - only the longest single route counts', () => {
    //      d
    //      |
    // a-b-c-e-f
    const roads = graph([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['c', 'e'],
      ['e', 'f'],
    ]);
    expect(longestRoadFor(roads, {}, 0)).toBe(4); // a-b-c-e-f
  });

  it('counts every segment of a closed loop', () => {
    const roads = graph([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
      ['f', 'a'],
    ]);
    expect(longestRoadFor(roads, {}, 0)).toBe(6);
  });

  it('counts a loop plus its tail', () => {
    const roads = graph([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'a'],
      ['a', 'z'],
      ['z', 'y'],
    ]);
    expect(longestRoadFor(roads, {}, 0)).toBe(6);
  });

  it('may pass an intersection twice but never reuse an edge (figure eight)', () => {
    // Two triangles sharing the vertex "m".
    const roads = graph([
      ['m', 'a'],
      ['a', 'b'],
      ['b', 'm'],
      ['m', 'c'],
      ['c', 'd'],
      ['d', 'm'],
    ]);
    expect(longestRoadFor(roads, {}, 0)).toBe(6);
  });

  it('is cut by an opponent settlement in the middle', () => {
    const roads = graph([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
    ]);
    const buildings: Record<VertexId, Building> = { c: { type: 'settlement', owner: 1 } };
    expect(longestRoadFor(roads, buildings, 0)).toBe(2);
  });

  it('is not cut by the road owner’s own settlement', () => {
    const roads = graph([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
    ]);
    const buildings: Record<VertexId, Building> = { c: { type: 'city', owner: 0 } };
    expect(longestRoadFor(roads, buildings, 0)).toBe(4);
  });

  it('allows a route to end on a blocked intersection', () => {
    const roads = graph([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    const buildings: Record<VertexId, Building> = { c: { type: 'settlement', owner: 1 } };
    expect(longestRoadFor(roads, buildings, 0)).toBe(2);
  });

  it('separates two players’ networks', () => {
    const roads: Record<EdgeId, number> = {
      ...graph(
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
        0,
      ),
      ...graph(
        [
          ['x', 'y'],
          ['y', 'z'],
          ['z', 'w'],
        ],
        1,
      ),
    };
    expect(longestRoadFor(roads, {}, 0)).toBe(2);
    expect(longestRoadFor(roads, {}, 1)).toBe(3);
  });
});

describe('longest road on a real board', () => {
  it('measures a chain laid across actual intersections', () => {
    const state = playingGame();
    const path = findPath(state, 6);
    roadChain(state, path, 0);
    expect(longestRoadLength(state, 0)).toBe(6);
  });

  it('counts a ring of roads around one hex as 6', () => {
    const state = playingGame();
    const hex = state.board.landHexIds[0];
    const corners = hexVertexIds(state.board, hex);
    for (let i = 0; i < 6; i++) {
      putRoad(state, edgeId(corners[i], corners[(i + 1) % 6]), 0);
    }
    expect(longestRoadLength(state, 0)).toBe(6);
  });
});

describe('the Longest Road award', () => {
  it('needs at least 5 segments', () => {
    const state = playingGame();
    roadChain(state, findPath(state, 4), 0);
    expect(recomputeLongestRoad(state).owner).toBeNull();
  });

  it('goes to the first player to reach 5', () => {
    const state = playingGame();
    roadChain(state, findPath(state, 5), 0);
    const award = recomputeLongestRoad(state);
    expect(award).toEqual({ owner: 0, length: 5 });
  });

  it('stays with the holder on a tie and moves only on a strictly longer road', () => {
    const state = playingGame();
    const pathA = findPath(state, 5);
    roadChain(state, pathA, 0);
    state.longestRoad = recomputeLongestRoad(state);
    expect(state.longestRoad.owner).toBe(0);

    // Player 1 ties at 5 somewhere else on the board.
    const far = Object.keys(state.board.vertices).find((v) => !pathA.includes(v))!;
    const pathB = findPath(state, 5, far).filter((v) => !pathA.includes(v));
    if (pathB.length >= 6) {
      roadChain(state, pathB, 1);
      expect(recomputeLongestRoad(state).owner).toBe(0);
    }
  });

  it('is released when the holder’s route is broken and the new lead is tied', () => {
    const state = playingGame();
    state.longestRoad = { owner: 0, length: 5 };
    const roads: Record<EdgeId, number> = graph([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
    ]);
    state.roads = roads;
    // An opponent settlement splits 5 into 2 + 2 ...
    putBuilding(state, 'c', 1, 'settlement');
    expect(longestRoadFor(state.roads, state.buildings, 0)).toBe(3);
    expect(recomputeLongestRoad(state).owner).toBeNull();
  });

  it('hands the award to an opponent whose road becomes the longest', () => {
    const state = playingGame();
    state.longestRoad = { owner: 0, length: 5 };
    state.roads = {
      ...graph(
        [
          ['a', 'b'],
          ['b', 'c'],
          ['c', 'd'],
          ['d', 'e'],
          ['e', 'f'],
        ],
        0,
      ),
      ...graph(
        [
          ['p', 'q'],
          ['q', 'r'],
          ['r', 's'],
          ['s', 't'],
          ['t', 'u'],
          ['u', 'v'],
        ],
        1,
      ),
    };
    expect(recomputeLongestRoad(state)).toEqual({ owner: 1, length: 6 });
  });
});
