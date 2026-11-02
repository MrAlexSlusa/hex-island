/**
 * Board geometry and generation.
 *
 * Coordinates
 * -----------
 * Hexes use axial coordinates (q, r) with POINTY-TOP orientation, matching the
 * art pack (its tile polygon has vertices straight up and straight down).
 *
 * Corners are addressed on an exact integer lattice so that two hexes sharing a
 * corner always produce the identical id - no floating point rounding anywhere.
 * With unit vectors `ux = sqrt(3)/2 * R` and `uy = 0.5 * R`:
 *
 *   hex centre (q, r) -> lattice (2q + r, 3r)
 *   corner k of a hex -> centre + CORNER_OFFSETS[k]
 *
 * which makes every corner an integer lattice point.
 */

import {
  PORT_POOL,
  RED_NUMBERS,
  TERRAIN_POOL,
  TERRAIN_RESOURCE,
  TOKEN_POOL,
} from './constants';
import type { Rng } from './rng';
import type { Board, Edge, Hex, HexId, Port, PortKind, Terrain, Vertex, VertexId } from './types';

export const BOARD_RADIUS = 2;

/** Corner k sits at angle (-90 + 60k) degrees, in lattice units. */
export const CORNER_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -2],
  [1, -1],
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
];

export const SQRT3 = Math.sqrt(3);

export function hexId(q: number, r: number): HexId {
  return `${q},${r}`;
}

export function parseHexId(id: HexId): { q: number; r: number } {
  const [q, r] = id.split(',').map(Number);
  return { q, r };
}

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const as = -a.q - a.r;
  const bs = -b.q - b.r;
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(as - bs)) / 2;
}

export function vertexId(lx: number, ly: number): VertexId {
  return `${lx},${ly}`;
}

export function edgeId(a: VertexId, b: VertexId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function edgeEnds(id: string): [VertexId, VertexId] {
  const [a, b] = id.split('|');
  return [a, b];
}

/** Lattice coordinates of a hex centre. */
export function hexLattice(q: number, r: number): [number, number] {
  return [2 * q + r, 3 * r];
}

/** Lattice coordinates of all six corners of a hex. */
export function hexCorners(q: number, r: number): [number, number][] {
  const [cx, cy] = hexLattice(q, r);
  return CORNER_OFFSETS.map(([dx, dy]) => [cx + dx, cy + dy] as [number, number]);
}

/** Pixel position of a lattice point for a hex circumradius of `size`. */
export function latticeToPixel(lx: number, ly: number, size: number): { x: number; y: number } {
  return { x: lx * (SQRT3 / 2) * size, y: ly * 0.5 * size };
}

export function hexCenterPixel(hex: { q: number; r: number }, size: number): { x: number; y: number } {
  const [lx, ly] = hexLattice(hex.q, hex.r);
  return latticeToPixel(lx, ly, size);
}

export function vertexPixel(v: { lx: number; ly: number }, size: number): { x: number; y: number } {
  return latticeToPixel(v.lx, v.ly, size);
}

/** All axial coordinates with cube distance exactly `radius` from the origin. */
function hexesAtDistance(radius: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      // `|| 0` normalises the -0 that `-radius` yields when radius is 0, so
      // ids and JSON round-trips stay identical.
      if (hexDistance({ q, r }, { q: 0, r: 0 }) === radius) out.push({ q: q || 0, r: r || 0 });
    }
  }
  return out;
}

function hexesWithin(radius: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let d = 0; d <= radius; d++) out.push(...hexesAtDistance(d));
  return out;
}

/**
 * Lays terrain and number tokens out, honouring the standard constraint that no
 * two red numbers (6 / 8) may sit on adjacent hexes. Retries until it finds a
 * valid arrangement, which takes only a handful of attempts in practice.
 */
function layoutLand(rng: Rng): { coords: { q: number; r: number }[]; terrains: Terrain[]; tokens: (number | null)[] } {
  const coords = hexesWithin(BOARD_RADIUS);

  for (let attempt = 0; attempt < 2000; attempt++) {
    const terrains = rng.shuffle(TERRAIN_POOL) as Terrain[];
    const numbers = rng.shuffle(TOKEN_POOL);
    const tokens: (number | null)[] = [];
    let n = 0;
    for (const terrain of terrains) {
      tokens.push(terrain === 'desert' ? null : numbers[n++]);
    }

    if (redNumbersAreSeparated(coords, tokens)) return { coords, terrains, tokens };
  }

  // Unreachable in practice; fall back to an unchecked layout rather than hang.
  const terrains = rng.shuffle(TERRAIN_POOL) as Terrain[];
  const numbers = rng.shuffle(TOKEN_POOL);
  const tokens: (number | null)[] = [];
  let n = 0;
  for (const terrain of terrains) tokens.push(terrain === 'desert' ? null : numbers[n++]);
  return { coords, terrains, tokens };
}

export function redNumbersAreSeparated(
  coords: { q: number; r: number }[],
  tokens: (number | null)[],
): boolean {
  for (let i = 0; i < coords.length; i++) {
    if (tokens[i] == null || !RED_NUMBERS.includes(tokens[i] as number)) continue;
    for (let j = i + 1; j < coords.length; j++) {
      if (tokens[j] == null || !RED_NUMBERS.includes(tokens[j] as number)) continue;
      if (hexDistance(coords[i], coords[j]) === 1) return false;
    }
  }
  return true;
}

export function createBoard(rng: Rng): Board {
  const hexes: Record<HexId, Hex> = {};
  const hexOrder: HexId[] = [];
  const landHexIds: HexId[] = [];

  const { coords, terrains, tokens } = layoutLand(rng);

  coords.forEach((c, i) => {
    const id = hexId(c.q, c.r);
    const terrain = terrains[i];
    hexes[id] = {
      id,
      q: c.q,
      r: c.r,
      terrain,
      resource: TERRAIN_RESOURCE[terrain],
      token: tokens[i],
      isLand: true,
    };
    hexOrder.push(id);
    landHexIds.push(id);
  });

  // Decorative ocean ring; also carries the port markers.
  const ring = hexesAtDistance(BOARD_RADIUS + 1);
  for (const c of ring) {
    const id = hexId(c.q, c.r);
    hexes[id] = {
      id,
      q: c.q,
      r: c.r,
      terrain: 'ocean',
      resource: null,
      token: null,
      isLand: false,
    };
    hexOrder.push(id);
  }

  const { vertices, edges } = buildGraph(landHexIds, hexes);
  const ports = buildPorts(ring, vertices, rng);
  for (const port of ports) {
    for (const vid of port.vertices) {
      if (vertices[vid]) vertices[vid].portId = port.id;
    }
  }

  const desert = landHexIds.find((id) => hexes[id].terrain === 'desert') ?? landHexIds[0];

  return { hexes, hexOrder, landHexIds, vertices, edges, ports, robber: desert };
}

function buildGraph(landHexIds: HexId[], hexes: Record<HexId, Hex>) {
  const vertices: Record<VertexId, Vertex> = {};
  const edges: Record<string, Edge> = {};

  for (const hid of landHexIds) {
    const hex = hexes[hid];
    const corners = hexCorners(hex.q, hex.r);
    const ids = corners.map(([lx, ly]) => vertexId(lx, ly));

    corners.forEach(([lx, ly], i) => {
      const vid = ids[i];
      if (!vertices[vid]) {
        vertices[vid] = { id: vid, lx, ly, hexes: [], adjacent: [], edges: [], portId: null };
      }
      if (!vertices[vid].hexes.includes(hid)) vertices[vid].hexes.push(hid);
    });

    for (let i = 0; i < 6; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % 6];
      const eid = edgeId(a, b);
      if (!edges[eid]) {
        const [ea, eb] = edgeEnds(eid);
        edges[eid] = { id: eid, a: ea, b: eb, hexes: [] };
      }
      if (!edges[eid].hexes.includes(hid)) edges[eid].hexes.push(hid);
    }
  }

  for (const edge of Object.values(edges)) {
    const va = vertices[edge.a];
    const vb = vertices[edge.b];
    if (!va.adjacent.includes(edge.b)) va.adjacent.push(edge.b);
    if (!vb.adjacent.includes(edge.a)) vb.adjacent.push(edge.a);
    if (!va.edges.includes(edge.id)) va.edges.push(edge.id);
    if (!vb.edges.includes(edge.id)) vb.edges.push(edge.id);
  }

  return { vertices, edges };
}

/**
 * Nine ports sit on every other hex of the ocean ring, each facing the coast.
 * Four are generic 3:1 ports, and there is one 2:1 port per resource.
 */
function buildPorts(
  ring: { q: number; r: number }[],
  vertices: Record<VertexId, Vertex>,
  rng: Rng,
): Port[] {
  const ordered = ring
    .map((c) => ({ c, angle: Math.atan2(hexCenterPixel(c, 1).y, hexCenterPixel(c, 1).x) }))
    .sort((a, b) => a.angle - b.angle)
    .map((entry) => entry.c);

  const kinds = rng.shuffle(PORT_POOL) as PortKind[];
  const ports: Port[] = [];

  for (let i = 0; i < kinds.length; i++) {
    const seaHex = ordered[(i * 2) % ordered.length];
    const corners = hexCorners(seaHex.q, seaHex.r).map(([lx, ly]) => vertexId(lx, ly));

    // Find the pair of consecutive corners that both belong to the land graph:
    // that is the edge this ocean hex shares with the island.
    let pair: [VertexId, VertexId] | null = null;
    for (let k = 0; k < 6; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % 6];
      if (vertices[a] && vertices[b]) {
        pair = [a, b];
        break;
      }
    }
    if (!pair) continue;

    const seaCentre = hexCenterPixel(seaHex, 1);
    const pa = vertices[pair[0]];
    const pb = vertices[pair[1]];
    const mid = {
      x: (pa.lx + pb.lx) / 2 * (SQRT3 / 2),
      y: (pa.ly + pb.ly) / 2 * 0.5,
    };
    const kind = kinds[i];

    ports.push({
      id: `port-${i}`,
      kind,
      ratio: kind === 'generic' ? 3 : 2,
      vertices: pair,
      hexId: hexId(seaHex.q, seaHex.r),
      angle: Math.atan2(mid.y - seaCentre.y, mid.x - seaCentre.x),
    });
  }

  return ports;
}

/** Vertices of a land hex, in corner order. */
export function hexVertexIds(board: Board, id: HexId): VertexId[] {
  const hex = board.hexes[id];
  return hexCorners(hex.q, hex.r)
    .map(([lx, ly]) => vertexId(lx, ly))
    .filter((v) => board.vertices[v] !== undefined);
}

/** Bounding box of the whole board (ocean ring included) in pixels. */
export function boardExtent(board: Board, size: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of board.hexOrder) {
    const hex = board.hexes[id];
    const c = hexCenterPixel(hex, size);
    minX = Math.min(minX, c.x - (SQRT3 / 2) * size);
    maxX = Math.max(maxX, c.x + (SQRT3 / 2) * size);
    minY = Math.min(minY, c.y - size);
    maxY = Math.max(maxY, c.y + size);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
