import type { EdgeId, HexId, Resource, ResourceBag, VertexId } from './types';

export type Action =
  | { type: 'ROLL_DICE' }
  | { type: 'PLACE_SETTLEMENT'; vertex: VertexId }
  | { type: 'PLACE_CITY'; vertex: VertexId }
  | { type: 'PLACE_ROAD'; edge: EdgeId }
  | { type: 'BUY_DEV_CARD' }
  | { type: 'PLAY_KNIGHT' }
  | { type: 'PLAY_ROAD_BUILDING' }
  | { type: 'PLAY_YEAR_OF_PLENTY'; resources: [Resource, Resource] }
  | { type: 'PLAY_MONOPOLY'; resource: Resource }
  | { type: 'MOVE_ROBBER'; hex: HexId }
  | { type: 'STEAL'; victim: number | null }
  | { type: 'DISCARD'; player: number; resources: Partial<ResourceBag> }
  | { type: 'BANK_TRADE'; give: Resource; receive: Resource }
  | {
      type: 'OFFER_TRADE';
      give: Partial<ResourceBag>;
      receive: Partial<ResourceBag>;
      to: number[];
    }
  | {
      type: 'RESPOND_TRADE';
      player: number;
      response: 'accept' | 'reject' | 'counter';
      counter?: { give: Partial<ResourceBag>; receive: Partial<ResourceBag> };
    }
  | { type: 'ACCEPT_TRADE'; player: number; useCounter?: boolean }
  | { type: 'CANCEL_TRADE' }
  | { type: 'END_TURN' };

export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}
