import { describe, expect, it } from 'vitest';
import { reduce } from '../src/game/reducer';
import { RuleViolation } from '../src/game/actions';
import {
  canPlaceCity,
  canPlaceRoad,
  canPlaceSettlement,
  respectsDistanceRule,
  validRoadSpots,
  validSettlementSpots,
} from '../src/game/rules';
import { edgeId } from '../src/game/board';
import { COSTS } from '../src/game/constants';
import { giveCards, playingGame, putBuilding, putRoad } from './helpers';

describe('the distance rule', () => {
  it('blocks every intersection next to an existing building', () => {
    const state = playingGame();
    const vertex = Object.keys(state.board.vertices)[10];
    putBuilding(state, vertex, 1, 'settlement');

    expect(respectsDistanceRule(state, vertex)).toBe(false);
    for (const n of state.board.vertices[vertex].adjacent) {
      expect(respectsDistanceRule(state, n)).toBe(false);
    }
    // Two steps away is fine again.
    const twoAway = state.board.vertices[state.board.vertices[vertex].adjacent[0]].adjacent.find(
      (v) => v !== vertex && !state.board.vertices[vertex].adjacent.includes(v),
    )!;
    expect(respectsDistanceRule(state, twoAway)).toBe(true);
  });

  it('applies in the setup phase too', () => {
    const state = playingGame();
    const vertex = Object.keys(state.board.vertices)[3];
    putBuilding(state, vertex, 0, 'settlement');
    const neighbour = state.board.vertices[vertex].adjacent[0];
    expect(canPlaceSettlement(state, 1, neighbour, { setup: true })).toBe(false);
  });

  it('offers all 54 intersections to the first settlement of the game', () => {
    const state = playingGame();
    expect(validSettlementSpots(state, 0, { setup: true })).toHaveLength(54);
  });
});

describe('settlements during play', () => {
  it('must sit on one of your own roads', () => {
    const state = playingGame();
    giveCards(state, 0, COSTS.settlement);
    const edge = Object.keys(state.board.edges)[0];
    const [a, b] = edge.split('|');

    expect(canPlaceSettlement(state, 0, a)).toBe(false);
    putRoad(state, edge, 0);
    expect(canPlaceSettlement(state, 0, a)).toBe(true);
    expect(canPlaceSettlement(state, 0, b)).toBe(true);
    expect(canPlaceSettlement(state, 1, a)).toBe(false);
  });

  it('costs wood, brick, sheep and wheat', () => {
    const state = playingGame();
    const edge = Object.keys(state.board.edges)[0];
    const [a] = edge.split('|');
    putRoad(state, edge, 0);

    giveCards(state, 0, { wood: 1, brick: 1, sheep: 1 });
    expect(() => reduce(state, { type: 'PLACE_SETTLEMENT', vertex: a })).toThrow(RuleViolation);

    giveCards(state, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
    const next = reduce(state, { type: 'PLACE_SETTLEMENT', vertex: a });
    expect(next.buildings[a]).toEqual({ type: 'settlement', owner: 0 });
    expect(next.players[0].resources).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
    expect(next.players[0].piecesLeft.settlement).toBe(4);
  });

  it('runs out after 5 settlements', () => {
    const state = playingGame();
    giveCards(state, 0, COSTS.settlement);
    state.players[0].piecesLeft.settlement = 0;
    const edge = Object.keys(state.board.edges)[0];
    putRoad(state, edge, 0);
    expect(canPlaceSettlement(state, 0, edge.split('|')[0])).toBe(false);
  });
});

describe('roads', () => {
  it('must connect to your own road or building', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 5, brick: 5 });
    const edges = Object.keys(state.board.edges);
    expect(validRoadSpots(state, 0)).toHaveLength(0);

    putBuilding(state, edges[0].split('|')[0], 0, 'settlement');
    const spots = validRoadSpots(state, 0);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots).toContain(edges[0]);
  });

  it('extends from an existing road', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 5, brick: 5 });
    const first = Object.keys(state.board.edges)[0];
    const [, b] = first.split('|');
    putRoad(state, first, 0);

    const onward = state.board.vertices[b].edges.find((e) => e !== first)!;
    expect(canPlaceRoad(state, 0, onward)).toBe(true);
  });

  it('cannot be built through an opponent settlement', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 5, brick: 5 });
    const first = Object.keys(state.board.edges)[0];
    const [, b] = first.split('|');
    putRoad(state, first, 0);
    putBuilding(state, b, 1, 'settlement');

    const onward = state.board.vertices[b].edges.find((e) => e !== first)!;
    expect(canPlaceRoad(state, 0, onward)).toBe(false);
  });

  it('cannot overlap an existing road', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 5, brick: 5 });
    const edge = Object.keys(state.board.edges)[0];
    putBuilding(state, edge.split('|')[0], 0, 'settlement');
    putRoad(state, edge, 1);
    expect(canPlaceRoad(state, 0, edge)).toBe(false);
  });

  it('costs wood and brick', () => {
    const state = playingGame();
    const edge = Object.keys(state.board.edges)[0];
    putBuilding(state, edge.split('|')[0], 0, 'settlement');

    giveCards(state, 0, { wood: 1 });
    expect(() => reduce(state, { type: 'PLACE_ROAD', edge })).toThrow(RuleViolation);

    giveCards(state, 0, { wood: 1, brick: 1 });
    const next = reduce(state, { type: 'PLACE_ROAD', edge });
    expect(next.roads[edge]).toBe(0);
    expect(next.players[0].piecesLeft.road).toBe(14);
  });
});

describe('cities', () => {
  it('replace one of your own settlements for 2 wheat and 3 ore', () => {
    const state = playingGame();
    const vertex = Object.keys(state.board.vertices)[5];
    putBuilding(state, vertex, 0, 'settlement');

    giveCards(state, 0, { wheat: 2, ore: 2 });
    expect(canPlaceCity(state, 0, vertex)).toBe(false);

    giveCards(state, 0, { wheat: 2, ore: 3 });
    const next = reduce(state, { type: 'PLACE_CITY', vertex });
    expect(next.buildings[vertex]).toEqual({ type: 'city', owner: 0 });
    expect(next.players[0].piecesLeft.city).toBe(3);
    // The settlement piece goes back in the supply.
    expect(next.players[0].piecesLeft.settlement).toBe(6);
  });

  it('cannot be built on empty ground, on a city, or on an opponent settlement', () => {
    const state = playingGame();
    giveCards(state, 0, { wheat: 4, ore: 6 });
    const [a, b, c] = Object.keys(state.board.vertices);
    putBuilding(state, b, 0, 'city');
    putBuilding(state, c, 1, 'settlement');

    expect(canPlaceCity(state, 0, a)).toBe(false);
    expect(canPlaceCity(state, 0, b)).toBe(false);
    expect(canPlaceCity(state, 0, c)).toBe(false);
  });
});

describe('free roads from Road Building', () => {
  it('places two roads without spending cards', () => {
    let state = playingGame();
    const edge = Object.keys(state.board.edges)[0];
    const [, b] = edge.split('|');
    putBuilding(state, edge.split('|')[0], 0, 'settlement');
    state.players[0].devCards = [{ type: 'roadBuilding', boughtTurn: 1, played: false }];

    state = reduce(state, { type: 'PLAY_ROAD_BUILDING' });
    expect(state.phase).toBe('roadBuilding');
    expect(state.freeRoadsRemaining).toBe(2);

    state = reduce(state, { type: 'PLACE_ROAD', edge });
    expect(state.phase).toBe('roadBuilding');
    expect(state.freeRoadsRemaining).toBe(1);

    const onward = state.board.vertices[b].edges.find((e) => e !== edge)!;
    state = reduce(state, { type: 'PLACE_ROAD', edge: onward });
    expect(state.phase).toBe('main');
    expect(state.players[0].resources).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
    expect(state.players[0].piecesLeft.road).toBe(13);
  });

  it('hands back control when only one road can be placed', () => {
    let state = playingGame();
    const edge = Object.keys(state.board.edges)[0];
    putBuilding(state, edge.split('|')[0], 0, 'settlement');
    state.players[0].devCards = [{ type: 'roadBuilding', boughtTurn: 1, played: false }];
    state.players[0].piecesLeft.road = 1;

    state = reduce(state, { type: 'PLAY_ROAD_BUILDING' });
    expect(state.freeRoadsRemaining).toBe(1);
    state = reduce(state, { type: 'PLACE_ROAD', edge });
    expect(state.phase).toBe('main');
  });
});

describe('the setup snake draft', () => {
  it('runs 1..N then N..1 and gives resources for the second settlement only', () => {
    let state = playingGame(99);
    state.phase = 'setupSettlement';
    state.setupIndex = 0;
    state.current = state.setupOrder[0];
    state.turn = 0;

    expect(state.setupOrder).toEqual([0, 1, 2, 2, 1, 0]);

    const placedBy: number[] = [];
    while (state.phase === 'setupSettlement' || state.phase === 'setupRoad') {
      if (state.phase === 'setupSettlement') {
        placedBy.push(state.current);
        const spot = validSettlementSpots(state, state.current, { setup: true })[0];
        state = reduce(state, { type: 'PLACE_SETTLEMENT', vertex: spot });
      } else {
        const spot = state.board.vertices[state.setupSettlement!].edges.find(
          (e) => state.roads[e] === undefined,
        )!;
        state = reduce(state, { type: 'PLACE_ROAD', edge: spot });
      }
    }

    expect(placedBy).toEqual([0, 1, 2, 2, 1, 0]);
    expect(state.phase).toBe('rollDice');
    expect(state.current).toBe(0);
    expect(state.turn).toBe(1);
    expect(Object.keys(state.buildings)).toHaveLength(6);
    expect(Object.keys(state.roads)).toHaveLength(6);

    // Every player banked something from their second settlement, and the
    // setup roads were free.
    for (const p of state.players) {
      const total = p.resources.wood + p.resources.brick + p.resources.sheep + p.resources.wheat + p.resources.ore;
      expect(total).toBeGreaterThanOrEqual(1);
      expect(total).toBeLessThanOrEqual(3);
    }
  });

  it('requires the setup road to touch the settlement just placed', () => {
    let state = playingGame(5);
    state.phase = 'setupSettlement';
    state.setupIndex = 0;
    state.current = 0;

    const spot = validSettlementSpots(state, 0, { setup: true })[20];
    state = reduce(state, { type: 'PLACE_SETTLEMENT', vertex: spot });

    const far = Object.keys(state.board.edges).find(
      (e) => !state.board.vertices[spot].edges.includes(e),
    )!;
    expect(() => reduce(state, { type: 'PLACE_ROAD', edge: far })).toThrow(RuleViolation);

    const near = state.board.vertices[spot].edges[0];
    const next = reduce(state, { type: 'PLACE_ROAD', edge: near });
    expect(next.roads[near]).toBe(0);
  });

  it('does not charge for setup pieces', () => {
    let state = playingGame(7);
    state.phase = 'setupSettlement';
    state.setupIndex = 0;
    state.current = 0;
    const spot = validSettlementSpots(state, 0, { setup: true })[0];
    state = reduce(state, { type: 'PLACE_SETTLEMENT', vertex: spot });
    state = reduce(state, { type: 'PLACE_ROAD', edge: state.board.vertices[spot].edges[0] });
    expect(state.players[0].resources).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  });
});

describe('edge ids', () => {
  it('are order-independent', () => {
    expect(edgeId('1,2', '3,4')).toBe(edgeId('3,4', '1,2'));
  });
});
