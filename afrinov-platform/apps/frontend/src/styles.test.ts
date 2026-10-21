import { describe, it, expect } from 'vitest';
import { parse, type Root } from 'postcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// jsdom and the shared setup do not apply these stylesheets. Parse the real
// declarations and validate resolved colors through the CSS declaration API.
const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const globalStyles = parse(readFileSync(resolve(sourceDirectory, 'index.css'), 'utf8'));
const dashboardStyles = parse(readFileSync(resolve(sourceDirectory, 'pages/Dashboard.css'), 'utf8'));

function declarations(styles: Root, selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  styles.walkRules((rule) => {
    if (rule.selector === selector) {
      rule.walkDecls((declaration) => { result[declaration.prop] = declaration.value; });
    }
  });
  return result;
}

function resolveColors(value: string, palette: Record<string, string>): string {
  return value.replace(/var\((--color-[\w-]+)\)/g, (_, token: string) => {
    expect(palette[token], `Missing theme token ${token}`).toBeDefined();
    return palette[token]!;
  });
}

function expectValidColor(value: string, palette: Record<string, string>, context: string) {
  const style = document.createElement('span').style;
  style.color = resolveColors(value, palette);
  expect(style.color, context).not.toBe('');
}

describe.each(['light', 'dark'])('%s theme color regressions', (theme) => {
  const base = declarations(globalStyles, ':root');
  const palette = theme === 'dark' ? { ...base, ...declarations(globalStyles, '.dark') } : base;

  it.each([
    ['global', globalStyles],
    ['dashboard', dashboardStyles],
  ] as const)('uses valid RGB colors in the %s stylesheet', (_, styles) => {
    let checked = 0;
    styles.walkDecls((declaration) => {
      // Also covers RGB values inside gradients, shadows and custom properties.
      for (const [color] of declaration.value.matchAll(/rgb\(var\(--color-[\w-]+\)[^)]*\)/g)) {
        expectValidColor(color, palette, `${declaration.parent?.toString()}: ${color}`);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('provides usable dashboard surface and text colors', () => {
    const dashboard = declarations(dashboardStyles, '.dashboard-theme');
    for (const name of ['bg', 'panel', 'panel-raised', 'border', 'text', 'muted', 'soft', 'red']) {
      const token = `--dashboard-${name}`;
      expect(dashboard[token], token).toBeDefined();
      expectValidColor(dashboard[token]!, palette, token);
    }
  });

  it('uses the theme-specific warning shade for KPI and unpriced chart labels', () => {
    const expected = theme === 'dark' ? 'rgb(var(--color-warning-500) / 1)' : 'rgb(var(--color-warning-600) / 1)';
    for (const selector of ['.dashboard-kpi-warning', '.dashboard-chart-unpriced']) {
      const rules = theme === 'dark'
        ? { ...declarations(dashboardStyles, selector), ...declarations(dashboardStyles, `.dark ${selector}`) }
        : declarations(dashboardStyles, selector);
      expect(rules.color, selector).toBe(expected);
    }
  });
});

describe('Dark chart palette', () => {
  it('provides five usable semantic chart colors', () => {
    const palette = { ...declarations(globalStyles, ':root'), ...declarations(globalStyles, '.dark') };
    for (const number of [1, 2, 3, 4, 5]) {
      const token = `--chart-${number}`;
      expect(palette[token], token).toBeDefined();
      expectValidColor(palette[token]!, palette, token);
    }
  });
});

describe('Skip link styles', () => {
  it('moves the link off screen until keyboard focus reveals it', () => {
    const normal = declarations(globalStyles, '.skip-link');
    const focused = declarations(globalStyles, '.skip-link:focus-visible');

    expect(normal.position).toBe('fixed');
    expect(normal.transform).toMatch(/^translateY\(calc\(-100% - /);
    expect(focused.transform).toBe('translateY(0)');
    // It must remain keyboard accessible while visually off screen.
    expect(normal.display).not.toBe('none');
    expect(normal.visibility).not.toBe('hidden');
    expect(Number(normal['z-index'])).toBeGreaterThan(0);
  });
});
