import { describe, expect, it } from 'vitest';
import { reduce } from '../src/game/reducer';
import { RuleViolation } from '../src/game/actions';
import { canBankTrade, canSettleTrade, ownedPorts, tradeRatios } from '../src/game/rules';
import { giveCards, playingGame, putBuilding } from './helpers';
import type { Resource } from '../src/game/types';

function portOfKind(state: ReturnType<typeof playingGame>, kind: 'generic' | Resource) {
  return state.board.ports.find((p) => p.kind === kind)!;
}

describe('bank trade ratios', () => {
  it('is 4:1 for everything without a port', () => {
    const state = playingGame();
    const ratios = tradeRatios(state, 0);
    expect(ratios).toEqual({ wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 });
  });

  it('drops to 3:1 across the board on a generic port', () => {
    const state = playingGame();
    const port = portOfKind(state, 'generic');
    putBuilding(state, port.vertices[0], 0, 'settlement');
    const ratios = tradeRatios(state, 0);
    expect(Object.values(ratios)).toEqual([3, 3, 3, 3, 3]);
    expect(ownedPorts(state, 0)).toHaveLength(1);
  });

  it('drops to 2:1 for the matching resource on a specific port', () => {
    const state = playingGame();
    const port = portOfKind(state, 'ore');
    putBuilding(state, port.vertices[1], 0, 'city');
    const ratios = tradeRatios(state, 0);
    expect(ratios.ore).toBe(2);
    expect(ratios.wood).toBe(4);
  });

  it('keeps the best ratio when a player owns both a 3:1 and a 2:1 port', () => {
    const state = playingGame();
    putBuilding(state, portOfKind(state, 'generic').vertices[0], 0, 'settlement');
    putBuilding(state, portOfKind(state, 'wheat').vertices[0], 0, 'settlement');
    const ratios = tradeRatios(state, 0);
    expect(ratios.wheat).toBe(2);
    expect(ratios.wood).toBe(3);
  });

  it('does not grant a port to a player who has not settled on it', () => {
    const state = playingGame();
    const port = portOfKind(state, 'brick');
    putBuilding(state, port.vertices[0], 1, 'settlement');
    expect(tradeRatios(state, 0).brick).toBe(4);
    expect(tradeRatios(state, 1).brick).toBe(2);
  });
});

describe('trading with the bank', () => {
  it('needs the full ratio in hand', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 3 });
    expect(canBankTrade(state, 0, 'wood', 'ore')).toBe(false);
    expect(() => reduce(state, { type: 'BANK_TRADE', give: 'wood', receive: 'ore' })).toThrow(
      RuleViolation,
    );

    giveCards(state, 0, { wood: 4 });
    expect(canBankTrade(state, 0, 'wood', 'ore')).toBe(true);
    const next = reduce(state, { type: 'BANK_TRADE', give: 'wood', receive: 'ore' });
    expect(next.players[0].resources.wood).toBe(0);
    expect(next.players[0].resources.ore).toBe(1);
  });

  it('charges only 2 at a matching 2:1 port', () => {
    const state = playingGame();
    putBuilding(state, portOfKind(state, 'sheep').vertices[0], 0, 'settlement');
    giveCards(state, 0, { sheep: 2 });
    const next = reduce(state, { type: 'BANK_TRADE', give: 'sheep', receive: 'brick' });
    expect(next.players[0].resources.sheep).toBe(0);
    expect(next.players[0].resources.brick).toBe(1);
  });

  it('refuses to swap a resource for itself', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 8 });
    expect(() => reduce(state, { type: 'BANK_TRADE', give: 'wood', receive: 'wood' })).toThrow(
      RuleViolation,
    );
  });

  it('refuses when the bank is out of the requested resource', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 4 });
    giveCards(state, 1, { ore: 19 });
    expect(() => reduce(state, { type: 'BANK_TRADE', give: 'wood', receive: 'ore' })).toThrow(
      RuleViolation,
    );
  });
});

describe('player-to-player trade validation', () => {
  it('requires both sides to hold what they promised', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 2 });
    giveCards(state, 1, { ore: 1 });

    expect(canSettleTrade(state, 0, 1, { wood: 2 }, { ore: 1 })).toBe(true);
    expect(canSettleTrade(state, 0, 1, { wood: 3 }, { ore: 1 })).toBe(false);
    expect(canSettleTrade(state, 0, 1, { wood: 2 }, { ore: 2 })).toBe(false);
  });

  it('rejects empty, self-directed and same-resource trades', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 5 });
    giveCards(state, 1, { wood: 5 });

    expect(canSettleTrade(state, 0, 1, {}, { wood: 1 })).toBe(false);
    expect(canSettleTrade(state, 0, 1, { wood: 1 }, {})).toBe(false);
    expect(canSettleTrade(state, 0, 0, { wood: 1 }, { wood: 1 })).toBe(false);
    expect(canSettleTrade(state, 0, 1, { wood: 1 }, { wood: 1 })).toBe(false);
  });

  it('moves the cards once the offer is accepted', () => {
    let state = playingGame();
    giveCards(state, 0, { wood: 2, brick: 1 });
    giveCards(state, 1, { ore: 3 });

    state = reduce(state, { type: 'OFFER_TRADE', give: { wood: 2 }, receive: { ore: 1 }, to: [1, 2] });
    expect(state.tradeOffer).not.toBeNull();

    state = reduce(state, { type: 'RESPOND_TRADE', player: 1, response: 'accept' });
    state = reduce(state, { type: 'ACCEPT_TRADE', player: 1 });

    expect(state.players[0].resources.wood).toBe(0);
    expect(state.players[0].resources.ore).toBe(1);
    expect(state.players[1].resources.ore).toBe(2);
    expect(state.players[1].resources.wood).toBe(2);
    expect(state.tradeOffer).toBeNull();
  });

  it('can settle on a counter-offer instead', () => {
    let state = playingGame();
    giveCards(state, 0, { wood: 3 });
    giveCards(state, 1, { ore: 2 });

    state = reduce(state, { type: 'OFFER_TRADE', give: { wood: 1 }, receive: { ore: 2 }, to: [1] });
    state = reduce(state, {
      type: 'RESPOND_TRADE',
      player: 1,
      response: 'counter',
      counter: { give: { wood: 3 }, receive: { ore: 1 } },
    });
    state = reduce(state, { type: 'ACCEPT_TRADE', player: 1, useCounter: true });

    expect(state.players[0].resources.wood).toBe(0);
    expect(state.players[0].resources.ore).toBe(1);
    expect(state.players[1].resources.wood).toBe(3);
  });

  it('refuses an offer of cards the proposer does not hold', () => {
    const state = playingGame();
    giveCards(state, 0, { wood: 1 });
    expect(() =>
      reduce(state, { type: 'OFFER_TRADE', give: { wood: 2 }, receive: { ore: 1 }, to: [1] }),
    ).toThrow(RuleViolation);
  });

  it('refuses a response from a player the offer was not made to', () => {
    let state = playingGame();
    giveCards(state, 0, { wood: 2 });
    state = reduce(state, { type: 'OFFER_TRADE', give: { wood: 1 }, receive: { ore: 1 }, to: [1] });
    expect(() => reduce(state, { type: 'RESPOND_TRADE', player: 2, response: 'accept' })).toThrow(
      RuleViolation,
    );
  });

  it('refuses to settle a trade that has gone stale', () => {
    let state = playingGame();
    giveCards(state, 0, { wood: 2 });
    giveCards(state, 1, { ore: 1 });
    state = reduce(state, { type: 'OFFER_TRADE', give: { wood: 2 }, receive: { ore: 1 }, to: [1] });
    state.players[1].resources.ore = 0;
    expect(() => reduce(state, { type: 'ACCEPT_TRADE', player: 1 })).toThrow(RuleViolation);
  });
});
