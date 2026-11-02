/** Main menu and the new-game setup screen. */

import { PLAYER_COLORS } from '../game/constants';
import type { GameConfig, SeatConfig } from '../game/state';
import type { Difficulty } from '../game/types';
import { clear, el, qs } from './dom';
import { rulesDialog } from './modals';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const BOT_NAMES = ['Mara', 'Ion', 'Petra', 'Sorin'];

interface Draft {
  name: string;
  colorIndex: number;
  botCount: number;
  difficulties: Difficulty[];
}

export interface MenuHooks {
  onStart(config: GameConfig, humanIndex: number): void;
  onContinue(): void;
  hasSave(): boolean;
}

export function showScreen(id: 'menu' | 'new' | 'game') {
  for (const name of ['menu', 'new', 'game'] as const) {
    qs(`#screen-${name}`).classList.toggle('hidden', name !== id);
  }
}

export function setupMenu(hooks: MenuHooks) {
  const draft: Draft = {
    name: 'You',
    colorIndex: 0,
    botCount: 2,
    difficulties: ['normal', 'normal', 'normal', 'normal'],
  };

  buildMenuArt();

  const continueBtn = qs<HTMLButtonElement>('#btn-continue');
  const refreshContinue = () => {
    continueBtn.disabled = !hooks.hasSave();
  };
  refreshContinue();

  qs('#btn-new-game').onclick = () => {
    refreshForm();
    showScreen('new');
  };
  continueBtn.onclick = () => hooks.onContinue();
  qs('#btn-how-to').onclick = () => void rulesDialog();
  qs('#btn-back-menu').onclick = () => {
    refreshContinue();
    showScreen('menu');
  };

  const nameInput = qs<HTMLInputElement>('#input-name');
  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value.trim() || 'You';
  });

  const colourRow = qs('#colour-row');
  const countRow = qs('#bot-count');
  const botList = qs('#bot-list');

  const refreshForm = () => {
    clear(colourRow);
    PLAYER_COLORS.forEach((colour, index) => {
      colourRow.append(
        el('button', {
          class: `swatch${draft.colorIndex === index ? ' is-active' : ''}`,
          style: { background: colour.color },
          title: colour.name,
          type: 'button',
          onclick: () => {
            draft.colorIndex = index;
            refreshForm();
          },
        }),
      );
    });

    for (const button of countRow.querySelectorAll<HTMLElement>('.seg-btn')) {
      button.classList.toggle('is-active', Number(button.dataset.count) === draft.botCount);
      button.onclick = () => {
        draft.botCount = Number(button.dataset.count);
        refreshForm();
      };
    }

    clear(botList);
    for (let i = 0; i < draft.botCount; i++) {
      const colour = botColour(draft.colorIndex, i);
      const seg = el(
        'div',
        { class: 'seg' },
        DIFFICULTIES.map((level) =>
          el(
            'button',
            {
              class: `seg-btn${draft.difficulties[i] === level ? ' is-active' : ''}`,
              type: 'button',
              onclick: () => {
                draft.difficulties[i] = level;
                refreshForm();
              },
            },
            level[0].toUpperCase() + level.slice(1),
          ),
        ),
      );

      botList.append(
        el('div', { class: 'bot-row' }, [
          el('span', { class: 'bot-dot', style: { background: colour.color } }),
          el('span', {}, BOT_NAMES[i]),
          seg,
        ]),
      );
    }
  };

  qs('#btn-start').onclick = () => {
    const seats: SeatConfig[] = [
      { name: draft.name, colorIndex: draft.colorIndex, isBot: false, difficulty: null },
    ];
    for (let i = 0; i < draft.botCount; i++) {
      seats.push({
        name: BOT_NAMES[i],
        colorIndex: PLAYER_COLORS.indexOf(botColour(draft.colorIndex, i)),
        isBot: true,
        difficulty: draft.difficulties[i],
      });
    }
    hooks.onStart({ seats }, 0);
  };

  refreshForm();
  return { refreshContinue };
}

/** Picks the nth colour that is not the human's. */
function botColour(humanIndex: number, nth: number) {
  const available = PLAYER_COLORS.filter((_, i) => i !== humanIndex);
  return available[nth % available.length];
}

function buildMenuArt() {
  const root = qs('#menu-art');
  clear(root);
  const base = `${import.meta.env.BASE_URL}assets/svg/`;
  for (const tile of ['tile_pasture', 'tile_hills', 'tile_forest', 'tile_fields', 'tile_mountains', 'tile_desert']) {
    root.append(el('img', { src: `${base}${tile}.svg`, alt: '', loading: 'lazy' }));
  }
}
