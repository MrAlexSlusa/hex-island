import { describe, expect, it } from 'vitest';
import { reduce } from '../src/game/reducer';
import { RuleViolation } from '../src/game/actions';
import { handSize, victimsOn } from '../src/game/rules';
import { RESOURCES } from '../src/game/constants';
import { cornersOf, giveCards, hexWithToken, playingGame, putBuilding } from './helpers';

/** Forces a 7 by searching seeds, so the full 7-flow can be exercised. */
function rollUntilSeven(seedStart: number) {
  for (let seed = seedStart; seed < seedStart + 400; seed++) {
    const state = playingGame(seed);
    state.phase = 'rollDice';
    const next = reduce(state, { type: 'ROLL_DICE' });
    if (next.dice![0] + next.dice![1] === 7) return { before: state, after: next };
  }
  throw new Error('No seed produced a 7');
}

describe('rolling a seven', () => {
  it('sends the roller straight to the robber when no hand is over the limit', () => {
    const { after } = rollUntilSeven(1);
    expect(after.phase).toBe('moveRobber');
    expect(after.robberMover).toBe(after.current);
  });

  it('asks players over 7 cards to discard half, rounded down', () => {
    for (let seed = 1; seed < 400; seed++) {
      const state = playingGame(seed);
      state.phase = 'rollDice';
      giveCards(state, 0, { wood: 4, brick: 4 }); // 8 -> discard 4
      giveCards(state, 1, { wheat: 9 }); // 9 -> discard 4
      giveCards(state, 2, { ore: 7 }); // 7 -> safe
      const next = reduce(state, { type: 'ROLL_DICE' });
      if (next.dice![0] + next.dice![1] !== 7) continue;

      expect(next.phase).toBe('discard');
      expect(next.pendingDiscards).toEqual({ 0: 4, 1: 4 });
      return;
    }
    throw new Error('No seed produced a 7');
  });

  it('moves to the robber only once every discard is in', () => {
    let state = playingGame(1);
    state.phase = 'discard';
    state.robberMover = 0;
    state.resumePhase = 'main';
    giveCards(state, 0, { wood: 8 });
    giveCards(state, 1, { ore: 8 });
    state.pendingDiscards = { 0: 4, 1: 4 };

    state = reduce(state, { type: 'DISCARD', player: 0, resources: { wood: 4 } });
    expect(state.phase).toBe('discard');
    expect(state.players[0].resources.wood).toBe(4);

    state = reduce(state, { type: 'DISCARD', player: 1, resources: { ore: 4 } });
    expect(state.phase).toBe('moveRobber');
  });

  it('rejects a discard of the wrong size or of cards not held', () => {
    const state = playingGame(1);
    state.phase = 'discard';
    giveCards(state, 0, { wood: 8 });
    state.pendingDiscards = { 0: 4 };

    expect(() => reduce(state, { type: 'DISCARD', player: 0, resources: { wood: 3 } })).toThrow(
      RuleViolation,
    );
    expect(() => reduce(state, { type: 'DISCARD', player: 0, resources: { ore: 4 } })).toThrow(
      RuleViolation,
    );
  });

  it('leaves hands of exactly 7 alone', () => {
    const state = playingGame(1);
    giveCards(state, 0, { wood: 7 });
    expect(handSize(state, 0)).toBe(7);
    state.phase = 'rollDice';
    for (let i = 0; i < 200; i++) {
      const next = reduce(state, { type: 'ROLL_DICE' });
      if (next.dice![0] + next.dice![1] === 7) {
        expect(next.pendingDiscards).toEqual({});
        return;
      }
      state.rngSeed = next.rngSeed;
    }
  });
});

describe('moving the robber', () => {
  it('refuses to stay on the same hex and refuses the ocean', () => {
    const state = playingGame();
    state.phase = 'moveRobber';
    state.robberMover = 0;
    expect(() => reduce(state, { type: 'MOVE_ROBBER', hex: state.board.robber })).toThrow(
      RuleViolation,
    );
    const ocean = state.board.hexOrder.find((h) => !state.board.hexes[h].isLand)!;
    expect(() => reduce(state, { type: 'MOVE_ROBBER', hex: ocean })).toThrow(RuleViolation);
  });

  it('steals automatically when exactly one opponent is adjacent', () => {
    const state = playingGame();
    const hex = hexWithToken(state, 10);
    putBuilding(state, cornersOf(state, hex)[0], 1, 'settlement');
    giveCards(state, 1, { ore: 3 });
    state.phase = 'moveRobber';
    state.robberMover = 0;
    state.resumePhase = 'main';

    const next = reduce(state, { type: 'MOVE_ROBBER', hex });

    expect(next.phase).toBe('main');
    expect(next.players[1].resources.ore).toBe(2);
    expect(next.players[0].resources.ore).toBe(1);
  });

  it('asks who to rob when several opponents are adjacent', () => {
    const state = playingGame();
    const hex = hexWithToken(state, 10);
    const [v1, v2] = cornersOf(state, hex);
    putBuilding(state, v1, 1, 'settlement');
    putBuilding(state, v2, 2, 'settlement');
    giveCards(state, 1, { ore: 1 });
    giveCards(state, 2, { wood: 1 });
    state.phase = 'moveRobber';
    state.robberMover = 0;
    state.resumePhase = 'main';

    const next = reduce(state, { type: 'MOVE_ROBBER', hex });
    expect(next.phase).toBe('selectVictim');
    expect(next.victimCandidates).toEqual([1, 2]);

    const after = reduce(next, { type: 'STEAL', victim: 2 });
    expect(after.phase).toBe('main');
    expect(after.players[2].resources.wood).toBe(0);
    expect(after.players[0].resources.wood).toBe(1);
  });

  it('never offers an empty-handed neighbour or the robber’s owner as a victim', () => {
    const state = playingGame();
    const hex = hexWithToken(state, 10);
    const [v1, v2] = cornersOf(state, hex);
    putBuilding(state, v1, 0, 'settlement'); // the mover
    putBuilding(state, v2, 1, 'settlement'); // broke
    giveCards(state, 0, { ore: 5 });

    expect(victimsOn(state, hex, 0)).toEqual([]);
  });

  it('takes a card the victim actually holds', () => {
    const state = playingGame();
    const hex = hexWithToken(state, 10);
    putBuilding(state, cornersOf(state, hex)[0], 1, 'settlement');
    giveCards(state, 1, { sheep: 1 });
    state.phase = 'moveRobber';
    state.robberMover = 0;
    state.resumePhase = 'main';

    const next = reduce(state, { type: 'MOVE_ROBBER', hex });
    const total = RESOURCES.reduce((n, r) => n + next.players[0].resources[r], 0);
    expect(total).toBe(1);
    expect(next.players[0].resources.sheep).toBe(1);
  });
});
