import { describe, expect, it } from 'vitest';
import { nextBotAction } from '../src/ai/bot';
import { reduce } from '../src/game/reducer';
import { createGame } from '../src/game/state';
import { totalVictoryPoints } from '../src/game/scoring';
import { VICTORY_POINTS_TO_WIN } from '../src/game/constants';
import type { Difficulty, GameState } from '../src/game/types';

/** Runs a complete bot-only game and returns the final state. */
function playOut(seed: number, levels: Difficulty[], maxSteps = 40000): GameState {
  let state = createGame({
    seed,
    seats: levels.map((difficulty, i) => ({
      name: `${difficulty} ${i + 1}`,
      colorIndex: i,
      isBot: true,
      difficulty,
    })),
  });

  let steps = 0;
  while (state.phase !== 'gameOver') {
    if (steps++ > maxSteps) throw new Error(`Game did not finish (phase ${state.phase})`);
    const action = nextBotAction(state);
    if (!action) throw new Error(`No bot action available in phase ${state.phase}`);
    state = reduce(state, action);
  }
  return state;
}

describe('bots can play a whole game', () => {
  const levelSets: Difficulty[][] = [
    ['easy', 'easy', 'easy'],
    ['normal', 'normal', 'normal'],
    ['hard', 'hard', 'hard'],
    ['easy', 'normal', 'hard'],
    ['normal', 'hard', 'easy', 'normal'],
  ];

  for (const levels of levelSets) {
    it(`finishes a ${levels.join(' / ')} game without breaking a rule`, () => {
      const state = playOut(7000 + levels.length, levels);
      expect(state.winner).not.toBeNull();
      expect(totalVictoryPoints(state, state.winner!)).toBeGreaterThanOrEqual(
        VICTORY_POINTS_TO_WIN,
      );
      // Nobody should be holding pieces they never had.
      for (const p of state.players) {
        expect(p.piecesLeft.road).toBeGreaterThanOrEqual(0);
        expect(p.piecesLeft.settlement).toBeGreaterThanOrEqual(0);
        expect(p.piecesLeft.city).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('runs a 5-seat table', () => {
    const state = playOut(31, ['normal', 'normal', 'hard', 'easy', 'normal']);
    expect(state.players).toHaveLength(5);
    expect(state.winner).not.toBeNull();
  });

  it('never lets the bank go negative', () => {
    const state = playOut(99, ['hard', 'hard', 'normal']);
    for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const) {
      const held = state.players.reduce((n, p) => n + p.resources[r], 0);
      expect(held).toBeLessThanOrEqual(19);
    }
  });

  it('keeps the setup draft honest: two settlements and two roads each', () => {
    const state = playOut(123, ['normal', 'normal', 'normal']);
    // Every player placed at least their two setup pieces.
    for (let i = 0; i < state.players.length; i++) {
      const built = Object.values(state.buildings).filter((b) => b.owner === i).length;
      const roads = Object.values(state.roads).filter((o) => o === i).length;
      expect(built).toBeGreaterThanOrEqual(2);
      expect(roads).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('difficulty actually means something', () => {
  it('Hard beats Easy far more often than not', () => {
    let hardWins = 0;
    let easyWins = 0;
    const games = 14;
    for (let i = 0; i < games; i++) {
      const state = playOut(500 + i * 37, ['hard', 'easy', 'hard', 'easy']);
      const level = state.players[state.winner!].difficulty;
      if (level === 'hard') hardWins++;
      else easyWins++;
    }
    expect(hardWins + easyWins).toBe(games);
    expect(hardWins).toBeGreaterThan(easyWins);
  });

  it('Normal outscores Easy on average', () => {
    let normalPoints = 0;
    let easyPoints = 0;
    for (let i = 0; i < 10; i++) {
      const state = playOut(900 + i * 53, ['normal', 'easy']);
      normalPoints += totalVictoryPoints(state, 0);
      easyPoints += totalVictoryPoints(state, 1);
    }
    expect(normalPoints).toBeGreaterThan(easyPoints);
  });
});

describe('bots play by the same rules as the human', () => {
  it('never holds more than 7 cards through a seven', () => {
    const state = playOut(2468, ['normal', 'hard', 'easy']);
    // After the game, the discard bookkeeping should be clean.
    expect(state.pendingDiscards).toEqual({});
  });

  it('is deterministic for a given seed', () => {
    const a = playOut(4321, ['normal', 'hard']);
    const b = playOut(4321, ['normal', 'hard']);
    expect(a.winner).toBe(b.winner);
    expect(a.turn).toBe(b.turn);
    expect(a.buildings).toEqual(b.buildings);
  });
});
