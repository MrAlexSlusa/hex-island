import './style.css';

import { createGame, hasSave, loadFromStorage, type GameConfig } from './game/state';
import { loadAssets, type Assets } from './render/assets';
import { toast } from './ui/dom';
import { GameScreen, resetGameScreen } from './ui/game';
import { setupMenu, showScreen } from './ui/menu';

let assets: Assets | null = null;
let screen: GameScreen | null = null;

/** Handy for poking at a running game from the dev console. */
function exposeForDev() {
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).hexIsland = screen;
  }
}

async function ensureAssets(): Promise<Assets> {
  if (!assets) assets = await loadAssets();
  return assets;
}

function exitToMenu() {
  screen = null;
  resetGameScreen();
  showScreen('menu');
  menu.refreshContinue();
}

async function launch(config: GameConfig, human: number) {
  const art = await ensureAssets();
  screen?.destroy();
  resetGameScreen();
  showScreen('game');
  // The canvas needs its final size before the renderer measures it.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  screen = new GameScreen({ state: createGame(config), human, assets: art, onExit: exitToMenu });
  exposeForDev();
}

async function resume() {
  const saved = loadFromStorage();
  if (!saved) {
    toast('No saved game found');
    return;
  }
  const art = await ensureAssets();
  screen?.destroy();
  resetGameScreen();
  showScreen('game');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const human = saved.players.findIndex((p) => !p.isBot);
  screen = new GameScreen({
    state: saved,
    human: human < 0 ? 0 : human,
    assets: art,
    onExit: exitToMenu,
  });
  exposeForDev();
}

const menu = setupMenu({
  onStart: (config, human) => void launch(config, human),
  onContinue: () => void resume(),
  hasSave: () => hasSave(),
});

showScreen('menu');
void ensureAssets();

/**
 * Installed-app support. Only in a real build: in dev a worker would sit in
 * front of Vite's module server and serve stale code.
 *
 * BASE_URL keeps this right whether the site is at a domain root or under a
 * GitHub Pages project subpath, which is also what scopes the worker to the
 * game rather than the whole host.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => toast('Offline play unavailable'));
  });
}
