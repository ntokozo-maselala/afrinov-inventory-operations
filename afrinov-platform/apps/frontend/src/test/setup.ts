import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

const sessionStore = new Map<string, string>();
const localStore = new Map<string, string>();

const createStorageStub = (store: Map<string, string>) => ({
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
});

vi.stubGlobal('sessionStorage', createStorageStub(sessionStore));
vi.stubGlobal('localStorage', createStorageStub(localStore));

vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query === '(prefers-reduced-motion: reduce)',
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

Object.defineProperty(window, 'location', {
  value: { href: 'http://localhost:5173/' },
  writable: true,
});

const styleSheets: CSSStyleSheet[] = [];

function createMockCSSRuleList(rules: CSSRule[]): CSSRuleList {
  return {
    length: rules.length,
    item: (index: number) => rules[index] ?? null,
    [Symbol.iterator](): IterableIterator<CSSRule> {
      return rules[Symbol.iterator]();
    },
  };
}

function createMockCSSStyleSheet(ownerNode: HTMLElement): CSSStyleSheet {
  const rules: CSSRule[] = [];
  const ruleList = createMockCSSRuleList(rules);
  const mediaList: MediaList = {
    mediaText: '',
    length: 0,
    item: () => null,
    appendMedium: vi.fn(),
    deleteMedium: vi.fn(),
    [Symbol.iterator](): IterableIterator<string> {
      return [][Symbol.iterator]();
    },
  };
  const sheet = {
    cssRules: ruleList,
    ownerNode,
    insertRule: vi.fn((rule: string, index?: number) => {
      const newRule = { cssText: rule } as CSSRule;
      rules.splice(index ?? rules.length, 0, newRule);
      return rules.length - 1;
    }),
    deleteRule: vi.fn((index: number) => {
      rules.splice(index, 1);
    }),
    ownerRule: null,
    rules: ruleList,
    addRule: vi.fn(),
    removeRule: vi.fn(),
    type: 'text/css',
    href: null,
    title: '',
    media: mediaList,
    disabled: false,
    parentStyleSheet: null,
    replace: vi.fn(() => Promise.resolve(sheet)),
    replaceSync: vi.fn((cssText: string) => {
      rules.length = 0;
      rules.push({ cssText } as CSSRule);
    }),
  };
  return sheet as CSSStyleSheet;
}

Object.defineProperty(document, 'styleSheets', {
  value: styleSheets,
  writable: true,
});

let documentStyleSheetsCounter = 0;
const originalCreateElement = document.createElement.bind(document);
document.createElement = ((tag: string, options?: ElementCreationOptions) => {
  const el = originalCreateElement(tag, options);
  if (tag === 'style') {
    const id = `style-${++documentStyleSheetsCounter}`;
    el.id = id;
    styleSheets.push(createMockCSSStyleSheet(el));
  }
  return el;
}) as typeof document.createElement;

HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();
HTMLDialogElement.prototype.show = vi.fn();