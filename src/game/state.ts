/**
 * Game-state construction, cloning and (de)serialisation.
 */

import { createBoard } from './board';
import { DEV_DECK, PIECE_LIMITS, PLAYER_COLORS, emptyBag } from './constants';
import { Rng } from './rng';
import type { Difficulty, GameState, Player } from './types';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'hex-island:save';

export interface SeatConfig {
  name: string;
  colorIndex: number;
  isBot: boolean;
  difficulty: Difficulty | null;
}

export interface GameConfig {
  seats: SeatConfig[];
  seed?: number;
}

function makePlayer(seat: SeatConfig, id: number): Player {
  const palette = PLAYER_COLORS[seat.colorIndex % PLAYER_COLORS.length];
  return {
    id,
    name: seat.name,
    color: palette.color,
    colorDark: palette.dark,
    colorName: palette.name,
    isBot: seat.isBot,
    difficulty: seat.difficulty,
    resources: emptyBag(),
    devCards: [],
    knightsPlayed: 0,
    piecesLeft: { ...PIECE_LIMITS },
    discardMemory: emptyBag(),
  };
}

/** Snake draft: 0,1,..,N-1, then N-1,..,1,0. */
export function snakeOrder(playerCount: number): number[] {
  const forward = Array.from({ length: playerCount }, (_, i) => i);
  return [...forward, ...forward.slice().reverse()];
}

export function createGame(config: GameConfig): GameState {
  const seed = (config.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const rng = new Rng(seed);
  const board = createBoard(rng);
  const players = config.seats.map(makePlayer);
  const setupOrder = snakeOrder(players.length);

  return {
    version: SAVE_VERSION,
    board,
    players,
    current: setupOrder[0],
    phase: 'setupSettlement',
    turn: 0,
    dice: null,
    setupOrder,
    setupIndex: 0,
    setupSettlement: null,
    buildings: {},
    roads: {},
    devDeck: rng.shuffle(DEV_DECK),
    playedDevThisTurn: false,
    pendingDiscards: {},
    robberMover: null,
    victimCandidates: [],
    freeRoadsRemaining: 0,
    offersMadeThisTurn: 0,
    longestRoad: { owner: null, length: 0 },
    largestArmy: { owner: null, size: 0 },
    winner: null,
    rngSeed: rng.seed,
    log: [{ turn: 0, player: null, text: 'Setup: place your first settlement.' }],
    events: [],
    tradeOffer: null,
    resumePhase: null,
  };
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export function serialize(state: GameState): string {
  const { events: _events, ...rest } = state;
  return JSON.stringify(rest);
}

export function deserialize(json: string): GameState {
  const parsed = JSON.parse(json) as GameState;
  if (parsed.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${parsed.version}`);
  }
  parsed.events = [];
  return parsed;
}

export function saveToStorage(state: GameState, key = SAVE_KEY): void {
  localStorage.setItem(key, serialize(state));
}

export function loadFromStorage(key = SAVE_KEY): GameState | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function clearStorage(key = SAVE_KEY): void {
  localStorage.removeItem(key);
}

export function hasSave(key = SAVE_KEY): boolean {
  return localStorage.getItem(key) !== null;
}
