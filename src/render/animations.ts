/**
 * A tiny tween registry. Animations are data; the renderer reads them each
 * frame and the caller can await one finishing.
 */

export type AnimKind = 'robberMove' | 'buildPop' | 'blocked' | 'steal';

export interface Anim {
  id: number;
  kind: AnimKind;
  start: number;
  duration: number;
  data: Record<string, unknown>;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class Animator {
  private items: Anim[] = [];
  private nextId = 1;
  private waiters: { until: number; resolve: () => void }[] = [];

  add(kind: AnimKind, duration: number, data: Record<string, unknown> = {}): Anim {
    const anim: Anim = { id: this.nextId++, kind, start: performance.now(), duration, data };
    this.items.push(anim);
    return anim;
  }

  /** Resolves once every animation queued so far has finished. */
  settled(): Promise<void> {
    const until = this.items.reduce((t, a) => Math.max(t, a.start + a.duration), 0);
    if (until <= performance.now()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ until, resolve }));
  }

  update(now: number) {
    this.items = this.items.filter((a) => now < a.start + a.duration);
    if (this.waiters.length) {
      const done = this.waiters.filter((w) => now >= w.until);
      this.waiters = this.waiters.filter((w) => now < w.until);
      for (const w of done) w.resolve();
    }
  }

  all(kind: AnimKind): Anim[] {
    return this.items.filter((a) => a.kind === kind);
  }

  first(kind: AnimKind): Anim | undefined {
    return this.items.find((a) => a.kind === kind);
  }

  get busy(): boolean {
    return this.items.length > 0;
  }

  progress(anim: Anim, now: number): number {
    return Math.max(0, Math.min(1, (now - anim.start) / anim.duration));
  }

  clear() {
    this.items = [];
    for (const w of this.waiters) w.resolve();
    this.waiters = [];
  }
}
