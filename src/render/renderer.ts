/**
 * Canvas renderer for the island.
 *
 * It reads a GameState plus a small bag of "hints" (what is being hovered,
 * which spots are legal right now) and paints a frame. It never mutates game
 * state, so it can be swapped out or run twice without side effects.
 */

import { RESOURCE_LABEL } from '../game/constants';
import type { EdgeId, GameState, HexId, PortKind, VertexId } from '../game/types';
import { Animator, easeOutBack, easeOutCubic } from './animations';
import { TILE_ART, type Assets } from './assets';
import { Layout, type Point } from './layout';
import { drawCity, drawRoad, drawSettlement } from './pieces';

export type InteractionMode = 'none' | 'settlement' | 'city' | 'road' | 'robber';

export interface RenderHints {
  mode: InteractionMode;
  validVertices: Set<VertexId>;
  validEdges: Set<EdgeId>;
  validHexes: Set<HexId>;
  hoverVertex: VertexId | null;
  hoverEdge: EdgeId | null;
  hoverHex: HexId | null;
  /** Whose colour to use for ghost previews. */
  activePlayer: number;
  /** Highlights every hex a given intersection touches (hand-hover helper). */
  spotlightVertex: VertexId | null;
}

export function emptyHints(activePlayer = 0): RenderHints {
  return {
    mode: 'none',
    validVertices: new Set(),
    validEdges: new Set(),
    validHexes: new Set(),
    hoverVertex: null,
    hoverEdge: null,
    hoverHex: null,
    activePlayer,
    spotlightVertex: null,
  };
}

const PORT_COLOR: Record<PortKind, string> = {
  generic: '#f3e2aa',
  wood: '#2f8f47',
  brick: '#c4603a',
  sheep: '#8fd06a',
  wheat: '#e8bd3c',
  ore: '#8a95a5',
};

export class BoardRenderer {
  readonly layout: Layout;
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private assets: Assets,
    state: GameState,
    readonly animator: Animator,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.layout = new Layout(state.board);
  }

  /** Matches the backing store to the CSS box and the device pixel ratio. */
  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.width * ratio);
    this.canvas.height = Math.floor(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.layout.fit(this.width, this.height);
  }

  /** Converts a client (page) coordinate to canvas space. */
  toCanvas(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  draw(state: GameState, hints: RenderHints, now: number) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawOcean(now);

    for (const id of state.board.hexOrder) {
      if (!state.board.hexes[id].isLand) this.drawTile(state, id);
    }
    this.drawPorts(state);
    for (const id of state.board.landHexIds) this.drawTile(state, id);
    for (const id of state.board.landHexIds) this.drawToken(state, id, hints, now);

    this.drawRobberTargets(state, hints, now);
    this.drawRoads(state, hints, now);
    this.drawBuildings(state, hints, now);
    this.drawRobber(state, now);
    this.drawSpots(state, hints, now);
  }

  /* ---------------------------------------------------------------- */

  private drawOcean(now: number) {
    const { ctx } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, '#0b2a4a');
    gradient.addColorStop(1, '#17558c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    const drift = (now / 120) % 48;
    for (let y = -24; y < this.height + 24; y += 24) {
      ctx.beginPath();
      for (let x = -24; x <= this.width + 24; x += 8) {
        const wave = y + Math.sin((x + drift) / 42) * 4;
        if (x === -24) ctx.moveTo(x, wave);
        else ctx.lineTo(x, wave);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTile(state: GameState, id: HexId) {
    const hex = state.board.hexes[id];
    const centre = this.layout.hexCenter(id);
    const image = this.assets.tiles[hex.terrain];
    const size = this.layout.size;

    if (image) {
      const scale = size / TILE_ART.radius;
      this.ctx.drawImage(
        image,
        centre.x + TILE_ART.offsetX * scale,
        centre.y + TILE_ART.offsetY * scale,
        TILE_ART.viewWidth * scale,
        TILE_ART.viewHeight * scale,
      );
      return;
    }

    // Fallback if the art pack is missing.
    this.hexPath(centre, size * 0.98);
    this.ctx.fillStyle = hex.isLand ? '#5a8f4a' : '#2a6fb0';
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }

  private hexPath(centre: Point, radius: number) {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (-90 + 60 * i) * (Math.PI / 180);
      const x = centre.x + radius * Math.cos(angle);
      const y = centre.y + radius * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  private drawToken(state: GameState, id: HexId, hints: RenderHints, now: number) {
    const hex = state.board.hexes[id];
    if (hex.token == null) return;
    const centre = this.layout.hexCenter(id);
    const size = this.layout.size * 0.62;
    const image = this.assets.tokens[hex.token];

    const spotlit =
      hints.spotlightVertex !== null &&
      state.board.vertices[hints.spotlightVertex]?.hexes.includes(id);

    if (spotlit) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(centre.x, centre.y, size * 0.75 + pulse * 4, 0, Math.PI * 2);
      this.ctx.fillStyle = 'rgba(255, 240, 180, 0.35)';
      this.ctx.fill();
      this.ctx.restore();
    }

    if (image) {
      this.ctx.drawImage(image, centre.x - size / 2, centre.y - size / 2, size, size);
      return;
    }

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(centre.x, centre.y, size * 0.42, 0, Math.PI * 2);
    this.ctx.fillStyle = '#f6ecd2';
    this.ctx.fill();
    this.ctx.fillStyle = hex.token === 6 || hex.token === 8 ? '#c0392b' : '#333';
    this.ctx.font = `bold ${Math.round(size * 0.42)}px system-ui, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(String(hex.token), centre.x, centre.y);
    this.ctx.restore();
  }

  private drawPorts(state: GameState) {
    const { ctx } = this;
    const size = this.layout.size;

    for (const port of state.board.ports) {
      const sea = this.layout.hexCenter(port.hexId);
      const badge = {
        x: sea.x + Math.cos(port.angle) * size * 0.42,
        y: sea.y + Math.sin(port.angle) * size * 0.42,
      };

      // Jetties running to the two coastal corners.
      ctx.save();
      ctx.strokeStyle = 'rgba(214, 180, 118, 0.85)';
      ctx.lineWidth = Math.max(2, size * 0.075);
      ctx.lineCap = 'round';
      for (const vid of port.vertices) {
        const corner = this.layout.vertex(vid);
        ctx.beginPath();
        ctx.moveTo(badge.x, badge.y);
        ctx.lineTo(corner.x, corner.y);
        ctx.stroke();
      }
      ctx.restore();

      const radius = size * 0.26;
      ctx.save();
      ctx.beginPath();
      ctx.arc(badge.x, badge.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#f7efda';
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = Math.max(2, radius * 0.22);
      ctx.strokeStyle = PORT_COLOR[port.kind];
      ctx.stroke();

      ctx.fillStyle = '#3a2d15';
      ctx.font = `bold ${Math.round(radius * 0.82)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(port.kind === 'generic' ? '3:1' : '2:1', badge.x, badge.y - radius * 0.18);
      if (port.kind !== 'generic') {
        ctx.font = `600 ${Math.round(radius * 0.52)}px system-ui, sans-serif`;
        ctx.fillText(RESOURCE_LABEL[port.kind].toUpperCase(), badge.x, badge.y + radius * 0.5);
      }
      ctx.restore();
    }
  }

  private drawRoads(state: GameState, hints: RenderHints, now: number) {
    const thickness = Math.max(5, this.layout.size * 0.22);
    for (const [edge, owner] of Object.entries(state.roads)) {
      const [a, b] = this.layout.edgeEndpoints(edge);
      const player = state.players[owner];
      const pop = this.popScale('road', edge, now);
      drawRoad(this.ctx, a.x, a.y, b.x, b.y, thickness * pop, {
        color: player.color,
        dark: player.colorDark,
        glow: pop > 1.02 ? player.color : undefined,
      });
    }

    if (hints.mode === 'road' && hints.hoverEdge && hints.validEdges.has(hints.hoverEdge)) {
      const [a, b] = this.layout.edgeEndpoints(hints.hoverEdge);
      const player = state.players[hints.activePlayer];
      drawRoad(this.ctx, a.x, a.y, b.x, b.y, thickness, {
        color: player.color,
        dark: player.colorDark,
        alpha: 0.65,
        glow: '#ffffff',
      });
    }
  }

  private drawBuildings(state: GameState, hints: RenderHints, now: number) {
    const size = this.layout.size;
    for (const [vertex, building] of Object.entries(state.buildings)) {
      const p = this.layout.vertex(vertex);
      const player = state.players[building.owner];
      const pop = this.popScale(building.type, vertex, now);
      const style = {
        color: player.color,
        dark: player.colorDark,
        glow: pop > 1.02 ? player.color : undefined,
      };
      if (building.type === 'city') drawCity(this.ctx, p.x, p.y, size * 0.46 * pop, style);
      else drawSettlement(this.ctx, p.x, p.y, size * 0.31 * pop, style);
    }

    const ghost = hints.hoverVertex;
    if (ghost && (hints.mode === 'settlement' || hints.mode === 'city') && hints.validVertices.has(ghost)) {
      const p = this.layout.vertex(ghost);
      const player = state.players[hints.activePlayer];
      const style = { color: player.color, dark: player.colorDark, alpha: 0.6, glow: '#ffffff' };
      if (hints.mode === 'city') drawCity(this.ctx, p.x, p.y, size * 0.46, style);
      else drawSettlement(this.ctx, p.x, p.y, size * 0.31, style);
    }
  }

  /** A short scale-up when a piece has just been placed. */
  private popScale(kind: string, at: string, now: number): number {
    const anim = this.animator
      .all('buildPop')
      .find((a) => a.data.at === at && a.data.kind === kind);
    if (!anim) return 1;
    const t = this.animator.progress(anim, now);
    return 0.4 + easeOutBack(t) * 0.6;
  }

  private drawRobber(state: GameState, now: number) {
    const size = this.layout.size;
    let centre = this.layout.hexCenter(state.board.robber);

    const move = this.animator.first('robberMove');
    if (move) {
      const from = this.layout.hexCenter(move.data.from as HexId);
      const t = easeOutCubic(this.animator.progress(move, now));
      const lift = Math.sin(Math.PI * t) * size * 0.5;
      centre = {
        x: from.x + (centre.x - from.x) * t,
        y: from.y + (centre.y - from.y) * t - lift,
      };
    }

    const image = this.assets.robber;
    const height = size * 0.72;
    if (image) {
      const width = height * (80 / 100);
      this.ctx.save();
      this.ctx.shadowColor = 'rgba(0,0,0,0.5)';
      this.ctx.shadowBlur = 10;
      this.ctx.drawImage(image, centre.x - width / 2, centre.y - height * 0.62, width, height);
      this.ctx.restore();
      return;
    }

    this.ctx.save();
    this.ctx.fillStyle = '#23262c';
    this.ctx.beginPath();
    this.ctx.ellipse(centre.x, centre.y, size * 0.2, size * 0.3, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  private drawRobberTargets(state: GameState, hints: RenderHints, now: number) {
    if (hints.mode !== 'robber') return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 240);
    for (const id of hints.validHexes) {
      const hovered = id === hints.hoverHex;
      const centre = this.layout.hexCenter(id);
      this.ctx.save();
      this.hexPath(centre, this.layout.size * 0.93);
      this.ctx.fillStyle = hovered
        ? 'rgba(255, 70, 70, 0.5)'
        : `rgba(20, 8, 30, ${0.26 + pulse * 0.1})`;
      this.ctx.fill();
      this.ctx.setLineDash(hovered ? [] : [this.layout.size * 0.16, this.layout.size * 0.12]);
      this.ctx.lineWidth = this.layout.size * (hovered ? 0.09 : 0.05);
      this.ctx.strokeStyle = hovered
        ? '#fff0f0'
        : `rgba(255, 150, 150, ${0.55 + pulse * 0.35})`;
      this.ctx.stroke();
      this.ctx.restore();
    }
    void state;
  }

  /** Pulsing markers on every legal intersection or edge. */
  private drawSpots(state: GameState, hints: RenderHints, now: number) {
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const player = state.players[hints.activePlayer];

    if (hints.mode === 'settlement' || hints.mode === 'city') {
      for (const vertex of hints.validVertices) {
        if (vertex === hints.hoverVertex) continue;
        const p = this.layout.vertex(vertex);
        const r = this.layout.size * (0.16 + pulse * 0.04);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.55 + pulse * 0.25})`;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = Math.max(2.5, this.layout.size * 0.055);
        ctx.strokeStyle = player.color;
        ctx.stroke();
        ctx.restore();
      }
    }

    if (hints.mode === 'road') {
      const thickness = Math.max(5, this.layout.size * 0.22);
      for (const edge of hints.validEdges) {
        if (edge === hints.hoverEdge) continue;
        const [a, b] = this.layout.edgeEndpoints(edge);
        drawRoad(ctx, a.x, a.y, b.x, b.y, thickness, {
          color: player.color,
          dark: '#ffffff',
          alpha: 0.3 + pulse * 0.2,
        });
      }
    }
  }

  /** Screen position of a hex, for DOM animations layered over the canvas. */
  screenPointOfHex(id: HexId): Point {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.layout.hexCenter(id);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  screenPointOfVertex(id: VertexId): Point {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.layout.vertex(id);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }
}
