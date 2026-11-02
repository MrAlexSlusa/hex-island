/**
 * The game screen controller.
 *
 * It owns the current GameState, drives the render loop, turns pointer input
 * into actions, runs the bots on a timer so the human can follow along, and
 * translates the reducer's events into animations and log lines.
 */

import { nextBotAction } from '../ai/bot';
import { RuleViolation, type Action } from '../game/actions';
import { RESOURCES, bagTotal } from '../game/constants';
import { reduce } from '../game/reducer';
import {
  robberTargets,
  validCitySpots,
  validRoadSpots,
  validSettlementSpots,
} from '../game/rules';
import { clearStorage, saveToStorage } from '../game/state';
import type { GameEvent, GameState, Resource } from '../game/types';
import { Animator } from '../render/animations';
import { iconUrl, type Assets } from '../render/assets';
import { BoardRenderer, emptyHints, type InteractionMode, type RenderHints } from '../render/renderer';
import { clear, el, qs, sleep, toast } from './dom';
import {
  devCardDialog,
  discardDialog,
  offerResponseDialog,
  offerResultsDialog,
  tradeDialog,
  victimDialog,
  victoryDialog,
} from './modals';
import {
  hintFor,
  renderControls,
  renderDice,
  renderHand,
  renderLog,
  renderPlayers,
} from './panels';

/** How long bots pause between moves, so their turn is readable. */
const BOT_DELAY: Record<string, number> = {
  ROLL_DICE: 450,
  PLACE_SETTLEMENT: 520,
  PLACE_CITY: 520,
  PLACE_ROAD: 420,
  BUY_DEV_CARD: 480,
  MOVE_ROBBER: 520,
  STEAL: 420,
  DISCARD: 380,
  OFFER_TRADE: 650,
  RESPOND_TRADE: 500,
  ACCEPT_TRADE: 520,
  CANCEL_TRADE: 300,
  END_TURN: 360,
  default: 420,
};

const DICE_ROLL_MS = 760;

export interface GameScreenOptions {
  state: GameState;
  human: number;
  assets: Assets;
  onExit(): void;
}

export class GameScreen {
  state: GameState;
  private readonly human: number;
  private readonly assets: Assets;
  private readonly onExit: () => void;

  private canvas: HTMLCanvasElement;
  readonly renderer: BoardRenderer;
  private animator = new Animator();

  private mode: InteractionMode = 'none';
  private hoverVertex: string | null = null;
  private hoverEdge: string | null = null;
  private hoverHex: string | null = null;

  private pumping = false;
  private rollingDice = false;
  private frame = 0;
  private turnStartedAt = Date.now();
  private clockTimer = 0;
  private disposed = false;

  private readonly onResize = () => {
    this.renderer.resize();
  };

  /** The canvas also changes size when the panels reflow, not just the window. */
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: GameScreenOptions) {
    this.state = options.state;
    this.human = options.human;
    this.assets = options.assets;
    this.onExit = options.onExit;

    this.canvas = qs<HTMLCanvasElement>('#board');
    this.renderer = new BoardRenderer(this.canvas, this.assets, this.state, this.animator);

    this.wireButtons();
    this.wirePointer();
    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.canvas);
    }
    this.renderer.resize();

    this.clockTimer = window.setInterval(() => this.tickClock(), 1000);
    this.refresh();
    this.loop();
    void this.pump();
  }

  destroy() {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onResize);
    window.clearInterval(this.clockTimer);
    cancelAnimationFrame(this.frame);
  }

  /* ---------------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------------- */

  private wireButtons() {
    qs('#btn-to-menu').onclick = () => {
      this.destroy();
      this.onExit();
    };
    qs('#btn-save').onclick = () => {
      saveToStorage(this.state);
      toast('Game saved', 'info');
    };
  }

  private wirePointer() {
    /** Every finger or button currently down on the board, by pointer id. */
    const active = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number } | null = null;
    let panning = false;
    /** The gap and midpoint between two fingers, while there are two. */
    let pinch: { gap: number; x: number; y: number } | null = null;
    /** A pinch lets go one finger at a time; no lift of it may read as a tap. */
    let tapDead = false;

    /**
     * Widens the board's grab radius while a finger is on it. A pen is as
     * precise as a mouse, and a hybrid machine can switch between the two
     * mid-game, so this follows whichever pointer is actually in use rather
     * than deciding once from the device.
     */
    const notePointer = (event: PointerEvent) => {
      this.renderer.layout.coarsePointer = event.pointerType === 'touch';
    };

    /** The gap and midpoint of the first two pointers still down. */
    const spanOfTwo = () => {
      const [a, b] = [...active.values()];
      return { gap: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    this.canvas.addEventListener('pointerdown', (event) => {
      notePointer(event);
      active.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // A second finger turns whatever was happening into a pinch.
      if (active.size === 2) {
        pinch = spanOfTwo();
        tapDead = true;
        downAt = null;
        panning = false;
      } else {
        downAt = { x: event.clientX, y: event.clientY };
        panning = false;
      }

      // Last, so that nothing it throws can skip the bookkeeping above.
      this.canvas.setPointerCapture(event.pointerId);
    });

    this.canvas.addEventListener('pointermove', (event) => {
      notePointer(event);
      const held = active.get(event.pointerId);
      const from = held ? { x: held.x, y: held.y } : null;
      if (held) {
        held.x = event.clientX;
        held.y = event.clientY;
      }

      if (pinch && active.size >= 2) {
        const now = spanOfTwo();
        const focus = this.renderer.toCanvas(now.x, now.y);
        // Two fingers never quite land on the same spot, but nothing stops a
        // synthetic event from doing so, and that would divide by zero.
        if (pinch.gap > 0) this.renderer.layout.zoomAround(now.gap / pinch.gap, focus.x, focus.y);
        // Fingers moving together pan, which is exactly what their midpoint does.
        this.renderer.layout.panX += now.x - pinch.x;
        this.renderer.layout.panY += now.y - pinch.y;
        pinch = now;
        this.renderer.resize();
        return;
      }

      const point = this.renderer.toCanvas(event.clientX, event.clientY);

      if (downAt) {
        const dx = event.clientX - downAt.x;
        const dy = event.clientY - downAt.y;
        // A fingertip rolls a little on its way down, so a tap needs more
        // room before it is read as the start of a pan.
        const slop = event.pointerType === 'touch' ? 14 : 6;
        if (panning || Math.hypot(dx, dy) > slop) {
          panning = true;
          // Measured from the tracked position rather than event.movementX,
          // which older Safari leaves unset for touch pointers.
          this.renderer.layout.panX += event.clientX - (from?.x ?? event.clientX);
          this.renderer.layout.panY += event.clientY - (from?.y ?? event.clientY);
          this.renderer.resize();
          return;
        }
      }

      const hints = this.computeHints();
      this.hoverVertex =
        hints.mode === 'settlement' || hints.mode === 'city'
          ? this.renderer.layout.pickVertex(point.x, point.y, hints.validVertices)
          : null;
      this.hoverEdge =
        hints.mode === 'road'
          ? this.renderer.layout.pickEdge(point.x, point.y, hints.validEdges)
          : null;
      this.hoverHex =
        hints.mode === 'robber'
          ? this.renderer.layout.pickHex(point.x, point.y, hints.validHexes)
          : null;

      const hot = this.hoverVertex || this.hoverEdge || this.hoverHex;
      this.canvas.style.cursor = hot ? 'pointer' : hints.mode === 'none' ? 'grab' : 'default';
    });

    /** Drops a pointer, and settles what the remaining ones mean. */
    const release = (event: PointerEvent) => {
      active.delete(event.pointerId);
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
      if (pinch && active.size < 2) {
        pinch = null;
        // A finger still on the board carries on as a pan, never as a tap.
        const [rest] = [...active.values()];
        if (rest) {
          downAt = { x: rest.x, y: rest.y };
          panning = true;
        }
      }
      if (active.size > 0) return;
      downAt = null;
      panning = false;
      tapDead = false;
    };

    this.canvas.addEventListener('pointerup', (event) => {
      notePointer(event);
      const wasPan = panning;
      const wasDead = tapDead;
      release(event);
      if (wasPan || wasDead) return;
      const point = this.renderer.toCanvas(event.clientX, event.clientY);
      void this.handleClick(point.x, point.y);
    });

    this.canvas.addEventListener('pointercancel', (event) => {
      release(event);
    });

    this.canvas.addEventListener('pointerleave', () => {
      this.hoverVertex = null;
      this.hoverEdge = null;
      this.hoverHex = null;
    });

    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        // Same path as a pinch, so the wheel now zooms towards the cursor
        // rather than the middle of the board.
        const point = this.renderer.toCanvas(event.clientX, event.clientY);
        this.renderer.layout.zoomAround(event.deltaY > 0 ? 0.92 : 1.08, point.x, point.y);
        this.renderer.resize();
      },
      { passive: false },
    );

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.mode !== 'none') {
        this.mode = 'none';
        this.refresh();
      }
    });
  }

  /* ---------------------------------------------------------------- *
   * What is clickable right now
   * ---------------------------------------------------------------- */

  private computeHints(): RenderHints {
    const state = this.state;
    const hints = emptyHints(this.human);
    const myMove = state.current === this.human;
    const robberIsMine = (state.robberMover ?? state.current) === this.human;

    let mode: InteractionMode = 'none';
    if (state.phase === 'setupSettlement' && myMove) mode = 'settlement';
    else if (state.phase === 'setupRoad' && myMove) mode = 'road';
    else if (state.phase === 'roadBuilding' && myMove) mode = 'road';
    else if (state.phase === 'moveRobber' && robberIsMine) mode = 'robber';
    else if (state.phase === 'main' && myMove) mode = this.mode;

    if (this.pumping && state.current !== this.human) mode = 'none';
    hints.mode = mode;

    if (mode === 'settlement') {
      hints.validVertices = new Set(
        validSettlementSpots(state, this.human, { setup: state.phase === 'setupSettlement' }),
      );
    } else if (mode === 'city') {
      hints.validVertices = new Set(validCitySpots(state, this.human));
    } else if (mode === 'road') {
      hints.validEdges = new Set(
        validRoadSpots(state, this.human, {
          setup: state.phase === 'setupRoad' ? state.setupSettlement : null,
          ignoreCost: state.phase === 'roadBuilding' || state.phase === 'setupRoad',
        }),
      );
    } else if (mode === 'robber') {
      hints.validHexes = new Set(robberTargets(state));
    }

    hints.hoverVertex = this.hoverVertex;
    hints.hoverEdge = this.hoverEdge;
    hints.hoverHex = this.hoverHex;
    hints.spotlightVertex = this.hoverVertex;
    return hints;
  }

  private async handleClick(x: number, y: number) {
    if (this.pumping) return;
    const hints = this.computeHints();

    if (hints.mode === 'settlement') {
      const vertex = this.renderer.layout.pickVertex(x, y, hints.validVertices);
      if (vertex) {
        this.mode = 'none';
        await this.dispatch({ type: 'PLACE_SETTLEMENT', vertex });
        await this.pump();
      }
      return;
    }
    if (hints.mode === 'city') {
      const vertex = this.renderer.layout.pickVertex(x, y, hints.validVertices);
      if (vertex) {
        this.mode = 'none';
        await this.dispatch({ type: 'PLACE_CITY', vertex });
        await this.pump();
      }
      return;
    }
    if (hints.mode === 'road') {
      const edge = this.renderer.layout.pickEdge(x, y, hints.validEdges);
      if (edge) {
        if (this.state.phase === 'main') this.mode = 'none';
        await this.dispatch({ type: 'PLACE_ROAD', edge });
        await this.pump();
      }
      return;
    }
    if (hints.mode === 'robber') {
      const hex = this.renderer.layout.pickHex(x, y, hints.validHexes);
      if (hex) {
        await this.dispatch({ type: 'MOVE_ROBBER', hex });
        await this.pump();
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Dispatching
   * ---------------------------------------------------------------- */

  async dispatch(action: Action): Promise<boolean> {
    if (action.type === 'ROLL_DICE') {
      this.rollingDice = true;
      this.refresh();
      await sleep(DICE_ROLL_MS);
      this.rollingDice = false;
    }

    const before = this.state;
    let next: GameState;
    try {
      next = reduce(before, action);
    } catch (error) {
      if (error instanceof RuleViolation) {
        toast(error.message);
        return false;
      }
      throw error;
    }

    this.state = next;
    if (action.type === 'END_TURN' || before.phase.startsWith('setup')) {
      this.turnStartedAt = Date.now();
    }

    this.refresh();
    await this.playEvents(before, next.events);
    this.refresh();

    if (next.phase === 'main' && next.current === this.human && action.type !== 'END_TURN') {
      saveToStorage(next);
    }
    return true;
  }

  /** Turns reducer events into animations. */
  private async playEvents(before: GameState, events: GameEvent[]) {
    for (const event of events) {
      switch (event.type) {
        case 'production':
          this.flyProduction(event.gains);
          break;
        case 'build':
          this.animator.add('buildPop', 420, { kind: event.kind, at: event.at });
          break;
        case 'robberMoved':
          this.animator.add('robberMove', 520, { from: before.board.robber });
          break;
        case 'stolen':
          if (event.resource) this.flySteal(event.from, event.to);
          break;
        case 'gameOver':
          break;
        default:
          break;
      }
    }
    if (this.animator.busy) await this.animator.settled();
  }

  /* ---------------------------------------------------------------- *
   * Flying resource chips
   * ---------------------------------------------------------------- */

  private playerCardAt(index: number): HTMLElement | null {
    return document.querySelectorAll<HTMLElement>('.player-card')[index] ?? null;
  }

  private flyChip(
    from: { x: number; y: number },
    toElement: HTMLElement | null,
    src: string,
    delay = 0,
  ) {
    if (!toElement) return;
    const layer = qs('#fly-layer');
    const target = toElement.getBoundingClientRect();
    const chip = el('img', { class: 'fly-chip', src });
    chip.style.left = `${from.x - 19}px`;
    chip.style.top = `${from.y - 26}px`;
    chip.style.opacity = '0';
    layer.append(chip);

    window.setTimeout(() => {
      chip.style.opacity = '1';
      chip.style.transform = `translate(${target.left + target.width / 2 - from.x}px, ${
        target.top + target.height / 2 - from.y
      }px) scale(0.45)`;
    }, 20 + delay);

    window.setTimeout(() => {
      chip.style.opacity = '0';
    }, 560 + delay);
    window.setTimeout(() => chip.remove(), 900 + delay);
  }

  private flyProduction(
    gains: { player: number; resource: Resource; amount: number; hexId: string }[],
  ) {
    let n = 0;
    for (const gain of gains) {
      const from = this.renderer.screenPointOfHex(gain.hexId);
      for (let i = 0; i < gain.amount; i++) {
        this.flyChip(
          { x: from.x + (i ? 14 : 0), y: from.y },
          this.playerCardAt(gain.player),
          iconUrl(gain.resource),
          n * 70,
        );
        n++;
      }
    }
  }

  private flySteal(from: number, to: number) {
    const source = this.playerCardAt(from);
    if (!source) return;
    const rect = source.getBoundingClientRect();
    this.flyChip(
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      this.playerCardAt(to),
      iconUrl('ore'),
    );
  }

  /* ---------------------------------------------------------------- *
   * The pump: bots and human prompts, until it is the human's move
   * ---------------------------------------------------------------- */

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    this.refresh();

    try {
      let guard = 0;
      while (!this.disposed && guard++ < 5000) {
        const state = this.state;

        if (state.phase === 'gameOver') {
          this.refresh();
          await sleep(500);
          clearStorage();
          const choice = await victoryDialog(state, this.human);
          if (choice === 'menu') {
            this.destroy();
            this.onExit();
          }
          return;
        }

        // The human's own prompts.
        if (state.phase === 'discard' && state.pendingDiscards[this.human] !== undefined) {
          const picked = await discardDialog(state, this.human, state.pendingDiscards[this.human]);
          await this.dispatch({ type: 'DISCARD', player: this.human, resources: picked });
          continue;
        }

        if (
          state.phase === 'selectVictim' &&
          (state.robberMover ?? state.current) === this.human
        ) {
          const victim = await victimDialog(state, state.victimCandidates);
          await this.dispatch({ type: 'STEAL', victim });
          continue;
        }

        const offer = state.tradeOffer;
        if (offer && offer.to.includes(this.human) && !offer.responses[this.human]) {
          const answer = await offerResponseDialog(state, this.human, offer);
          await this.dispatch({
            type: 'RESPOND_TRADE',
            player: this.human,
            response: answer.response,
            counter: answer.counter,
          });
          continue;
        }

        // Then the bots.
        const action = nextBotAction(state);
        if (action) {
          await sleep(BOT_DELAY[action.type] ?? BOT_DELAY.default);
          if (this.disposed) return;
          const ok = await this.dispatch(action);
          if (!ok) {
            // A bot suggested something illegal: end its turn rather than loop.
            if (state.phase === 'main') await this.dispatch({ type: 'END_TURN' });
            else break;
          }
          continue;
        }

        // Our own offer has come back answered.
        if (offer && offer.from === this.human) {
          const everyoneAnswered = offer.to.every((p) => offer.responses[p]);
          if (everyoneAnswered) {
            const pick = await offerResultsDialog(state, offer);
            if (pick) {
              await this.dispatch({
                type: 'ACCEPT_TRADE',
                player: pick.partner,
                useCounter: pick.useCounter,
              });
            } else {
              await this.dispatch({ type: 'CANCEL_TRADE' });
            }
            continue;
          }
        }

        break;
      }
    } finally {
      this.pumping = false;
      this.refresh();
    }
  }

  /* ---------------------------------------------------------------- *
   * Human actions from the action bar
   * ---------------------------------------------------------------- */

  private handlers = {
    onRoll: () => {
      void this.dispatch({ type: 'ROLL_DICE' }).then(() => this.pump());
    },
    onBuild: (mode: Exclude<InteractionMode, 'none' | 'robber'>) => {
      this.mode = this.mode === mode ? 'none' : mode;
      this.refresh();
    },
    onCancel: () => {
      this.mode = 'none';
      this.refresh();
    },
    onDev: () => {
      void this.dispatch({ type: 'BUY_DEV_CARD' }).then(() => this.pump());
    },
    onTrade: () => {
      void this.openTrade();
    },
    onEndTurn: () => {
      this.mode = 'none';
      saveToStorage(this.state);
      void this.dispatch({ type: 'END_TURN' }).then(() => this.pump());
    },
  };

  private async openTrade() {
    const result = await tradeDialog(this.state, this.human);
    if (!result) return;

    if (result.kind === 'bank') {
      await this.dispatch({ type: 'BANK_TRADE', give: result.give, receive: result.receive });
      this.refresh();
      return;
    }

    const give: Partial<Record<Resource, number>> = {};
    const receive: Partial<Record<Resource, number>> = {};
    for (const r of RESOURCES) {
      if (result.draft.give[r] > 0) give[r] = result.draft.give[r];
      if (result.draft.receive[r] > 0) receive[r] = result.draft.receive[r];
    }
    const to = this.state.players.map((_, i) => i).filter((i) => i !== this.human);
    const ok = await this.dispatch({ type: 'OFFER_TRADE', give, receive, to });
    if (ok) await this.pump();
  }

  /** Opens the development-card tray. */
  async openDevCards() {
    const action = await devCardDialog(this.state, this.human);
    if (action) {
      await this.dispatch(action);
      await this.pump();
    }
  }

  /* ---------------------------------------------------------------- *
   * Painting
   * ---------------------------------------------------------------- */

  private loop = () => {
    if (this.disposed) return;
    const now = performance.now();
    this.animator.update(now);
    this.renderer.draw(this.state, this.computeHints(), now);
    this.frame = requestAnimationFrame(this.loop);
  };

  private tickClock() {
    const seconds = Math.floor((Date.now() - this.turnStartedAt) / 1000);
    const mm = Math.floor(seconds / 60);
    const ss = String(seconds % 60).padStart(2, '0');
    qs('#turn-clock').textContent = `${mm}:${ss}`;
  }

  refresh() {
    const state = this.state;
    renderPlayers(qs('#players'), state, this.human);
    renderLog(qs('#log'), state);
    renderHand(qs('#hand'), qs('#hand-count'), state, this.human);
    renderDice(qs('#dice-tray'), this.rollingDice ? null : state.dice, this.rollingDice);

    const controls = qs('#controls');
    renderControls(controls, state, this.human, this.mode, this.pumping, this.handlers);

    // A second row of card actions: play a development card.
    if (
      state.current === this.human &&
      (state.phase === 'main' || state.phase === 'rollDice') &&
      !this.pumping &&
      state.players[this.human].devCards.some((c) => !c.played && c.type !== 'victoryPoint')
    ) {
      controls.append(
        el(
          'button',
          { class: 'btn btn-gold', onclick: () => void this.openDevCards() },
          'Play dev card',
        ),
      );
    }

    const banner = qs('#banner');
    banner.textContent = this.bannerText();
    banner.classList.toggle('is-waiting', state.current !== this.human);

    const hint = qs('#board-hint');
    const text = hintFor(state, this.computeHints().mode, this.human);
    hint.textContent = text;
    hint.classList.toggle('is-shown', text.length > 0);
  }

  private bannerText(): string {
    const state = this.state;
    const me = state.current === this.human;
    const who = state.players[state.current].name;

    if (state.phase === 'gameOver') {
      return state.winner === this.human
        ? 'You win!'
        : `${state.players[state.winner ?? 0].name} wins!`;
    }
    if (state.phase === 'discard') {
      const waiting = Object.keys(state.pendingDiscards).map((i) => state.players[Number(i)].name);
      return `Seven rolled - discarding: ${waiting.join(', ')}`;
    }
    if (state.phase === 'setupSettlement') return me ? 'Your turn - place a settlement' : `${who} is placing a settlement`;
    if (state.phase === 'setupRoad') return me ? 'Your turn - place a road' : `${who} is placing a road`;
    if (state.phase === 'moveRobber') {
      const mover = state.players[state.robberMover ?? state.current].name;
      return state.robberMover === this.human ? 'Move the robber' : `${mover} is moving the robber`;
    }
    if (state.phase === 'selectVictim') return me ? 'Choose who to rob' : `${who} is choosing a victim`;
    if (state.phase === 'roadBuilding') return me ? 'Place your free roads' : `${who} is building roads`;
    if (state.phase === 'rollDice') return me ? 'Your turn - roll the dice' : `${who} is rolling`;

    const cards = bagTotal(state.players[state.current].resources);
    return me ? 'Your turn - trade and build' : `${who} is playing (${cards} cards)`;
  }
}

/** Resets the game screen's DOM between games. */
export function resetGameScreen() {
  for (const id of ['#players', '#log', '#hand', '#dice-tray', '#controls']) {
    clear(qs(id));
  }
  qs('#modal-root').replaceChildren();
}
