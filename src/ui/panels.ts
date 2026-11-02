/** Rendering for the side panels, hand, dice tray and action bar. */

import {
  COSTS,
  RESOURCES,
  RESOURCE_LABEL,
  bagTotal,
  canAfford,
} from '../game/constants';
import { canBuyDevCard, validCitySpots, validRoadSpots, validSettlementSpots } from '../game/rules';
import { publicVictoryPoints, totalVictoryPoints } from '../game/scoring';
import type { GameState, LogEntry, Resource, ResourceBag } from '../game/types';
import { dieUrl, iconUrl } from '../render/assets';
import type { InteractionMode } from '../render/renderer';
import { clear, el } from './dom';

export function renderPlayers(root: HTMLElement, state: GameState, human: number) {
  clear(root);
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    const isHuman = i === human;
    const points = isHuman ? totalVictoryPoints(state, i) : publicVictoryPoints(state, i);
    const hidden = state.winner !== null;
    const shown = hidden ? totalVictoryPoints(state, i) : points;

    const badges: HTMLElement[] = [];
    if (state.longestRoad.owner === i) {
      badges.push(el('span', { class: 'badge', title: `Longest road: ${state.longestRoad.length}` }, 'ROAD +2'));
    }
    if (state.largestArmy.owner === i) {
      badges.push(el('span', { class: 'badge army', title: `Knights: ${state.largestArmy.size}` }, 'ARMY +2'));
    }

    const unplayedDev = p.devCards.filter((c) => !c.played && c.type !== 'victoryPoint').length;

    root.append(
      el('div', { class: `player-card${state.current === i ? ' is-current' : ''}` }, [
        el(
          'div',
          { class: 'player-avatar', style: { background: p.color } },
          p.name.slice(0, 1).toUpperCase(),
        ),
        el('div', { class: 'player-main' }, [
          el('div', { class: 'player-name' }, [
            p.name,
            isHuman ? el('span', { class: 'tag' }, 'you') : null,
            p.isBot && p.difficulty
              ? el('span', { class: `tag tag-${p.difficulty}` }, p.difficulty)
              : null,
          ]),
          el('div', { class: 'player-stats' }, [
            el('span', {}, [el('b', {}, String(bagTotal(p.resources))), ' cards']),
            el('span', {}, [el('b', {}, String(unplayedDev)), ' dev']),
            el('span', {}, [el('b', {}, String(p.knightsPlayed)), ' knights']),
            el('span', {}, [el('b', {}, String(p.piecesLeft.road)), ' roads left']),
          ]),
          badges.length ? el('div', { class: 'badges' }, badges) : null,
        ]),
        el('div', { class: 'player-vp' }, [String(shown), el('small', {}, isHuman || hidden ? 'POINTS' : 'OPEN')]),
      ]),
    );
  }
}

/**
 * One resource badge. A count of 0 names the resource without an amount, for
 * lines like "the bank ran short of Wheat".
 */
export function resourceTag(resource: Resource, amount: number): HTMLElement {
  return el('span', { class: 'res-tag', title: RESOURCE_LABEL[resource] }, [
    el('img', { src: iconUrl(resource), alt: '' }),
    amount > 0 ? `${amount} ${RESOURCE_LABEL[resource]}` : RESOURCE_LABEL[resource],
  ]);
}

export function bagTags(bag: Partial<ResourceBag>, large = false): HTMLElement {
  const tags = RESOURCES.filter((r) => bag[r] !== undefined).map((r) =>
    resourceTag(r, bag[r] ?? 0),
  );
  return el('span', { class: `res-tags${large ? ' is-large' : ''}` }, tags.length ? tags : 'nothing');
}

/** Expands a log line's `{0}` markers into badge groups. */
function logLine(entry: LogEntry): (HTMLElement | string)[] {
  const bags = entry.bags;
  if (!bags || bags.length === 0) return [entry.text];
  const out: (HTMLElement | string)[] = [];
  let at = 0;
  for (const match of entry.text.matchAll(/\{(\d+)\}/g)) {
    out.push(entry.text.slice(at, match.index));
    at = match.index + match[0].length;
    // A marker with no bag behind it is dropped rather than shown raw.
    const bag = bags[Number(match[1])];
    if (bag) out.push(bagTags(bag));
  }
  out.push(entry.text.slice(at));
  return out;
}

export function renderLog(root: HTMLElement, state: GameState) {
  const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 40;
  clear(root);
  for (const entry of state.log.slice(-80)) {
    const colour = entry.player !== null ? state.players[entry.player]?.color : undefined;
    root.append(
      el(
        'li',
        {
          class: entry.player !== null ? 'has-player' : '',
          style: colour ? { ['--accent' as string]: colour } : {},
        },
        logLine(entry),
      ),
    );
  }
  if (atBottom) root.scrollTop = root.scrollHeight;
}

export function renderHand(
  handRoot: HTMLElement,
  countRoot: HTMLElement,
  state: GameState,
  human: number,
) {
  clear(handRoot);
  const p = state.players[human];
  for (const r of RESOURCES) {
    handRoot.append(
      el('div', { class: `card-chip${p.resources[r] === 0 ? ' is-empty' : ''}`, title: RESOURCE_LABEL[r] }, [
        el('img', { src: iconUrl(r), alt: RESOURCE_LABEL[r] }),
        el('span', { class: 'name' }, RESOURCE_LABEL[r]),
        el('span', { class: 'count' }, String(p.resources[r])),
      ]),
    );
  }

  const unplayed = p.devCards.filter((c) => !c.played);
  if (unplayed.length > 0) {
    handRoot.append(el('div', { class: 'dev-chip' }, [`${unplayed.length}`, el('br'), 'dev']));
  }

  const total = bagTotal(p.resources);
  countRoot.textContent = `${total} card${total === 1 ? '' : 's'}`;
  countRoot.classList.toggle('is-over', total > 7);
}

export function renderDice(root: HTMLElement, dice: [number, number] | null, rolling: boolean) {
  clear(root);
  const faces = dice ?? [1, 1];
  for (let i = 0; i < 2; i++) {
    const img = el('img', {
      class: `die${rolling ? ' is-rolling' : dice ? ' is-settling' : ''}`,
      src: dieUrl(faces[i]),
      alt: `Die showing ${faces[i]}`,
    });
    if (rolling) img.style.animationDelay = `${i * 0.07}s`;
    root.append(img);
  }
}

export interface ControlHandlers {
  onRoll(): void;
  onBuild(mode: Exclude<InteractionMode, 'none' | 'robber'>): void;
  onTrade(): void;
  onDev(): void;
  onEndTurn(): void;
  onCancel(): void;
}

/** The price tag under a build button: one badge per resource, times its count. */
function costTag(cost: Partial<ResourceBag>): HTMLElement {
  const items = RESOURCES.filter((r) => (cost[r] ?? 0) > 0).map((r) =>
    el('span', { class: 'cost-item', title: `${cost[r]} ${RESOURCE_LABEL[r]}` }, [
      el('img', { src: iconUrl(r), alt: RESOURCE_LABEL[r] }),
      (cost[r] ?? 0) > 1 ? el('b', {}, String(cost[r])) : null,
    ]),
  );
  return el('span', { class: 'cost' }, items);
}

export function renderControls(
  root: HTMLElement,
  state: GameState,
  human: number,
  mode: InteractionMode,
  busy: boolean,
  handlers: ControlHandlers,
) {
  clear(root);
  const myTurn = state.current === human && !busy;
  const hand = state.players[human].resources;

  if (state.phase === 'gameOver') {
    root.append(el('span', { class: 'tag' }, 'Game over'));
    return;
  }

  if (state.phase === 'rollDice' && myTurn) {
    root.append(el('button', { class: 'btn btn-gold', onclick: handlers.onRoll }, 'Roll dice'));
  }

  const inBuildPhase = state.phase === 'main' && myTurn;
  const placing = mode !== 'none' && mode !== 'robber';

  if (placing) {
    root.append(
      el('button', { class: 'btn btn-warn', onclick: handlers.onCancel }, 'Cancel placement'),
    );
  }

  if (inBuildPhase && !placing) {
    const buttons: { mode: Exclude<InteractionMode, 'none' | 'robber'>; label: string; cost: Partial<ResourceBag>; ok: boolean }[] = [
      {
        mode: 'road',
        label: 'Road',
        cost: COSTS.road,
        ok: canAfford(hand, COSTS.road) && validRoadSpots(state, human).length > 0,
      },
      {
        mode: 'settlement',
        label: 'Settlement',
        cost: COSTS.settlement,
        ok: canAfford(hand, COSTS.settlement) && validSettlementSpots(state, human).length > 0,
      },
      {
        mode: 'city',
        label: 'City',
        cost: COSTS.city,
        ok: canAfford(hand, COSTS.city) && validCitySpots(state, human).length > 0,
      },
    ];

    for (const b of buttons) {
      root.append(
        el(
          'button',
          {
            class: 'btn btn-primary',
            disabled: !b.ok,
            title: b.ok ? '' : 'Not affordable, or nowhere legal to put it',
            onclick: () => handlers.onBuild(b.mode),
          },
          [b.label, costTag(b.cost)],
        ),
      );
    }

    root.append(
      el(
        'button',
        {
          class: 'btn btn-secondary',
          disabled: !canBuyDevCard(state, human),
          onclick: handlers.onDev,
        },
        ['Dev card', costTag(COSTS.devCard)],
      ),
      el('button', { class: 'btn btn-secondary', onclick: handlers.onTrade }, 'Trade'),
      el('button', { class: 'btn btn-warn', onclick: handlers.onEndTurn }, 'End turn'),
    );
  }

  if (root.childElementCount === 0) {
    const waiting = state.players[state.current];
    const label = busy
      ? 'Thinking…'
      : state.current === human || state.phase === 'discard'
        ? 'Your move is on the board'
        : `Waiting for ${waiting.name}`;
    root.append(el('span', { class: 'tag' }, label));
  }
}

/** Short instruction shown under the board while the player is placing. */
export function hintFor(state: GameState, mode: InteractionMode, human: number): string {
  if (state.phase === 'gameOver') return '';
  if (state.current !== human && state.phase !== 'discard') return '';
  switch (state.phase) {
    case 'setupSettlement':
      return 'Click a highlighted corner to found your settlement';
    case 'setupRoad':
      return 'Now place a road touching that settlement';
    case 'moveRobber':
      return 'Click a hex to move the robber there';
    case 'roadBuilding':
      return `Road Building: place ${state.freeRoadsRemaining} free road${state.freeRoadsRemaining === 1 ? '' : 's'}`;
    default:
      break;
  }
  if (mode === 'settlement') return 'Click a highlighted corner to build a settlement';
  if (mode === 'city') return 'Click one of your settlements to upgrade it';
  if (mode === 'road') return 'Click a highlighted edge to build a road';
  return '';
}
