/**
 * Maps board coordinates to canvas pixels and back, and does hit-testing.
 *
 * The board is laid out once in "world" units (hex circumradius = 1) and then
 * scaled to fit the canvas, so resizing is a single number change.
 */

import { boardExtent, hexCenterPixel, vertexPixel } from '../game/board';
import type { Board, EdgeId, HexId, VertexId } from '../game/types';

export interface Point {
  x: number;
  y: number;
}

export class Layout {
  size = 60;
  originX = 0;
  originY = 0;
  /** Extra zoom the player can apply with the wheel. */
  zoom = 1;
  panX = 0;
  panY = 0;

  constructor(private board: Board) {}

  /** Recomputes the scale so the whole island (ocean ring included) fits. */
  fit(width: number, height: number, padding = 12) {
    const unit = boardExtent(this.board, 1);
    const scaleX = (width - padding * 2) / unit.width;
    const scaleY = (height - padding * 2) / unit.height;
    this.size = Math.max(14, Math.min(scaleX, scaleY)) * this.zoom;

    const extent = boardExtent(this.board, this.size);
    this.originX = width / 2 - (extent.minX + extent.maxX) / 2 + this.panX;
    this.originY = height / 2 - (extent.minY + extent.maxY) / 2 + this.panY;
  }

  hexCenter(id: HexId): Point {
    const p = hexCenterPixel(this.board.hexes[id], this.size);
    return { x: p.x + this.originX, y: p.y + this.originY };
  }

  vertex(id: VertexId): Point {
    const p = vertexPixel(this.board.vertices[id], this.size);
    return { x: p.x + this.originX, y: p.y + this.originY };
  }

  edgeEndpoints(id: EdgeId): [Point, Point] {
    const edge = this.board.edges[id];
    return [this.vertex(edge.a), this.vertex(edge.b)];
  }

  edgeMidpoint(id: EdgeId): Point {
    const [a, b] = this.edgeEndpoints(id);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** Nearest intersection within a grab radius, or null. */
  pickVertex(x: number, y: number, candidates?: Iterable<VertexId>): VertexId | null {
    const limit = this.size * 0.42;
    let best: VertexId | null = null;
    let bestDist = limit;
    for (const id of candidates ?? Object.keys(this.board.vertices)) {
      const p = this.vertex(id);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  /** Nearest edge within a grab radius, measured to the segment itself. */
  pickEdge(x: number, y: number, candidates?: Iterable<EdgeId>): EdgeId | null {
    const limit = this.size * 0.3;
    let best: EdgeId | null = null;
    let bestDist = limit;
    for (const id of candidates ?? Object.keys(this.board.edges)) {
      const [a, b] = this.edgeEndpoints(id);
      const d = distanceToSegment(x, y, a, b);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  pickHex(x: number, y: number, candidates?: Iterable<HexId>): HexId | null {
    let best: HexId | null = null;
    let bestDist = this.size * 0.92;
    for (const id of candidates ?? this.board.landHexIds) {
      const p = this.hexCenter(id);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(x - a.x, y - a.y);
  let t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
