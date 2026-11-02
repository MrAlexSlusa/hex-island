/**
 * Generates the resource, card and dice artwork in `public/assets/svg`.
 *
 * The five resource symbols are drawn once here and reused at three sizes:
 * a round badge (`icon_*.svg`) for the hand, cost labels and fly-away chips,
 * a full card (`card_*.svg`) for the dialogs, and the same silhouettes the
 * tiles already use. Keeping one source means a tweak to, say, the sheep's
 * head lands everywhere at once.
 *
 * Run with `npm run art`. The tile, token and piece art is hand-made and is
 * deliberately left alone.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'svg');

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

const RESOURCES = {
  wood: { label: 'WOOD', light: '#4cb866', dark: '#1b6b33', rim: '#0f4a22' },
  brick: { label: 'BRICK', light: '#ef9159', dark: '#9c3f21', rim: '#6f2912' },
  wool: { label: 'WOOL', light: '#aee484', dark: '#4f9a35', rim: '#2f6a1e' },
  grain: { label: 'GRAIN', light: '#fade74', dark: '#cf981c', rim: '#946a0c' },
  ore: { label: 'ORE', light: '#aab5c4', dark: '#525d6c', rim: '#333d49' },
};

/* ------------------------------------------------------------------ *
 * The symbols
 *
 * Each one is drawn around (0,0) and fills roughly a 76x76 box, so they can
 * be dropped into any frame with a single scale.
 * ------------------------------------------------------------------ */

/** One end-on log: growth rings on a sawn face. */
function log(cx, cy, r) {
  return `<g transform="translate(${cx},${cy})">
    <circle r="${r}" fill="#b87c45" stroke="#5f3c1d" stroke-width="4"/>
    <circle r="${r * 0.66}" fill="none" stroke="#8d5a2b" stroke-width="3.5"/>
    <circle r="${r * 0.3}" fill="#8d5a2b"/>
  </g>`;
}

const SYMBOL = {
  wood: () => `<g>
    ${log(-19, 14, 19)}
    ${log(19, 14, 19)}
    ${log(0, -18, 19)}
  </g>`,

  brick: () => {
    const rows = [
      { y: -32, spans: [[-32, 30], [2, 30]] },
      { y: -11, spans: [[-32, 14], [-16, 30], [18, 14]] },
      { y: 10, spans: [[-32, 30], [2, 30]] },
    ];
    const bricks = rows
      .flatMap(({ y, spans }) =>
        spans.map(
          ([x, w]) =>
            `<rect x="${x}" y="${y}" width="${w}" height="18" rx="3" fill="#d9663c" stroke="#7e2f14" stroke-width="3.5"/>` +
            `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="5" rx="2.5" fill="#fff" opacity=".22"/>`,
        ),
      )
      .join('');
    return `<g transform="translate(0,4)">${bricks}</g>`;
  },

  wool: () => `<g>
    <g fill="#f4f7fb" stroke="#c3ccd9" stroke-width="3.5">
      <circle cx="-20" cy="2" r="17"/>
      <circle cx="-2" cy="-12" r="18"/>
      <circle cx="16" cy="-2" r="16"/>
      <circle cx="-10" cy="14" r="17"/>
      <circle cx="10" cy="16" r="15"/>
    </g>
    <g fill="#f4f7fb">
      <circle cx="-20" cy="2" r="17"/>
      <circle cx="-2" cy="-12" r="18"/>
      <circle cx="16" cy="-2" r="16"/>
      <circle cx="-10" cy="14" r="17"/>
      <circle cx="10" cy="16" r="15"/>
    </g>
    <g fill="#2f3a48">
      <rect x="-16" y="26" width="9" height="14" rx="4"/>
      <rect x="6" y="26" width="9" height="14" rx="4"/>
    </g>
    <g transform="translate(29,-14) rotate(12)">
      <ellipse cx="-13" cy="-4" rx="7" ry="10" fill="#222b36"/>
      <ellipse cx="13" cy="-4" rx="7" ry="10" fill="#222b36"/>
      <ellipse rx="13" ry="15" fill="#2f3a48"/>
      <circle cx="-5" cy="-3" r="3" fill="#fff"/>
      <circle cx="6" cy="-3" r="3" fill="#fff"/>
      <circle cx="-5" cy="-3" r="1.4" fill="#111"/>
      <circle cx="6" cy="-3" r="1.4" fill="#111"/>
      <ellipse cy="9" rx="5" ry="3.5" fill="#1a222c"/>
    </g>
  </g>`,

  grain: () => {
    const grain = (x, y, rot) =>
      `<ellipse cx="${x}" cy="${y}" rx="7.5" ry="13" transform="rotate(${rot} ${x} ${y})" fill="#f5c93c" stroke="#9a6d0f" stroke-width="3"/>`;
    const ears = [20, 6, -8, -22]
      .map((y, i) => grain(-13 + i * 0.5, y, -34) + grain(13 - i * 0.5, y, 34))
      .join('');
    return `<g transform="translate(0,2)">
      <path d="M0 40 L0 -16" stroke="#9a6d0f" stroke-width="6" stroke-linecap="round"/>
      <path d="M0 26 C -14 22 -22 30 -26 38 C -14 40 -4 36 0 30 Z" fill="#8fbe3a" stroke="#5c8420" stroke-width="3"/>
      <path d="M0 14 C 14 10 22 18 26 26 C 14 28 4 24 0 18 Z" fill="#8fbe3a" stroke="#5c8420" stroke-width="3"/>
      ${ears}
      ${grain(0, -34, 0)}
    </g>`;
  },

  ore: () => `<g transform="translate(0,4)">
    <polygon points="-38,24 -22,-10 -2,24" fill="#8b96a5" stroke="#39434f" stroke-width="3.5" stroke-linejoin="round"/>
    <polygon points="4,24 24,-6 40,24" fill="#8b96a5" stroke="#39434f" stroke-width="3.5" stroke-linejoin="round"/>
    <polygon points="-26,26 0,-38 26,26" fill="#9fabbb" stroke="#39434f" stroke-width="4" stroke-linejoin="round"/>
    <polygon points="0,-38 26,26 6,26" fill="#6c7786"/>
    <polygon points="0,-38 -11,-10 0,-14 10,-10" fill="#fff" opacity=".85"/>
    <path d="M28,-26 l3.5,8 8,3.5 -8,3.5 -3.5,8 -3.5,-8 -8,-3.5 8,-3.5 Z" fill="#fff"/>
  </g>`,
};

/* ------------------------------------------------------------------ *
 * Shared defs
 * ------------------------------------------------------------------ */

function defs(extra = '') {
  return `<defs>
    ${Object.entries(RESOURCES)
      .map(
        ([key, c]) =>
          `<linearGradient id="g_${key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.light}"/><stop offset="1" stop-color="${c.dark}"/></linearGradient>`,
      )
      .join('')}
    <filter id="drop" x="-35%" y="-35%" width="170%" height="175%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#021a33" flood-opacity=".45"/></filter>
    ${extra}
  </defs>`;
}

/* ------------------------------------------------------------------ *
 * Round badge — the logo that shows up in the hand and on buttons
 * ------------------------------------------------------------------ */

function icon(key) {
  const c = RESOURCES[key];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${defs(
    `<radialGradient id="sheen" cx=".32" cy=".26" r=".85"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
  )}
  <g filter="url(#drop)">
    <circle cx="64" cy="64" r="56" fill="url(#g_${key})" stroke="#ffffff" stroke-width="6"/>
    <circle cx="64" cy="64" r="56" fill="url(#sheen)"/>
    <circle cx="64" cy="64" r="49" fill="none" stroke="${c.rim}" stroke-opacity=".35" stroke-width="3"/>
  </g>
  <g transform="translate(64,65) scale(0.82)">${SYMBOL[key]()}</g>
</svg>`;
}

/* ------------------------------------------------------------------ *
 * Full card — used in the trade, discard and monopoly dialogs
 * ------------------------------------------------------------------ */

function card(key) {
  const c = RESOURCES[key];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420">${defs(
    `<radialGradient id="glow" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
  )}
  <rect x="6" y="6" width="288" height="408" rx="30" fill="url(#g_${key})" stroke="#ffffff" stroke-width="7"/>
  <rect x="22" y="22" width="256" height="376" rx="20" fill="none" stroke="${c.rim}" stroke-opacity=".4" stroke-width="4"/>
  <circle cx="150" cy="172" r="112" fill="url(#glow)"/>
  <circle cx="150" cy="172" r="104" fill="#ffffff" opacity=".18"/>
  <g transform="translate(150,174) scale(2.05)">${SYMBOL[key]()}</g>
  <rect x="36" y="320" width="228" height="62" rx="31" fill="${c.rim}" opacity=".55"/>
  <text x="150" y="362" font-family="Verdana, Geneva, sans-serif" font-size="30" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="4">${c.label}</text>
</svg>`;
}

/* ------------------------------------------------------------------ *
 * Dice
 * ------------------------------------------------------------------ */

const PIPS = {
  1: [[0, 0]],
  2: [[-26, -26], [26, 26]],
  3: [[-26, -26], [0, 0], [26, 26]],
  4: [[-26, -26], [26, -26], [-26, 26], [26, 26]],
  5: [[-26, -26], [26, -26], [0, 0], [-26, 26], [26, 26]],
  6: [[-26, -26], [26, -26], [-26, 0], [26, 0], [-26, 26], [26, 26]],
};

function die(face) {
  const pips = PIPS[face]
    .map(
      ([x, y]) =>
        `<circle cx="${x}" cy="${y}" r="10" fill="url(#pip)"/>` +
        `<circle cx="${x - 2.6}" cy="${y - 3}" r="3.4" fill="#ffffff" opacity=".22"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="-60 -58 120 124">
  <defs>
    <linearGradient id="face" x1="0" y1="0" x2=".25" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f3f5f9"/><stop offset="1" stop-color="#d7dde7"/></linearGradient>
    <radialGradient id="pip" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#4a5564"/><stop offset="1" stop-color="#121922"/></radialGradient>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#021a33" flood-opacity=".5"/></filter>
  </defs>
  <g filter="url(#sh)">
    <rect x="-50" y="-50" width="100" height="100" rx="22" fill="url(#face)" stroke="#aab3c0" stroke-width="3"/>
    <rect x="-43" y="-43" width="86" height="86" rx="17" fill="none" stroke="#ffffff" stroke-width="4" stroke-opacity=".85"/>
    <path d="M-43 -26 A 17 17 0 0 1 -26 -43 L 26 -43 A 17 17 0 0 1 43 -26 L 43 -14 Q 0 -30 -43 -6 Z" fill="#ffffff" opacity=".7"/>
    ${pips}
  </g>
</svg>`;
}

/* ------------------------------------------------------------------ *
 * Write everything
 * ------------------------------------------------------------------ */

mkdirSync(OUT, { recursive: true });

const files = [];
for (const key of Object.keys(RESOURCES)) {
  files.push([`icon_${key}.svg`, icon(key)], [`card_${key}.svg`, card(key)]);
}
for (let n = 1; n <= 6; n++) files.push([`die_${n}.svg`, die(n)]);

for (const [name, svg] of files) {
  writeFileSync(join(OUT, name), `${svg.replace(/\n\s*/g, '')}\n`);
}

console.log(`wrote ${files.length} files to public/assets/svg`);
