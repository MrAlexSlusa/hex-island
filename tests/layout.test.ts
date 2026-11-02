import { describe, expect, it } from 'vitest';
import { createBoard } from '../src/game/board';
import { Rng } from '../src/game/rng';
import { Layout, MAX_ZOOM, MIN_ZOOM } from '../src/render/layout';

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

describe('zooming about a point', () => {
  /** A layout fitted to a viewport, the state `zoomAround` expects. */
  function fitted() {
    const { board, layout } = layoutAtSize();
    layout.fit(800, 600);
    return { board, layout, refit: () => layout.fit(800, 600) };
  }

  it('keeps whatever is under the focus under it', () => {
    const { board, layout, refit } = fitted();
    const [id] = Object.keys(board.vertices);
    // Somewhere off-centre, where a mistake in the pan maths would show.
    const focus = layout.vertex(id);

    layout.zoomAround(1.5, focus.x, focus.y);
    refit();

    const after = layout.vertex(id);
    expect(after.x).toBeCloseTo(focus.x, 6);
    expect(after.y).toBeCloseTo(focus.y, 6);
  });

  it('holds the focus through a pinch applied in many small steps', () => {
    const { board, layout, refit } = fitted();
    const [id] = Object.keys(board.vertices);
    const focus = layout.vertex(id);

    // A real pinch arrives as a stream of tiny factors, not one big one.
    for (let i = 0; i < 20; i++) {
      layout.zoomAround(1.03, focus.x, focus.y);
      refit();
    }

    const after = layout.vertex(id);
    expect(after.x).toBeCloseTo(focus.x, 6);
    expect(after.y).toBeCloseTo(focus.y, 6);
  });

  it('stops at the zoom limits', () => {
    const { layout } = fitted();
    for (let i = 0; i < 60; i++) layout.zoomAround(1.2, 700, 500);
    expect(layout.zoom).toBe(MAX_ZOOM);

    for (let i = 0; i < 60; i++) layout.zoomAround(0.8, 700, 500);
    expect(layout.zoom).toBe(MIN_ZOOM);
  });

  it('does not drift once it is already at the limit', () => {
    const { board, layout, refit } = fitted();
    for (let i = 0; i < 60; i++) {
      layout.zoomAround(1.2, 700, 500);
      refit();
    }
    const [id] = Object.keys(board.vertices);
    const settled = layout.vertex(id);

    // Pinching further open must be a no-op, not a slow slide.
    layout.zoomAround(1.2, 700, 500);
    refit();

    expect(layout.vertex(id)).toEqual(settled);
  });

  it('recentres the board once it is zoomed right back out', () => {
    const { layout } = fitted();
    layout.zoomAround(2, 700, 500);
    expect(layout.panX === 0 && layout.panY === 0).toBe(false);

    for (let i = 0; i < 60; i++) layout.zoomAround(0.8, 700, 500);
    expect(layout.zoom).toBe(MIN_ZOOM);
    expect(layout.panX).toBe(0);
    expect(layout.panY).toBe(0);
  });
});
