import type { DevCardType, Resource, ResourceBag, Terrain } from './types';

export const RESOURCES: readonly Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const RESOURCE_LABEL: Record<Resource, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
};

/** The art pack names sheep/wheat by their classic wool/grain labels. */
export const RESOURCE_ASSET: Record<Resource, string> = {
  wood: 'wood',
  brick: 'brick',
  sheep: 'wool',
  wheat: 'grain',
  ore: 'ore',
};

export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
  forest: 'wood',
  hills: 'brick',
  pasture: 'sheep',
  fields: 'wheat',
  mountains: 'ore',
  desert: null,
  ocean: null,
};

/** 19 land hexes: 4 forest, 4 pasture, 4 fields, 3 hills, 3 mountains, 1 desert. */
export const TERRAIN_POOL: readonly Terrain[] = [
  'forest', 'forest', 'forest', 'forest',
  'pasture', 'pasture', 'pasture', 'pasture',
  'fields', 'fields', 'fields', 'fields',
  'hills', 'hills', 'hills',
  'mountains', 'mountains', 'mountains',
  'desert',
];

/** Standard 18 number tokens (no 7). */
export const TOKEN_POOL: readonly number[] = [
  2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
];

export const RED_NUMBERS: readonly number[] = [6, 8];

/** Number of dot pips under a token = ways to roll it with 2d6. */
export function pipsFor(token: number | null): number {
  if (token == null) return 0;
  return 6 - Math.abs(7 - token);
}

export const PORT_POOL: readonly ('generic' | Resource)[] = [
  'generic', 'generic', 'generic', 'generic',
  'wood', 'brick', 'sheep', 'wheat', 'ore',
];

export const DEV_DECK: readonly DevCardType[] = [
  'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight',
  'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight',
  'victoryPoint', 'victoryPoint', 'victoryPoint', 'victoryPoint', 'victoryPoint',
  'roadBuilding', 'roadBuilding',
  'yearOfPlenty', 'yearOfPlenty',
  'monopoly', 'monopoly',
];

export const DEV_CARD_LABEL: Record<DevCardType, string> = {
  knight: 'Knight',
  victoryPoint: 'Victory Point',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
};

export const DEV_CARD_TEXT: Record<DevCardType, string> = {
  knight: 'Move the robber, then steal 1 resource from a player on that hex.',
  victoryPoint: 'Worth 1 victory point. Stays hidden until you win.',
  roadBuilding: 'Build 2 roads for free.',
  yearOfPlenty: 'Take any 2 resources from the bank.',
  monopoly: 'Name a resource; every other player hands you all of theirs.',
};

export const COSTS: Record<'road' | 'settlement' | 'city' | 'devCard', Partial<ResourceBag>> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
};

export const PIECE_LIMITS = { road: 15, settlement: 5, city: 4 };

export const VICTORY_POINTS_TO_WIN = 10;
export const HAND_LIMIT_BEFORE_DISCARD = 7;
export const MIN_LONGEST_ROAD = 5;
export const MIN_LARGEST_ARMY = 3;

export interface PlayerColor {
  name: string;
  color: string;
  dark: string;
}

/** Four colours come straight from the art pack; green is the spare for a 5th seat. */
export const PLAYER_COLORS: readonly PlayerColor[] = [
  { name: 'Red', color: '#e24b4b', dark: '#8c1f1f' },
  { name: 'Blue', color: '#3d7be0', dark: '#1b3f86' },
  { name: 'Orange', color: '#f0932b', dark: '#9c560d' },
  { name: 'White', color: '#f2f2f2', dark: '#8d8d8d' },
  { name: 'Green', color: '#45b658', dark: '#1d6b2c' },
];

export function emptyBag(): ResourceBag {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

export function bagTotal(bag: Partial<ResourceBag>): number {
  let n = 0;
  for (const r of RESOURCES) n += bag[r] ?? 0;
  return n;
}

/** True when `have` covers every entry in `cost`. */
export function canAfford(have: ResourceBag, cost: Partial<ResourceBag>): boolean {
  for (const r of RESOURCES) {
    if (have[r] < (cost[r] ?? 0)) return false;
  }
  return true;
}
