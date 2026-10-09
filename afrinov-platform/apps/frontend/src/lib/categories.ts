// The five material categories, in the stock workbook's order and wording.
// The one list the forms, filters, tables, reports and exports label from.

export const CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'CONSUMABLES', label: 'Consumables' },
  { value: 'FASTENERS_SLUGS_INSULATION', label: 'Fasteners, Slugs & Insulation' },
  { value: 'TOOLING_PPE_ELECTRICAL', label: 'Tooling, PPE & Electrical' },
  { value: 'PROJECT_MATERIAL', label: 'Project Material' },
  { value: 'TOOLS', label: 'Tools' },
];

export function categoryLabel(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.label ?? category;
}
