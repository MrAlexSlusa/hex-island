import { describe, expect, it } from 'vitest';
import { produce, bankStock, reduce } from '../src/game/reducer';
import { cornersOf, giveCards, hexWithToken, playingGame, putBuilding } from './helpers';
import { RESOURCES } from '../src/game/constants';

describe('dice production', () => {
  it('pays 1 card per settlement and 2 per city', () => {
    const state = playingGame();
    const hex = hexWithToken(state, 5);
    const resource = state.board.hexes[hex].resource!;
    const [v1, v2] = cornersOf(state, hex);

    putBuilding(state, v1, 0, 'settlement');
    putBuilding(state, v2, 1, 'city');

    produce(state, 5);

    expect(state.players[0].resources[resource]).toBe(1);
    expect(state.players[1].resources[resource]).toBe(2);
  });

  it('pays every matching hex a settlement touches', () => {
    const state = playingGame();
    // Find a corner whose hexes carry two different tokens.
    const vertex = Object.values(state.board.vertices).find(
      (v) => v.hexes.filter((h) => state.board.hexes[h].token !== null).length >= 2,
    )!;
    const [hexA] = vertex.hexes.filter((h) => state.board.hexes[h].token !== null);
    const token = state.board.hexes[hexA].token!;
    putBuilding(state, vertex.id, 0, 'settlement');

    produce(state, token);

    const expected = vertex.hexes.filter((h) => state.board.hexes[h].token === token).length;
    const got = RESOURCES.reduce((n, r) => n + state.players[0].resources[r], 0);
    expect(got).toBe(expected);
  });

  it('produces nothing from the hex the robber sits on', () => {
    const state = playingGame();
    const hex = hexWithToken(state, 9);
    const resource = state.board.hexes[hex].resource!;
    putBuilding(state, cornersOf(state, hex)[0], 0, 'settlement');
    state.board.robber = hex;

    produce(state, 9);

    expect(state.players[0].resources[resource]).toBe(0);
    expect(state.events.some((e) => e.type === 'blocked')).toBe(true);
  });

  it('ignores rolls that match no hex a player has built on', () => {
    const state = playingGame();
    produce(state, 6);
    for (const p of state.players) {
      for (const r of RESOURCES) expect(p.resources[r]).toBe(0);
    }
  });

  it('emits production events the renderer can animate', () => {
    const state = playingGame();
    const hex = hexWithToken(state, 4);
    putBuilding(state, cornersOf(state, hex)[0], 0, 'settlement');
    produce(state, 4);

    const event = state.events.find((e) => e.type === 'production');
    expect(event).toBeDefined();
    if (event?.type === 'production') {
      expect(event.gains[0].player).toBe(0);
      expect(event.gains[0].hexId).toBe(hex);
    }
  });
});

describe('the bank', () => {
  it('starts with 19 of each resource and shrinks as cards are dealt', () => {
    const state = playingGame();
    const bank = bankStock(state);
    for (const r of RESOURCES) expect(bank[r]).toBe(19);

    giveCards(state, 0, { wood: 4 });
    expect(bankStock(state).wood).toBe(15);
  });

  it('pays nobody when two players want more of a resource than the bank holds', () => {
    const state = playingGame();
    const hex = hexWithToken(state, 8);
    const resource = state.board.hexes[hex].resource!;
    const [v1, v2] = cornersOf(state, hex);
    putBuilding(state, v1, 0, 'settlement');
    putBuilding(state, v2, 1, 'settlement');

    // Drain the bank down to a single card of that resource.
    giveCards(state, 2, { [resource]: 18 });

    produce(state, 8);

    expect(state.players[0].resources[resource]).toBe(0);
    expect(state.players[1].resources[resource]).toBe(0);
  });

  it('gives a sole claimant whatever is left', () => {
    const state = playingGame();
    const hex = hexWithToken(state, 8);
    const resource = state.board.hexes[hex].resource!;
    putBuilding(state, cornersOf(state, hex)[0], 0, 'city');
    giveCards(state, 2, { [resource]: 18 });

    produce(state, 8);

    expect(state.players[0].resources[resource]).toBe(1);
  });
});

describe('rolling', () => {
  it('rolls two dice in range and is reproducible from the seed', () => {
    const a = playingGame(777);
    a.phase = 'rollDice';
    const b = playingGame(777);
    b.phase = 'rollDice';

    const ra = reduce(a, { type: 'ROLL_DICE' });
    const rb = reduce(b, { type: 'ROLL_DICE' });

    expect(ra.dice).toEqual(rb.dice);
    const [d1, d2] = ra.dice!;
    expect(d1).toBeGreaterThanOrEqual(1);
    expect(d1).toBeLessThanOrEqual(6);
    expect(d2).toBeGreaterThanOrEqual(1);
    expect(d2).toBeLessThanOrEqual(6);
  });

  it('produces a uniform-ish 2d6 distribution over many rolls', () => {
    let state = playingGame(2024);
    const counts = new Map<number, number>();
    const rolls = 1800;
    for (let i = 0; i < rolls; i++) {
      state.phase = 'rollDice';
      state = reduce(state, { type: 'ROLL_DICE' });
      const sum = state.dice![0] + state.dice![1];
      counts.set(sum, (counts.get(sum) ?? 0) + 1);
      state.pendingDiscards = {};
    }
    // 7 is the most common sum; 2 and 12 the rarest.
    const seven = counts.get(7)!;
    expect(seven).toBeGreaterThan(counts.get(2)!);
    expect(seven).toBeGreaterThan(counts.get(12)!);
    expect(seven / rolls).toBeGreaterThan(0.12);
    expect(seven / rolls).toBeLessThan(0.21);
  });
});
