/** Tiny DOM helpers: element building, modals and toasts. */

type Attrs = Record<string, unknown>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] | Child = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'disabled' || key === 'checked') {
      (node as unknown as Record<string, unknown>)[key] = Boolean(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

export function clear(node: Element) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export interface ModalHandle<T> {
  element: HTMLElement;
  result: Promise<T>;
  close(value: T): void;
}

/**
 * Opens a modal. `build` receives a `close` callback it can wire to buttons.
 * `dismissible` modals can also be closed with Escape or a backdrop click.
 */
export function openModal<T>(
  build: (close: (value: T) => void) => { title: string; subtitle?: string; body: Child[]; actions?: Child[] },
  options: { dismissible?: boolean; dismissValue?: T; wide?: boolean } = {},
): ModalHandle<T> {
  const root = qs('#modal-root');
  let settle!: (value: T) => void;
  const result = new Promise<T>((resolve) => (settle = resolve));

  const backdrop = el('div', { class: 'modal-backdrop' });

  const close = (value: T) => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    settle(value);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && options.dismissible) close(options.dismissValue as T);
  };

  const spec = build(close);
  const dialog = el('div', { class: `modal${options.wide ? ' is-wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, [
    el('h2', {}, spec.title),
    spec.subtitle ? el('p', { class: 'sub' }, spec.subtitle) : null,
    ...spec.body,
    spec.actions?.length ? el('div', { class: 'modal-actions' }, spec.actions) : null,
  ]);

  backdrop.append(dialog);
  if (options.dismissible) {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(options.dismissValue as T);
    });
  }
  document.addEventListener('keydown', onKey);
  root.append(backdrop);

  return { element: dialog, result, close };
}

let toastTimer: number | undefined;

export function toast(message: string, tone: 'error' | 'info' = 'error') {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: 'toast' }, message);
  if (tone === 'info') node.style.borderLeftColor = 'var(--green)';
  document.body.append(node);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.remove(), 2600);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** A +/- counter used by the trade and discard dialogs. */
export function stepper(
  value: number,
  max: number,
  onChange: (next: number) => void,
): HTMLElement {
  const label = el('span', { class: 'value' }, String(value));
  const minus = el('button', { type: 'button', 'aria-label': 'less', disabled: value <= 0 }, '−');
  const plus = el('button', { type: 'button', 'aria-label': 'more', disabled: value >= max }, '+');
  minus.addEventListener('click', () => onChange(value - 1));
  plus.addEventListener('click', () => onChange(value + 1));
  return el('div', { class: 'stepper' }, [minus, label, plus]);
}
