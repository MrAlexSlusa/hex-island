/**
 * Player pieces are drawn procedurally rather than loaded as images.
 *
 * The geometry is lifted straight from the art pack's SVGs so they match the
 * rest of the board, but drawing them by hand means any player colour works
 * (the pack only ships four) and ghost previews are a matter of alpha.
 */

export interface PieceStyle {
  color: string;
  dark: string;
  alpha?: number;
  /** Draws a soft glow behind the piece, used for previews and new builds. */
  glow?: string;
}

function begin(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, style: PieceStyle) {
  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
}

function polygon(ctx: CanvasRenderingContext2D, points: number[][]) {
  ctx.beginPath();
  points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
}

function shadow(ctx: CanvasRenderingContext2D, style: PieceStyle) {
  if (style.glow) {
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = 18;
  } else {
    ctx.shadowColor = 'rgba(3, 20, 40, 0.45)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
  }
}

function clearShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** `size` is the half-width of the house, in pixels. */
export function drawSettlement(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  style: PieceStyle,
) {
  const scale = size / 17;
  begin(ctx, x, y, scale, style);
  shadow(ctx, style);
  polygon(ctx, [
    [-17, 16],
    [-17, -3],
    [0, -20],
    [17, -3],
    [17, 16],
  ]);
  ctx.fillStyle = style.color;
  ctx.fill();
  clearShadow(ctx);
  ctx.strokeStyle = style.dark;
  ctx.stroke();

  // Eaves and door, matching the art pack's detailing.
  ctx.globalAlpha = (style.alpha ?? 1) * 0.45;
  polygon(ctx, [
    [-21, -1],
    [0, -24],
    [21, -1],
    [15, -1],
    [0, -16],
    [-15, -1],
  ]);
  ctx.fillStyle = style.dark;
  ctx.fill();

  ctx.globalAlpha = (style.alpha ?? 1) * 0.7;
  ctx.beginPath();
  ctx.roundRect(-4.5, 3, 9, 13, 2);
  ctx.fill();
  ctx.restore();
}

/** `size` is the half-width of the city block, in pixels. */
export function drawCity(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  style: PieceStyle,
) {
  const scale = size / 28;
  begin(ctx, x, y, scale, style);
  shadow(ctx, style);
  polygon(ctx, [
    [-28, 16],
    [-28, -4],
    [-9, -4],
    [-9, -17],
    [4, -30],
    [17, -17],
    [17, -6],
    [28, -6],
    [28, 16],
  ]);
  ctx.fillStyle = style.color;
  ctx.fill();
  clearShadow(ctx);
  ctx.strokeStyle = style.dark;
  ctx.stroke();

  ctx.globalAlpha = (style.alpha ?? 1) * 0.45;
  polygon(ctx, [
    [-9, -17],
    [4, -30],
    [17, -17],
    [12, -17],
    [4, -24],
    [-4, -17],
  ]);
  ctx.fillStyle = style.dark;
  ctx.fill();

  ctx.globalAlpha = (style.alpha ?? 1) * 0.6;
  for (const [rx, ry, rw, rh] of [
    [-3, -12, 7, 8],
    [-21, 3, 8, 8],
    [12, 3, 8, 8],
  ]) {
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 1.5);
    ctx.fill();
  }
  ctx.restore();
}

/** Draws a road between two points. */
export function drawRoad(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness: number,
  style: PieceStyle,
) {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const angle = Math.atan2(by - ay, bx - ax);
  const length = Math.hypot(bx - ax, by - ay) * 0.78;

  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.translate(mx, my);
  ctx.rotate(angle);
  shadow(ctx, style);
  ctx.beginPath();
  ctx.roundRect(-length / 2, -thickness / 2, length, thickness, thickness * 0.35);
  ctx.fillStyle = style.color;
  ctx.fill();
  clearShadow(ctx);
  ctx.lineWidth = Math.max(1.5, thickness * 0.17);
  ctx.strokeStyle = style.dark;
  ctx.stroke();

  ctx.globalAlpha = (style.alpha ?? 1) * 0.4;
  ctx.beginPath();
  ctx.roundRect(-length / 2 + thickness * 0.4, -thickness * 0.26, length - thickness * 0.8, thickness * 0.22, thickness * 0.11);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}
