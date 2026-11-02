/**
 * All of the game's dialogs. Each one resolves to the choice the player made,
 * so the controller can `await` it and then dispatch a single action.
 */

import type { Action } from '../game/actions';
import {
  DEV_CARD_LABEL,
  DEV_CARD_TEXT,
  RESOURCES,
  RESOURCE_LABEL,
  bagTotal,
  emptyBag,
} from '../game/constants';
import { playableDevCards, tradeRatios } from '../game/rules';
import { allScores } from '../game/scoring';
import type { DevCardType, GameState, Resource, ResourceBag, TradeOffer } from '../game/types';
import { cardUrl } from '../render/assets';
import { clear, el, openModal, stepper } from './dom';
import { bagTags } from './panels';

function cardTile(resource: Resource, extra: HTMLElement[] = []): HTMLElement {
  return el('div', { class: 'picker-item' }, [
    el('img', { src: cardUrl(resource), alt: RESOURCE_LABEL[resource] }),
    el('div', { class: 'label' }, RESOURCE_LABEL[resource]),
    ...extra,
  ]);
}

function describeBag(bag: Partial<ResourceBag>): string {
  const parts = RESOURCES.filter((r) => (bag[r] ?? 0) > 0).map(
    (r) => `${bag[r]} ${RESOURCE_LABEL[r]}`,
  );
  return parts.length ? parts.join(', ') : 'nothing';
}

/* ------------------------------------------------------------------ *
 * Discarding after a seven
 * ------------------------------------------------------------------ */

export function discardDialog(
  state: GameState,
  player: number,
  owed: number,
): Promise<Partial<ResourceBag>> {
  const hand = state.players[player].resources;
  const chosen: ResourceBag = emptyBag();

  const handle = openModal<Partial<ResourceBag>>((close) => {
    const grid = el('div', { class: 'picker' });
    const counter = el('p', { class: 'sub' });
    const confirm = el('button', { class: 'btn btn-warn', disabled: true }, 'Discard');

    const redraw = () => {
      clear(grid);
      for (const r of RESOURCES) {
        if (hand[r] === 0) continue;
        grid.append(
          cardTile(r, [
            el('div', { class: 'label' }, `you hold ${hand[r]}`),
            stepper(chosen[r], hand[r], (next) => {
              if (bagTotal(chosen) - chosen[r] + next > owed) return;
              chosen[r] = next;
              redraw();
            }),
          ]),
        );
      }
      const total = bagTotal(chosen);
      counter.textContent = `Selected ${total} of ${owed}.`;
      confirm.disabled = total !== owed;
    };

    confirm.addEventListener('click', () => close({ ...chosen }));
    redraw();

    return {
      title: 'The robber takes his cut',
      subtitle: `You hold ${bagTotal(hand)} cards, so you must discard ${owed}.`,
      body: [grid, counter],
      actions: [confirm],
    };
  });

  return handle.result;
}

/* ------------------------------------------------------------------ *
 * Choosing a victim
 * ------------------------------------------------------------------ */

export function victimDialog(state: GameState, candidates: number[]): Promise<number> {
  const handle = openModal<number>((close) => ({
    title: 'Rob whom?',
    subtitle: 'You will take one card at random from the player you pick.',
    body: [
      el(
        'div',
        { class: 'option-row' },
        candidates.map((index) => {
          const p = state.players[index];
          const cards = bagTotal(p.resources);
          return el(
            'button',
            {
              class: 'btn',
              style: { background: p.color, color: '#10233c' },
              onclick: () => close(index),
            },
            `${p.name} (${cards} card${cards === 1 ? '' : 's'})`,
          );
        }),
      ),
    ],
  }));
  return handle.result;
}

/* ------------------------------------------------------------------ *
 * Trading
 * ------------------------------------------------------------------ */

export interface TradeDraft {
  give: ResourceBag;
  receive: ResourceBag;
}

type TradeResult = { kind: 'bank'; give: Resource; receive: Resource } | { kind: 'offer'; draft: TradeDraft } | null;

export function tradeDialog(state: GameState, player: number): Promise<TradeResult> {
  const hand = state.players[player].resources;
  const ratios = tradeRatios(state, player);
  const draft: TradeDraft = { give: emptyBag(), receive: emptyBag() };

  const handle = openModal<TradeResult>(
    (close) => {
      const giveCol = el('div', { class: 'trade-col' });
      const getCol = el('div', { class: 'trade-col' });
      const note = el('p', { class: 'sub' });
      const bankBtn = el('button', { class: 'btn btn-secondary', disabled: true }, 'Trade with bank');
      const offerBtn = el('button', { class: 'btn btn-primary', disabled: true }, 'Offer to players');

      const bankDeal = (): { give: Resource; receive: Resource } | null => {
        const giving = RESOURCES.filter((r) => draft.give[r] > 0);
        const getting = RESOURCES.filter((r) => draft.receive[r] > 0);
        if (giving.length !== 1 || getting.length !== 1) return null;
        const give = giving[0];
        const receive = getting[0];
        if (give === receive) return null;
        if (draft.give[give] !== ratios[give] || draft.receive[receive] !== 1) return null;
        return { give, receive };
      };

      const redraw = () => {
        clear(giveCol);
        clear(getCol);
        giveCol.append(el('h3', {}, 'You give'));
        getCol.append(el('h3', {}, 'You get'));

        const giveGrid = el('div', { class: 'picker is-compact' });
        const getGrid = el('div', { class: 'picker is-compact' });

        for (const r of RESOURCES) {
          giveGrid.append(
            cardTile(r, [
              el('div', { class: 'label' }, `hold ${hand[r]} · ${ratios[r]}:1`),
              stepper(draft.give[r], hand[r], (next) => {
                draft.give[r] = next;
                if (next > 0) draft.receive[r] = 0;
                redraw();
              }),
            ]),
          );
          getGrid.append(
            cardTile(r, [
              el('div', { class: 'label' }, ' '),
              stepper(draft.receive[r], 6, (next) => {
                draft.receive[r] = next;
                if (next > 0) draft.give[r] = 0;
                redraw();
              }),
            ]),
          );
        }

        giveCol.append(giveGrid);
        getCol.append(getGrid);

        const deal = bankDeal();
        bankBtn.disabled = deal === null;
        offerBtn.disabled = bagTotal(draft.give) === 0 || bagTotal(draft.receive) === 0;
        note.textContent = deal
          ? `Bank: ${deal.give === deal.receive ? '' : ''}${ratios[deal.give]} ${RESOURCE_LABEL[deal.give]} for 1 ${RESOURCE_LABEL[deal.receive]}.`
          : 'Pick exactly one resource at your bank ratio on the left and one card on the right to use the bank, or build any offer and send it to the table.';
      };

      bankBtn.addEventListener('click', () => {
        const deal = bankDeal();
        if (deal) close({ kind: 'bank', ...deal });
      });
      offerBtn.addEventListener('click', () => close({ kind: 'offer', draft }));

      redraw();

      return {
        title: 'Trade',
        subtitle: 'Your port ratios are shown under each card.',
        body: [el('div', { class: 'trade-cols' }, [giveCol, getCol]), note],
        actions: [
          el('button', { class: 'btn btn-ghost', onclick: () => close(null) }, 'Cancel'),
          bankBtn,
          offerBtn,
        ],
      };
    },
    { dismissible: true, dismissValue: null, wide: true },
  );

  return handle.result;
}

/** Shown to the human when a bot puts an offer on the table. */
export function offerResponseDialog(
  state: GameState,
  me: number,
  offer: TradeOffer,
): Promise<{ response: 'accept' | 'reject' | 'counter'; counter?: TradeDraft }> {
  const proposer = state.players[offer.from];

  const handle = openModal<{ response: 'accept' | 'reject' | 'counter'; counter?: TradeDraft }>(
    (close) => {
      const counterDraft: TradeDraft = {
        give: { ...emptyBag(), ...offer.give } as ResourceBag,
        receive: { ...emptyBag(), ...offer.receive } as ResourceBag,
      };
      const counterWrap = el('div', { class: 'hidden' });
      const body = el('div', {}, [
        el('p', { class: 'sub offer-line' }, [
          `${proposer.name} gives you `,
          bagTags(offer.give, true),
          ' for your ',
          bagTags(offer.receive, true),
        ]),
        counterWrap,
      ]);

      const canPay = RESOURCES.every((r) => state.players[me].resources[r] >= (offer.receive[r] ?? 0));

      const buildCounter = () => {
        clear(counterWrap);
        counterWrap.className = '';
        const cols = el('div', { class: 'trade-cols' });
        const left = el('div', { class: 'trade-col' }, [el('h3', {}, `${proposer.name} gives`)]);
        const right = el('div', { class: 'trade-col' }, [el('h3', {}, 'You give')]);
        const leftGrid = el('div', { class: 'picker is-compact' });
        const rightGrid = el('div', { class: 'picker is-compact' });

        for (const r of RESOURCES) {
          leftGrid.append(
            cardTile(r, [
              el('div', { class: 'label' }, ' '),
              stepper(counterDraft.give[r], 6, (next) => {
                counterDraft.give[r] = next;
                if (next > 0) counterDraft.receive[r] = 0;
                buildCounter();
              }),
            ]),
          );
          rightGrid.append(
            cardTile(r, [
              el('div', { class: 'label' }, `hold ${state.players[me].resources[r]}`),
              stepper(counterDraft.receive[r], state.players[me].resources[r], (next) => {
                counterDraft.receive[r] = next;
                if (next > 0) counterDraft.give[r] = 0;
                buildCounter();
              }),
            ]),
          );
        }
        left.append(leftGrid);
        right.append(rightGrid);
        cols.append(left, right);
        counterWrap.append(
          cols,
          el('div', { class: 'modal-actions' }, [
            el(
              'button',
              {
                class: 'btn btn-gold',
                disabled: bagTotal(counterDraft.give) === 0 || bagTotal(counterDraft.receive) === 0,
                onclick: () => close({ response: 'counter', counter: counterDraft }),
              },
              'Send counter-offer',
            ),
          ]),
        );
      };

      return {
        title: 'A trade offer',
        body: [body],
        actions: [
          el('button', { class: 'btn btn-ghost', onclick: () => close({ response: 'reject' }) }, 'Decline'),
          el('button', { class: 'btn btn-secondary', onclick: buildCounter }, 'Counter'),
          el(
            'button',
            {
              class: 'btn btn-primary',
              disabled: !canPay,
              onclick: () => close({ response: 'accept' }),
            },
            canPay ? 'Accept' : 'Cannot pay',
          ),
        ],
      };
    },
    { wide: true },
  );

  return handle.result;
}

/** Shown to the human after their own offer has been answered. */
export function offerResultsDialog(
  state: GameState,
  offer: TradeOffer,
): Promise<{ partner: number; useCounter: boolean } | null> {
  const handle = openModal<{ partner: number; useCounter: boolean } | null>(
    (close) => {
      const rows = offer.to.map((index) => {
        const p = state.players[index];
        const response = offer.responses[index] ?? 'reject';
        const counter = offer.counters[index];

        let detail = 'Declined.';
        if (response === 'accept') detail = 'Accepts your offer.';
        if (response === 'counter' && counter) {
          detail = `Counters: they give ${describeBag(counter.receive)} for your ${describeBag(counter.give)}.`;
        }

        return el('div', { class: 'dev-card-row' }, [
          el('div', {}, [
            el('b', { style: { color: p.color } }, p.name),
            el('div', { class: 'meta' }, detail),
          ]),
          response === 'accept'
            ? el(
                'button',
                { class: 'btn btn-primary btn-sm', onclick: () => close({ partner: index, useCounter: false }) },
                'Trade',
              )
            : response === 'counter' && counter
              ? el(
                  'button',
                  { class: 'btn btn-gold btn-sm', onclick: () => close({ partner: index, useCounter: true }) },
                  'Take counter',
                )
              : el('span', { class: 'tag' }, 'No'),
        ]);
      });

      const anyYes = offer.to.some(
        (i) => offer.responses[i] === 'accept' || offer.responses[i] === 'counter',
      );

      return {
        title: 'Responses',
        subtitle: anyYes ? 'Pick who you want to trade with.' : 'Nobody took the deal.',
        body: rows,
        actions: [el('button', { class: 'btn btn-ghost', onclick: () => close(null) }, 'Close')],
      };
    },
    { dismissible: true, dismissValue: null },
  );
  return handle.result;
}

/* ------------------------------------------------------------------ *
 * Development cards
 * ------------------------------------------------------------------ */

export function devCardDialog(state: GameState, player: number): Promise<Action | null> {
  const cards = state.players[player].devCards;
  const playable = playableDevCards(state, player);
  const counts = new Map<DevCardType, number>();
  for (const c of cards) {
    if (c.played) continue;
    counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  }

  const handle = openModal<Action | null>(
    (close) => {
      const rows: HTMLElement[] = [];
      for (const [type, count] of counts) {
        const canPlay = playable.some((c) => c.type === type);
        const reason = state.playedDevThisTurn
          ? 'Already played a card this turn'
          : type === 'victoryPoint'
            ? 'Counts automatically'
            : 'Bought this turn';

        rows.push(
          el('div', { class: 'dev-card-row' }, [
            el('div', {}, [
              el('b', {}, `${DEV_CARD_LABEL[type]} ×${count}`),
              el('div', { class: 'meta' }, DEV_CARD_TEXT[type]),
            ]),
            canPlay
              ? el(
                  'button',
                  {
                    class: 'btn btn-primary btn-sm',
                    onclick: async () => {
                      const action = await actionForCard(state, type);
                      if (action) close(action);
                    },
                  },
                  'Play',
                )
              : el('span', { class: 'tag' }, reason),
          ]),
        );
      }

      if (rows.length === 0) {
        rows.push(el('p', { class: 'sub' }, 'You have no development cards yet.'));
      }

      return {
        title: 'Development cards',
        subtitle: 'One non-victory-point card per turn, and never on the turn you bought it.',
        body: rows,
        actions: [el('button', { class: 'btn btn-ghost', onclick: () => close(null) }, 'Close')],
      };
    },
    { dismissible: true, dismissValue: null },
  );

  return handle.result;
}

async function actionForCard(state: GameState, type: DevCardType): Promise<Action | null> {
  switch (type) {
    case 'knight':
      return { type: 'PLAY_KNIGHT' };
    case 'roadBuilding':
      return { type: 'PLAY_ROAD_BUILDING' };
    case 'yearOfPlenty': {
      const picks = await resourcePickDialog(
        'Year of Plenty',
        'Take any two resources from the bank.',
        2,
      );
      if (!picks) return null;
      return { type: 'PLAY_YEAR_OF_PLENTY', resources: [picks[0], picks[1]] };
    }
    case 'monopoly': {
      const picks = await resourcePickDialog(
        'Monopoly',
        'Name a resource. Every other player hands you all of theirs.',
        1,
        state,
      );
      if (!picks) return null;
      return { type: 'PLAY_MONOPOLY', resource: picks[0] };
    }
    default:
      return null;
  }
}

export function resourcePickDialog(
  title: string,
  subtitle: string,
  count: number,
  state?: GameState,
): Promise<Resource[] | null> {
  const picked: Resource[] = [];

  const handle = openModal<Resource[] | null>(
    (close) => {
      const grid = el('div', { class: 'picker' });
      const status = el('p', { class: 'sub' });

      const redraw = () => {
        clear(grid);
        for (const r of RESOURCES) {
          const taken = picked.filter((p) => p === r).length;
          const tile = cardTile(r, [
            state
              ? el(
                  'div',
                  { class: 'label' },
                  `${state.players.reduce((n, p, i) => n + (i === state.current ? 0 : p.resources[r]), 0)} out there`,
                )
              : el('div', { class: 'label' }, taken ? `picked ${taken}` : ' '),
          ]);
          tile.style.cursor = 'pointer';
          if (taken > 0) tile.style.outline = '2px solid var(--gold)';
          tile.addEventListener('click', () => {
            if (picked.length >= count) picked.length = 0;
            picked.push(r);
            if (picked.length === count) close(picked.slice());
            else redraw();
          });
          grid.append(tile);
        }
        status.textContent = count > 1 ? `Pick ${count} cards (tap twice for a pair).` : '';
      };

      redraw();
      return {
        title,
        subtitle,
        body: [grid, status],
        actions: [el('button', { class: 'btn btn-ghost', onclick: () => close(null) }, 'Cancel')],
      };
    },
    { dismissible: true, dismissValue: null },
  );

  return handle.result;
}

/* ------------------------------------------------------------------ *
 * End of game
 * ------------------------------------------------------------------ */

export function victoryDialog(state: GameState, human: number): Promise<'menu' | 'stay'> {
  const scores = allScores(state).sort((a, b) => b.total - a.total);
  const winnerIndex = state.winner ?? 0;
  const winner = state.players[winnerIndex];
  const headline = winnerIndex === human ? 'You win!' : `${winner.name} wins!`;
  const subject = winnerIndex === human ? 'You' : winner.name;

  const handle = openModal<'menu' | 'stay'>((close) => {
    const table = el('table', { class: 'scoreboard' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, 'Player'),
          el('th', {}, 'Settlements'),
          el('th', {}, 'Cities'),
          el('th', {}, 'VP cards'),
          el('th', {}, 'Longest road'),
          el('th', {}, 'Largest army'),
          el('th', {}, 'Total'),
        ]),
      ]),
      el(
        'tbody',
        {},
        scores.map((line) => {
          const p = state.players[line.player];
          return el('tr', { class: line.player === state.winner ? 'is-winner' : '' }, [
            el('td', { class: 'name', style: { color: p.color } }, p.name),
            el('td', {}, String(line.settlements)),
            el('td', {}, String(line.cities)),
            el('td', {}, String(line.devVP)),
            el('td', {}, line.longestRoad ? '2' : '–'),
            el('td', {}, line.largestArmy ? '2' : '–'),
            el('td', { class: 'total' }, String(line.total)),
          ]);
        }),
      ),
    ]);

    return {
      title: headline,
      subtitle: `${subject} reached ${allScores(state)[winnerIndex].total} victory points.`,
      body: [table],
      actions: [
        el('button', { class: 'btn btn-ghost', onclick: () => close('stay') }, 'Look at the board'),
        el('button', { class: 'btn btn-primary', onclick: () => close('menu') }, 'Back to menu'),
      ],
    };
  });

  return handle.result;
}

/* ------------------------------------------------------------------ *
 * How to play
 * ------------------------------------------------------------------ */

export function rulesDialog(): Promise<void> {
  const handle = openModal<void>(
    (close) => ({
      title: 'How to play',
      subtitle: 'Hex Island in two minutes.',
      body: [
        el('div', { class: 'rules-body' }, [
          el('h3', {}, 'Goal'),
          el('p', {}, 'First to 10 victory points wins. Points come from settlements (1), cities (2), victory-point cards (1), Longest Road (2) and Largest Army (2).'),
          el('h3', {}, 'Setup'),
          el('p', {}, 'Players place a settlement and a road in order, then again in reverse. The second settlement pays out the resources around it immediately.'),
          el('h3', {}, 'Your turn'),
          el('ul', {}, [
            el('li', {}, 'Roll two dice. Every settlement (1 card) or city (2 cards) on a hex showing that number produces - unless the robber is sitting there.'),
            el('li', {}, 'Roll a 7 and everyone holding more than 7 cards discards half, then you move the robber and steal a card from someone next to it.'),
            el('li', {}, 'Trade with the bank, a port, or the other players, and build in any order.'),
          ]),
          el('h3', {}, 'Costs'),
          el('ul', {}, [
            el('li', {}, 'Road: 1 wood + 1 brick'),
            el('li', {}, 'Settlement: 1 wood + 1 brick + 1 sheep + 1 wheat'),
            el('li', {}, 'City: 2 wheat + 3 ore (replaces a settlement)'),
            el('li', {}, 'Development card: 1 sheep + 1 wheat + 1 ore'),
          ]),
          el('h3', {}, 'Placement rules'),
          el('ul', {}, [
            el('li', {}, 'Settlements must be at least two edges apart from any other building.'),
            el('li', {}, 'Roads must join your own network, and may not pass through an opponent’s settlement.'),
            el('li', {}, 'Outside setup, a new settlement must sit on one of your own roads.'),
          ]),
          el('h3', {}, 'Trading'),
          el('p', {}, 'The bank gives 4:1 always, 3:1 at a generic port you have settled, and 2:1 at the matching resource port.'),
          el('h3', {}, 'Bots'),
          el('ul', {}, [
            el('li', {}, 'Easy plays mostly at random and trades rarely.'),
            el('li', {}, 'Normal weighs pips, resource variety and ports, and blocks the leader with the robber.'),
            el('li', {}, 'Hard also denies key corners, refuses trades that would hand you the win, and rushes points once anyone is close.'),
          ]),
        ]),
      ],
      actions: [el('button', { class: 'btn btn-primary', onclick: () => close() }, 'Got it')],
    }),
    { dismissible: true, dismissValue: undefined },
  );
  return handle.result;
}
