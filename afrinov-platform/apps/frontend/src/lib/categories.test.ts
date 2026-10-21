import { describe, expect, it } from 'vitest';
import { CATEGORIES, PROJECTS_CATEGORY, STORES_CATEGORIES, sectionOf } from './categories';

describe('material sections', () => {
  it('reserves Project Material for Projects and keeps the Stores categories in workbook order', () => {
    expect(PROJECTS_CATEGORY).toBe('PROJECT_MATERIAL');
    expect(STORES_CATEGORIES).toEqual([
      { value: 'CONSUMABLES', label: 'Consumables' },
      { value: 'FASTENERS_SLUGS_INSULATION', label: 'Fasteners, Slugs & Insulation' },
      { value: 'TOOLING_PPE_ELECTRICAL', label: 'Tooling, PPE & Electrical' },
      { value: 'TOOLS', label: 'Tools' },
    ]);
    // The full catalogue still needs Project Material for existing items and reports.
    expect(CATEGORIES).toContainEqual({ value: 'PROJECT_MATERIAL', label: 'Project Material' });
    expect(CATEGORIES).toHaveLength(5);
  });

  it.each([
    ['PROJECT_MATERIAL', 'PROJECTS'],
    ['CONSUMABLES', 'STORES'],
    ['FASTENERS_SLUGS_INSULATION', 'STORES'],
    ['TOOLING_PPE_ELECTRICAL', 'STORES'],
    ['TOOLS', 'STORES'],
    ['LEGACY_CATEGORY', 'STORES'],
    ['', 'STORES'],
    ['project_material', 'STORES'],
  ])('places category %j in %s', (category, expected) => {
    expect(sectionOf(category)).toBe(expected);
  });
});
