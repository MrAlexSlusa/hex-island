/**
 * Deterministic PRNG (mulberry32). The seed lives inside the game state so
 * saves replay identically and tests can pin behaviour.
 */

export function nextSeed(seed: number): number {
  return (seed + 0x6d2b79f5) >>> 0;
}

/** Returns a float in [0, 1) for a given seed without mutating anything. */
export function randomFrom(seed: number): number {
  let t = seed >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export class Rng {
  seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  next(): number {
    this.seed = nextSeed(this.seed);
    return randomFrom(this.seed);
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Inclusive on both ends. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}
