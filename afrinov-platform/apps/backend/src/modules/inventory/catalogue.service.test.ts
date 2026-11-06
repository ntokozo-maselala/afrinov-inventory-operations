import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { catalogueTabOf, stockStateOf, summarise } from './catalogue.service.js';

const item = (id: string, category = 'CONSUMABLES', active = true) => ({ id, category, active });
const line = (materialId: string, quantity: number, heldForProject = '') => ({ materialId, quantity: new Prisma.Decimal(quantity), heldForProject });

describe('catalogueTabOf', () => {
  it('gives tools a tab of their own, apart from the rest of Stores', () => {
    expect(catalogueTabOf('TOOLS')).toBe('TOOLS');
    expect(catalogueTabOf('PROJECT_MATERIAL')).toBe('PROJECTS');
    expect(catalogueTabOf('CONSUMABLES')).toBe('STORES');
    expect(catalogueTabOf('TOOLING_PPE_ELECTRICAL')).toBe('STORES');
  });
});

describe('stockStateOf', () => {
  it('reads an item with no stock line as never received', () => {
    expect(stockStateOf([])).toBe('NEVER_RECEIVED');
  });

  it('reads Stores stock on hand as in stock, whatever else is held', () => {
    expect(stockStateOf([line('a', 0), line('a', 3)])).toBe('IN_STOCK');
    expect(stockStateOf([line('a', 3), line('a', 5, 'AFRI-1')])).toBe('IN_STOCK');
  });

  it('reads an item whose only stock is held for a project as held, not never received', () => {
    expect(stockStateOf([line('a', 5, 'AFRI-1')])).toBe('HELD_FOR_PROJECT');
    expect(stockStateOf([line('a', 0), line('a', 5, 'AFRI-1')])).toBe('HELD_FOR_PROJECT');
  });

  it('reads stock lines all at nothing as out of stock: received once, none left', () => {
    expect(stockStateOf([line('a', 0)])).toBe('OUT_OF_STOCK');
    expect(stockStateOf([line('a', 0, 'AFRI-1')])).toBe('OUT_OF_STOCK');
  });
});

describe('summarise', () => {
  it('counts an item in two locations as two lines but one item', () => {
    const s = summarise([item('a')], [line('a', 3), line('a', 4)]);
    expect(s.stock).toMatchObject({ lines: 2, items: 1 });
    expect(s.states.IN_STOCK).toBe(1);
  });

  it('adds the tabs up to the catalogue, inactive items included', () => {
    const s = summarise([item('a'), item('b', 'CONSUMABLES', false), item('t', 'TOOLS'), item('p', 'PROJECT_MATERIAL')], []);
    expect(s.tabs).toEqual({ STORES: 2, TOOLS: 1, PROJECTS: 1 });
    expect(s.tabs.STORES + s.tabs.TOOLS + s.tabs.PROJECTS).toBe(s.items);
    expect(s).toMatchObject({ items: 4, active: 3, inactive: 1 });
  });

  it('says which items Stock cannot list, and counts Projects items as neither', () => {
    const s = summarise([item('a'), item('new'), item('t', 'TOOLS'), item('p', 'PROJECT_MATERIAL')], [line('a', 1)]);
    expect(s.notOnStock).toEqual({ items: 2, tools: 1 });
    expect(s.states.NEVER_RECEIVED).toBe(2);
  });

  it('makes up both tabs from what is on Stock and what is not', () => {
    const s = summarise(
      [item('a'), item('b'), item('held'), item('t', 'TOOLS'), item('t2', 'TOOLS'), item('p', 'PROJECT_MATERIAL')],
      [line('a', 1), line('a', 2), line('held', 4, 'AFRI-1'), line('t', 1)],
    );
    expect(s.stock.items + s.notOnStock.items).toBe(s.tabs.STORES + s.tabs.TOOLS);
  });

  it('keeps an item used up to nothing on Stock: received, but not in stock', () => {
    const s = summarise([item('a')], [line('a', 0)]);
    expect(s.stock).toMatchObject({ lines: 1, items: 1 });
    expect(s.states).toMatchObject({ OUT_OF_STOCK: 1, IN_STOCK: 0, NEVER_RECEIVED: 0 });
  });

  it('leaves stock held for a project off Stock, and does not call that item never received', () => {
    const s = summarise([item('a')], [line('a', 5, 'AFRI-1')]);
    expect(s.stock).toMatchObject({ lines: 0, items: 0 });
    expect(s.notOnStock.items).toBe(1);
    expect(s.states).toMatchObject({ HELD_FOR_PROJECT: 1, NEVER_RECEIVED: 0 });
  });

  it('counts a received tool on Stock as well as on Tools, the double count of adding them', () => {
    const s = summarise([item('t', 'TOOLS')], [line('t', 2)]);
    expect(s.stock.tools).toBe(1);
    expect(s.toolsListed).toBe(1);
  });

  it('leaves an inactive tool off Tools, though Materials and Stock keep it', () => {
    const s = summarise([item('t', 'TOOLS', false)], [line('t', 2)]);
    expect(s.toolsListed).toBe(0);
    expect(s.stock.items).toBe(1);
    expect(s.tabs.TOOLS).toBe(1);
  });

  it('leaves out lines of a Projects item, as Stock does', () => {
    const s = summarise([item('p', 'PROJECT_MATERIAL')], [line('p', 5)]);
    expect(s.stock).toMatchObject({ lines: 0, items: 0 });
    expect(s.states.IN_STOCK).toBe(0);
  });
});
