import { createGame } from '../src/game/state';
import type { BuildingType, EdgeId, GameState, HexId, VertexId } from '../src/game/types';
import { hexVertexIds } from '../src/game/board';

export function newGame(seed = 1234, botCount = 2): GameState {
  return createGame({
    seed,
    seats: [
      { name: 'You', colorIndex: 0, isBot: false, difficulty: null },
      ...Array.from({ length: botCount }, (_, i) => ({
        name: `Bot ${i + 1}`,
        colorIndex: i + 1,
        isBot: true,
        difficulty: 'normal' as const,
      })),
    ],
  });
}

/** Drops a game straight into the main phase with an empty board. */
export function playingGame(seed = 1234, botCount = 2): GameState {
  const state = newGame(seed, botCount);
  state.phase = 'main';
  state.turn = 5;
  state.setupIndex = state.setupOrder.length;
  state.current = 0;
  return state;
}

export function putBuilding(
  state: GameState,
  vertex: VertexId,
  owner: number,
  type: BuildingType = 'settlement',
) {
  state.buildings[vertex] = { type, owner };
}

export function putRoad(state: GameState, edge: EdgeId, owner: number) {
  state.roads[edge] = owner;
}

export function giveCards(state: GameState, player: number, cards: Partial<Record<string, number>>) {
  for (const [k, v] of Object.entries(cards)) {
    (state.players[player].resources as Record<string, number>)[k] = v as number;
  }
}

/** First land hex carrying `token`. */
export function hexWithToken(state: GameState, token: number): HexId {
  const id = state.board.landHexIds.find((h) => state.board.hexes[h].token === token);
  if (!id) throw new Error(`No hex with token ${token}`);
  return id;
}

export function cornersOf(state: GameState, hexId: HexId): VertexId[] {
  return hexVertexIds(state.board, hexId);
}

/** Builds a chain of connected edges along `vertices`, owned by `player`. */
export function roadChain(state: GameState, vertices: VertexId[], player: number) {
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!state.board.edges[edge]) throw new Error(`No edge between ${a} and ${b}`);
    state.roads[edge] = player;
  }
}

/** Walks the vertex graph to find a simple path of `length` edges. */
export function findPath(state: GameState, length: number, from?: VertexId): VertexId[] {
  const start = from ?? Object.keys(state.board.vertices)[0];
  const path: VertexId[] = [start];
  const seen = new Set<VertexId>([start]);

  const walk = (): boolean => {
    if (path.length === length + 1) return true;
    const current = path[path.length - 1];
    for (const next of state.board.vertices[current].adjacent) {
      if (seen.has(next)) continue;
      seen.add(next);
      path.push(next);
      if (walk()) return true;
      path.pop();
      seen.delete(next);
    }
    return false;
  };

  if (!walk()) throw new Error(`No path of length ${length}`);
  return path;
}
