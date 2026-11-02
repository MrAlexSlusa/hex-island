import { describe, expect, it } from 'vitest';
import { createBoard } from '../src/game/board';
import { Rng } from '../src/game/rng';
import { Layout } from '../src/render/layout';

/**
 * A layout at a round scale with no offset, so a distance in pixels is just a
 * multiple of the hex circumradius.
 */
function layoutAtSize(size = 100) {
  const board = createBoard(new Rng(42));
  const layout = new Layout(board);
  layout.size = size;
  layout.originX = 0;
  layout.originY = 0;
  return { board, layout };
}

describe('hit-testing a corner', () => {
  const { board, layout } = layoutAtSize();
  const [id] = Object.keys(board.vertices);
  const spot = layout.vertex(id);

  /** A click `away` pixels to the right of that one corner, nothing else near. */
  const pickAt = (away: number, coarse: boolean) => {
    layout.coarsePointer = coarse;
    return layout.pickVertex(spot.x + away, spot.y, [id]);
  };

  it('takes a click right on the corner either way', () => {
    expect(pickAt(0, false)).toBe(id);
    expect(pickAt(0, true)).toBe(id);
  });

  it('forgives a tap a mouse click would miss', () => {
    // Half a circumradius out: past what a cursor gets, inside a fingertip's.
    expect(pickAt(50, false)).toBeNull();
    expect(pickAt(50, true)).toBe(id);
  });

  it('still ignores a tap that is nowhere near', () => {
    expect(pickAt(70, false)).toBeNull();
    expect(pickAt(70, true)).toBeNull();
  });
});

describe('a wider grab radius cannot jump a corner', () => {
  it('leaves the middle of a tile dead, however blunt the pointer', () => {
    const { board, layout } = layoutAtSize();
    // Every corner of a hex is one full circumradius from its centre, which is
    // further than even a fingertip reaches - so tiles stay unclickable and a
    // tap always resolves to the corner it is actually nearest.
    for (const hex of board.landHexIds) {
      const centre = layout.hexCenter(hex);
      for (const coarse of [false, true]) {
        layout.coarsePointer = coarse;
        expect(layout.pickVertex(centre.x, centre.y)).toBeNull();
      }
    }
  });
});

describe('hit-testing a road', () => {
  const { board, layout } = layoutAtSize();
  const [id] = Object.keys(board.edges);
  const [a, b] = layout.edgeEndpoints(id);
  const mid = layout.edgeMidpoint(id);
  // Unit normal to the edge, so the offsets below are true perpendicular gaps.
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };

  const pickAt = (away: number, coarse: boolean) => {
    layout.coarsePointer = coarse;
    return layout.pickEdge(mid.x + normal.x * away, mid.y + normal.y * away, [id]);
  };

  it('forgives a tap a mouse click would miss', () => {
    expect(pickAt(40, false)).toBeNull();
    expect(pickAt(40, true)).toBe(id);
  });

  it('still ignores a tap that is nowhere near', () => {
    expect(pickAt(60, false)).toBeNull();
    expect(pickAt(60, true)).toBeNull();
  });
});
