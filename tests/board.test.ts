import { describe, expect, it } from 'vitest';
import { createBoard, hexDistance, parseHexId, redNumbersAreSeparated } from '../src/game/board';
import { Rng } from '../src/game/rng';
import { RED_NUMBERS, TERRAIN_POOL, TOKEN_POOL } from '../src/game/constants';
import type { Terrain } from '../src/game/types';

const SEEDS = [1, 7, 42, 999, 20250101, 31337];

describe('board generation', () => {
  it('lays out 19 land hexes with the standard terrain mix', () => {
    for (const seed of SEEDS) {
      const board = createBoard(new Rng(seed));
      expect(board.landHexIds).toHaveLength(19);

      const counts = new Map<Terrain, number>();
      for (const id of board.landHexIds) {
        const t = board.hexes[id].terrain;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const expected = new Map<Terrain, number>();
      for (const t of TERRAIN_POOL) expected.set(t, (expected.get(t) ?? 0) + 1);
      expect([...counts.entries()].sort()).toEqual([...expected.entries()].sort());
    }
  });

  it('surrounds the island with an 18-hex ocean ring', () => {
    const board = createBoard(new Rng(5));
    const ocean = board.hexOrder.filter((id) => !board.hexes[id].isLand);
    expect(ocean).toHaveLength(18);
    for (const id of ocean) {
      expect(hexDistance(parseHexId(id), { q: 0, r: 0 })).toBe(3);
    }
  });

  it('places all 18 number tokens and leaves the desert bare', () => {
    for (const seed of SEEDS) {
      const board = createBoard(new Rng(seed));
      const tokens = board.landHexIds
        .map((id) => board.hexes[id].token)
        .filter((t): t is number => t !== null);
      expect(tokens.slice().sort((a, b) => a - b)).toEqual(TOKEN_POOL.slice().sort((a, b) => a - b));
      const desert = board.landHexIds.filter((id) => board.hexes[id].terrain === 'desert');
      expect(desert).toHaveLength(1);
      expect(board.hexes[desert[0]].token).toBeNull();
      expect(tokens).not.toContain(7);
    }
  });

  it('never puts two red numbers on adjacent hexes', () => {
    for (const seed of SEEDS) {
      const board = createBoard(new Rng(seed));
      for (const a of board.landHexIds) {
        for (const b of board.landHexIds) {
          if (a === b) continue;
          const ha = board.hexes[a];
          const hb = board.hexes[b];
          if (!RED_NUMBERS.includes(ha.token as number)) continue;
          if (!RED_NUMBERS.includes(hb.token as number)) continue;
          expect(hexDistance(ha, hb)).not.toBe(1);
        }
      }
    }
  });

  it('redNumbersAreSeparated rejects a bad layout', () => {
    const coords = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ];
    expect(redNumbersAreSeparated(coords, [6, 8])).toBe(false);
    expect(redNumbersAreSeparated(coords, [6, 5])).toBe(true);
  });

  it('builds a 54-vertex, 72-edge intersection graph', () => {
    const board = createBoard(new Rng(11));
    expect(Object.keys(board.vertices)).toHaveLength(54);
    expect(Object.keys(board.edges)).toHaveLength(72);

    for (const v of Object.values(board.vertices)) {
      expect(v.hexes.length).toBeGreaterThanOrEqual(1);
      expect(v.hexes.length).toBeLessThanOrEqual(3);
      expect(v.adjacent.length).toBeGreaterThanOrEqual(2);
      expect(v.adjacent.length).toBeLessThanOrEqual(3);
      expect(v.edges.length).toBe(v.adjacent.length);
    }
    for (const e of Object.values(board.edges)) {
      expect(e.hexes.length).toBeGreaterThanOrEqual(1);
      expect(e.hexes.length).toBeLessThanOrEqual(2);
    }
  });

  it('places 9 ports - four generic 3:1 and one 2:1 per resource - on distinct coastal corners', () => {
    for (const seed of SEEDS) {
      const board = createBoard(new Rng(seed));
      expect(board.ports).toHaveLength(9);

      const generic = board.ports.filter((p) => p.kind === 'generic');
      expect(generic).toHaveLength(4);
      expect(generic.every((p) => p.ratio === 3)).toBe(true);

      const specific = board.ports.filter((p) => p.kind !== 'generic');
      expect(specific.map((p) => p.kind).sort()).toEqual(
        ['brick', 'ore', 'sheep', 'wheat', 'wood'],
      );
      expect(specific.every((p) => p.ratio === 2)).toBe(true);

      const used = board.ports.flatMap((p) => p.vertices);
      expect(new Set(used).size).toBe(18);
      for (const v of used) expect(board.vertices[v]).toBeDefined();

      // Both corners of a port must share a coastal edge.
      for (const port of board.ports) {
        const [a, b] = port.vertices;
        expect(board.vertices[a].adjacent).toContain(b);
      }
    }
  });

  it('starts the robber on the desert', () => {
    for (const seed of SEEDS) {
      const board = createBoard(new Rng(seed));
      expect(board.hexes[board.robber].terrain).toBe('desert');
    }
  });
});
