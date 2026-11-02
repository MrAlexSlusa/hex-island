import { describe, expect, it } from 'vitest';
import { reduce } from '../src/game/reducer';
import { RuleViolation } from '../src/game/actions';
import { playableDevCards } from '../src/game/rules';
import { recomputeLargestArmy } from '../src/game/scoring';
import { DEV_DECK } from '../src/game/constants';
import { cornersOf, giveCards, hexWithToken, playingGame, putBuilding } from './helpers';

describe('the development deck', () => {
  it('holds 25 cards in the standard mix', () => {
    expect(DEV_DECK).toHaveLength(25);
    const count = (t: string) => DEV_DECK.filter((c) => c === t).length;
    expect(count('knight')).toBe(14);
    expect(count('victoryPoint')).toBe(5);
    expect(count('roadBuilding')).toBe(2);
    expect(count('yearOfPlenty')).toBe(2);
    expect(count('monopoly')).toBe(2);
  });

  it('costs sheep, wheat and ore and draws from the deck', () => {
    const state = playingGame();
    giveCards(state, 0, { sheep: 1, wheat: 1 });
    expect(() => reduce(state, { type: 'BUY_DEV_CARD' })).toThrow(RuleViolation);

    giveCards(state, 0, { sheep: 1, wheat: 1, ore: 1 });
    const next = reduce(state, { type: 'BUY_DEV_CARD' });
    expect(next.players[0].devCards).toHaveLength(1);
    expect(next.devDeck).toHaveLength(24);
    expect(next.players[0].resources).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  });

  it('refuses to sell from an empty deck', () => {
    const state = playingGame();
    giveCards(state, 0, { sheep: 1, wheat: 1, ore: 1 });
    state.devDeck = [];
    expect(() => reduce(state, { type: 'BUY_DEV_CARD' })).toThrow(RuleViolation);
  });
});

describe('playing development cards', () => {
  it('cannot play a card bought this turn', () => {
    let state = playingGame();
    state.turn = 4;
    giveCards(state, 0, { sheep: 1, wheat: 1, ore: 1 });
    state.devDeck = ['knight', ...state.devDeck];

    state = reduce(state, { type: 'BUY_DEV_CARD' });
    expect(playableDevCards(state, 0)).toHaveLength(0);
    expect(() => reduce(state, { type: 'PLAY_KNIGHT' })).toThrow(RuleViolation);

    state.turn = 5;
    expect(playableDevCards(state, 0)).toHaveLength(1);
  });

  it('allows at most one non-victory-point card per turn', () => {
    let state = playingGame();
    state.turn = 6;
    state.players[0].devCards = [
      { type: 'monopoly', boughtTurn: 1, played: false },
      { type: 'yearOfPlenty', boughtTurn: 1, played: false },
    ];

    state = reduce(state, { type: 'PLAY_MONOPOLY', resource: 'wood' });
    expect(state.playedDevThisTurn).toBe(true);
    expect(() =>
      reduce(state, { type: 'PLAY_YEAR_OF_PLENTY', resources: ['ore', 'ore'] }),
    ).toThrow(RuleViolation);
  });

  it('resets the once-per-turn limit at the end of the turn', () => {
    let state = playingGame();
    state.turn = 6;
    state.players[0].devCards = [
      { type: 'monopoly', boughtTurn: 1, played: false },
      { type: 'yearOfPlenty', boughtTurn: 1, played: false },
    ];
    state = reduce(state, { type: 'PLAY_MONOPOLY', resource: 'wood' });
    state = reduce(state, { type: 'END_TURN' });
    expect(state.playedDevThisTurn).toBe(false);
  });

  it('may be played before the dice are rolled', () => {
    let state = playingGame();
    state.phase = 'rollDice';
    state.turn = 6;
    state.players[0].devCards = [{ type: 'knight', boughtTurn: 1, played: false }];

    state = reduce(state, { type: 'PLAY_KNIGHT' });
    expect(state.phase).toBe('moveRobber');

    const hex = state.board.landHexIds.find((h) => h !== state.board.robber)!;
    state = reduce(state, { type: 'MOVE_ROBBER', hex });
    expect(state.phase).toBe('rollDice');
  });

  it('Knight moves the robber and counts towards Largest Army', () => {
    let state = playingGame();
    state.turn = 6;
    state.players[0].devCards = [
      { type: 'knight', boughtTurn: 1, played: false },
      { type: 'knight', boughtTurn: 1, played: false },
      { type: 'knight', boughtTurn: 1, played: false },
    ];

    for (let i = 0; i < 3; i++) {
      state.turn = 6 + i;
      state.playedDevThisTurn = false;
      state = reduce(state, { type: 'PLAY_KNIGHT' });
      const hex = state.board.landHexIds.find((h) => h !== state.board.robber)!;
      state = reduce(state, { type: 'MOVE_ROBBER', hex });
    }

    expect(state.players[0].knightsPlayed).toBe(3);
    expect(state.largestArmy).toEqual({ owner: 0, size: 3 });
  });

  it('Largest Army needs 3 knights and changes hands only on a strictly bigger army', () => {
    const state = playingGame();
    state.players[0].knightsPlayed = 2;
    expect(recomputeLargestArmy(state).owner).toBeNull();

    state.players[0].knightsPlayed = 3;
    expect(recomputeLargestArmy(state)).toEqual({ owner: 0, size: 3 });

    state.largestArmy = { owner: 0, size: 3 };
    state.players[1].knightsPlayed = 3;
    expect(recomputeLargestArmy(state).owner).toBe(0);

    state.players[1].knightsPlayed = 4;
    expect(recomputeLargestArmy(state).owner).toBe(1);
  });

  it('Knight steals from a player on the chosen hex', () => {
    let state = playingGame();
    state.turn = 6;
    state.players[0].devCards = [{ type: 'knight', boughtTurn: 1, played: false }];
    const hex = hexWithToken(state, 3);
    putBuilding(state, cornersOf(state, hex)[0], 1, 'settlement');
    giveCards(state, 1, { brick: 2 });

    state = reduce(state, { type: 'PLAY_KNIGHT' });
    state = reduce(state, { type: 'MOVE_ROBBER', hex });

    expect(state.players[0].resources.brick).toBe(1);
    expect(state.players[1].resources.brick).toBe(1);
    expect(state.phase).toBe('main');
  });

  it('Year of Plenty takes exactly two cards from the bank', () => {
    let state = playingGame();
    state.turn = 6;
    state.players[0].devCards = [{ type: 'yearOfPlenty', boughtTurn: 1, played: false }];
    state = reduce(state, { type: 'PLAY_YEAR_OF_PLENTY', resources: ['ore', 'wheat'] });
    expect(state.players[0].resources.ore).toBe(1);
    expect(state.players[0].resources.wheat).toBe(1);
  });

  it('Year of Plenty cannot conjure cards the bank does not have', () => {
    let state = playingGame();
    state.turn = 6;
    state.players[0].devCards = [{ type: 'yearOfPlenty', boughtTurn: 1, played: false }];
    giveCards(state, 1, { ore: 19 });
    state = reduce(state, { type: 'PLAY_YEAR_OF_PLENTY', resources: ['ore', 'ore'] });
    expect(state.players[0].resources.ore).toBe(0);
  });

  it('Monopoly sweeps one resource from every opponent', () => {
    let state = playingGame();
    state.turn = 6;
    state.players[0].devCards = [{ type: 'monopoly', boughtTurn: 1, played: false }];
    giveCards(state, 0, { sheep: 1 });
    giveCards(state, 1, { sheep: 4, wood: 2 });
    giveCards(state, 2, { sheep: 3 });

    state = reduce(state, { type: 'PLAY_MONOPOLY', resource: 'sheep' });

    expect(state.players[0].resources.sheep).toBe(8);
    expect(state.players[1].resources.sheep).toBe(0);
    expect(state.players[1].resources.wood).toBe(2);
    expect(state.players[2].resources.sheep).toBe(0);
  });

  it('victory-point cards are never "played"', () => {
    const state = playingGame();
    state.turn = 6;
    state.players[0].devCards = [{ type: 'victoryPoint', boughtTurn: 1, played: false }];
    expect(playableDevCards(state, 0)).toHaveLength(0);
  });
});
