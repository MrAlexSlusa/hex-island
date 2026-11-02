/**
 * Loads the SVG art pack into images the canvas can draw.
 *
 * Everything lives in `public/assets/svg`, so it is served as-is and scales
 * cleanly at any board size. If a file is missing the renderer falls back to
 * drawing the shape procedurally, so the game still runs.
 */

import { RESOURCE_ASSET, RESOURCES } from '../game/constants';
import type { Resource, Terrain } from '../game/types';

const BASE = `${import.meta.env.BASE_URL}assets/svg/`;

const TERRAIN_FILE: Record<Terrain, string> = {
  forest: 'tile_forest',
  hills: 'tile_hills',
  pasture: 'tile_pasture',
  fields: 'tile_fields',
  mountains: 'tile_mountains',
  desert: 'tile_desert',
  ocean: 'tile_ocean',
};

export interface Assets {
  tiles: Partial<Record<Terrain, HTMLImageElement>>;
  tokens: Record<number, HTMLImageElement>;
  dice: Record<number, HTMLImageElement>;
  cards: Partial<Record<Resource, HTMLImageElement>>;
  robber?: HTMLImageElement;
}

/** Natural geometry of the tile art, in its own viewBox units. */
export const TILE_ART = {
  viewWidth: 230,
  viewHeight: 240,
  offsetX: -115,
  offsetY: -112,
  /** Circumradius of the hex inside that viewBox. */
  radius: 107,
};

function loadImage(name: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `${BASE}${name}.svg`;
  });
}

export async function loadAssets(): Promise<Assets> {
  const assets: Assets = { tiles: {}, tokens: {}, dice: {}, cards: {} };

  const jobs: Promise<void>[] = [];

  for (const [terrain, file] of Object.entries(TERRAIN_FILE) as [Terrain, string][]) {
    jobs.push(
      loadImage(file).then((img) => {
        if (img) assets.tiles[terrain] = img;
      }),
    );
  }

  for (const n of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
    jobs.push(
      loadImage(`token_${n}`).then((img) => {
        if (img) assets.tokens[n] = img;
      }),
    );
  }

  for (let n = 1; n <= 6; n++) {
    jobs.push(
      loadImage(`die_${n}`).then((img) => {
        if (img) assets.dice[n] = img;
      }),
    );
  }

  for (const r of RESOURCES) {
    jobs.push(
      loadImage(`card_${RESOURCE_ASSET[r]}`).then((img) => {
        if (img) assets.cards[r] = img;
      }),
    );
  }

  jobs.push(
    loadImage('robber').then((img) => {
      if (img) assets.robber = img;
    }),
  );

  await Promise.all(jobs);
  return assets;
}

/** URL of a full resource card image, for the dialogs. */
export function cardUrl(resource: Resource): string {
  return `${BASE}card_${RESOURCE_ASSET[resource]}.svg`;
}

/**
 * URL of a resource's round badge. The full card art loses its detail below
 * about 90px, so anywhere small — the hand, cost labels, fly-away chips —
 * uses the badge instead.
 */
export function iconUrl(resource: Resource): string {
  return `${BASE}icon_${RESOURCE_ASSET[resource]}.svg`;
}

export function dieUrl(face: number): string {
  return `${BASE}die_${face}.svg`;
}
