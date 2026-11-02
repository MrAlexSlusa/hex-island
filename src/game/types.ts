/**
 * Core data types for Hex Island.
 *
 * Everything in `src/game` is pure data + pure functions: no DOM, no canvas,
 * no randomness other than the seeded RNG carried inside the state. That makes
 * the whole rules engine unit-testable and the state trivially serializable.
 */

export type Resource = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore';

export type Terrain =
  | 'forest'
  | 'hills'
  | 'pasture'
  | 'fields'
  | 'mountains'
  | 'desert'
  | 'ocean';

export type ResourceBag = Record<Resource, number>;

/** "q,r" axial coordinates of a hex. */
export type HexId = string;
/** "X,Y" position on the integer corner lattice (see board.ts). */
export type VertexId = string;
/** "vertexA|vertexB" with the two vertex ids sorted. */
export type EdgeId = string;

export interface Hex {
  id: HexId;
  q: number;
  r: number;
  terrain: Terrain;
  /** null for desert and ocean */
  resource: Resource | null;
  /** null for desert and ocean */
  token: number | null;
  isLand: boolean;
}

export type PortKind = 'generic' | Resource;

export interface Port {
  id: string;
  kind: PortKind;
  /** 3 for generic ports, 2 for resource-specific ports. */
  ratio: 2 | 3;
  /** The two coastal intersections that grant access to this port. */
  vertices: [VertexId, VertexId];
  /** The ocean hex the port marker is drawn on. */
  hexId: HexId;
  /** Radians, from the ocean hex centre towards the coast. */
  angle: number;
}

export interface Vertex {
  id: VertexId;
  /** Integer lattice coordinates; multiply by the unit vectors for pixels. */
  lx: number;
  ly: number;
  /** Land hexes touching this corner (1..3). */
  hexes: HexId[];
  adjacent: VertexId[];
  edges: EdgeId[];
  portId: string | null;
}

export interface Edge {
  id: EdgeId;
  a: VertexId;
  b: VertexId;
  hexes: HexId[];
}

export interface Board {
  hexes: Record<HexId, Hex>;
  /** Land hexes first (render order), then the ocean ring. */
  hexOrder: HexId[];
  landHexIds: HexId[];
  vertices: Record<VertexId, Vertex>;
  edges: Record<EdgeId, Edge>;
  ports: Port[];
  robber: HexId;
}

export type BuildingType = 'settlement' | 'city';

export interface Building {
  type: BuildingType;
  owner: number;
}

export type DevCardType =
  | 'knight'
  | 'victoryPoint'
  | 'roadBuilding'
  | 'yearOfPlenty'
  | 'monopoly';

export interface DevCard {
  type: DevCardType;
  /** Turn index the card was bought on; it cannot be played the same turn. */
  boughtTurn: number;
  played: boolean;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Player {
  id: number;
  name: string;
  /** Primary colour (hex string). */
  color: string;
  /** Darker shade used for outlines and shadows. */
  colorDark: string;
  colorName: string;
  isBot: boolean;
  difficulty: Difficulty | null;
  resources: ResourceBag;
  devCards: DevCard[];
  knightsPlayed: number;
  piecesLeft: { road: number; settlement: number; city: number };
  /** Cards seen leaving other hands - only Hard bots are allowed to read this. */
  discardMemory: ResourceBag;
}

export type Phase =
  | 'setupSettlement'
  | 'setupRoad'
  | 'rollDice'
  | 'discard'
  | 'moveRobber'
  | 'selectVictim'
  | 'main'
  | 'roadBuilding'
  | 'gameOver';

export interface TradeOffer {
  from: number;
  /** Player indices the offer was made to. */
  to: number[];
  give: Partial<ResourceBag>;
  receive: Partial<ResourceBag>;
  /** player index -> their answer */
  responses: Record<number, 'accept' | 'reject' | 'counter'>;
  counters: Record<number, { give: Partial<ResourceBag>; receive: Partial<ResourceBag> }>;
}

export interface LogEntry {
  turn: number;
  player: number | null;
  /**
   * The line as plain text, except that `{0}`, `{1}` ... stand in for the
   * matching entry in `bags`, which the panel draws as resource badges.
   */
  text: string;
  /** A count of 0 means "name the resource, but not an amount". */
  bags?: Partial<ResourceBag>[];
}

export interface ProductionGain {
  player: number;
  resource: Resource;
  amount: number;
  hexId: HexId;
  vertexId: VertexId;
}

export type GameEvent =
  | { type: 'diceRolled'; player: number; dice: [number, number] }
  | { type: 'production'; gains: ProductionGain[] }
  | { type: 'blocked'; hexId: HexId }
  | { type: 'build'; player: number; kind: 'road' | 'settlement' | 'city'; at: string }
  | { type: 'robberMoved'; hexId: HexId }
  | { type: 'stolen'; from: number; to: number; resource: Resource | null }
  | { type: 'devBought'; player: number; card: DevCardType }
  | { type: 'devPlayed'; player: number; card: DevCardType }
  | { type: 'trade'; from: number; to: number | 'bank' }
  | { type: 'awardChanged'; award: 'longestRoad' | 'largestArmy'; owner: number | null }
  | { type: 'gameOver'; winner: number };

export interface GameState {
  version: number;
  board: Board;
  players: Player[];
  /** Index into `players`. */
  current: number;
  phase: Phase;
  /** Increments every time play passes back to the first player. */
  turn: number;
  dice: [number, number] | null;
  /** Snake-draft order for the setup phase. */
  setupOrder: number[];
  setupIndex: number;
  /** Settlement just placed in setup, so the follow-up road must touch it. */
  setupSettlement: VertexId | null;
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, number>;
  devDeck: DevCardType[];
  playedDevThisTurn: boolean;
  /** player index -> number of cards still to discard */
  pendingDiscards: Record<number, number>;
  /** Set while a 7 or a knight is resolving, so we know who steals. */
  robberMover: number | null;
  /** Candidate victims after the robber moved. */
  victimCandidates: number[];
  freeRoadsRemaining: number;
  /** Offers made this turn; bots use it to avoid haggling in circles. */
  offersMadeThisTurn: number;
  longestRoad: { owner: number | null; length: number };
  largestArmy: { owner: number | null; size: number };
  winner: number | null;
  rngSeed: number;
  log: LogEntry[];
  /** Transient: produced by the last reduce() call, not part of a save. */
  events: GameEvent[];
  tradeOffer: TradeOffer | null;
  /** Phase to return to once the robber/discard interlude finishes. */
  resumePhase: Phase | null;
}

export interface Scoreline {
  player: number;
  settlements: number;
  cities: number;
  devVP: number;
  longestRoad: number;
  largestArmy: number;
  total: number;
  /** Total without the hidden victory-point cards. */
  publicTotal: number;
}
