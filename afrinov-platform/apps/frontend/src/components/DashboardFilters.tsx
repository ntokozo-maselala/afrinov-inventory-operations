import { Icon } from './Icon';
import { Button } from './Button';
import type { ReportKpis } from '../mock/mockReport';

export const DASHBOARD_RANGE_OPTIONS = [
  { value: 'ALL', label: 'All time' },
  { value: 'TODAY', label: 'Today' },
  { value: 'WEEK', label: 'This week' },
  { value: 'MONTH', label: 'This month' },
  { value: 'QUARTER', label: 'This quarter' },
  { value: 'YEAR', label: 'This year' },
];

export const DASHBOARD_QUICK_RANGES = [
  { value: 'WEEK', label: '7d' },
  { value: 'MONTH', label: '30d' },
  { value: 'QUARTER', label: '90d' },
  { value: 'YEAR', label: '12m' },
  { value: 'ALL', label: 'All' },
] as const;

export const CATEGORY_OPTIONS = [
  { value: 'FASTENERS_SLUGS_INSULATION', label: 'Fasteners, Slugs & Insulation' },
  { value: 'TOOLING_PPE_ELECTRICAL', label: 'Tooling, PPE & Electrical' },
  { value: 'PROJECT_MATERIAL', label: 'Project Material' },
  { value: 'CONSUMABLES', label: 'Consumables' },
  { value: 'TOOLS', label: 'Tools' },
];

export type DashboardRange = (typeof DASHBOARD_RANGE_OPTIONS)[number]['value'];

interface LocationOption {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

interface DashboardFiltersProps {
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  category: string[];
  onCategoryChange: (category: string[]) => void;
  location: string[];
  onLocationChange: (location: string[]) => void;
  locations: LocationOption[];
  onRefresh: () => void;
  loading: boolean;
  error: null | { message: string };
  kpis?: ReportKpis | null;
}

export function DashboardFilters({
  range,
  onRangeChange,
  category,
  onCategoryChange,
  location,
  onLocationChange,
  locations,
  onRefresh,
  loading,
  error,
  kpis,
}: DashboardFiltersProps) {
  function toggleCategory(value: string) {
    onCategoryChange(
      category.includes(value) ? category.filter((c) => c !== value) : [...category, value],
    );
  }

  function clearAllFilters() {
    onCategoryChange([]);
    onLocationChange([]);
  }

  const hasActiveFilters = category.length > 0 || location.length > 0;

  return (
    <div className="surface-card p-4 mb-6">
      <div className="flex flex-wrap items-end gap-4">
        {/* Reporting period with quick buttons */}
        <div className="flex-1 min-w-[14rem]">
          <label htmlFor="dash-range" className="text-eyebrow block mb-1">
            Reporting period
          </label>
          <div className="flex items-center gap-2">
            <select
              id="dash-range"
              value={range}
              onChange={(e) => onRangeChange(e.target.value as DashboardRange)}
              className="select flex-1"
              aria-label="Reporting period"
            >
              {DASHBOARD_RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div
              role="group"
              aria-label="Quick date range"
              className="flex items-center gap-1 bg-surface-100 rounded text-xs"
            >
              {DASHBOARD_QUICK_RANGES.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  onClick={() => onRangeChange(q.value)}
                  className={`px-2 py-1 rounded whitespace-nowrap transition-colors ${
                    range === q.value
                      ? 'bg-brand-500 text-white'
                      : 'text-surface-600 hover:bg-surface-200 hover:text-surface-800'
                  }`}
                  aria-label={`Set range to ${q.label}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Location filter */}
        <div className="flex-1 min-w-[14rem]">
          <label htmlFor="dash-location" className="text-eyebrow block mb-1">
            Location / Workshop
          </label>
          <select
            id="dash-location"
            multiple
            value={location}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions, (o) => o.value);
              onLocationChange(selected);
            }}
            className="select"
            aria-label="Location filter"
            style={{ height: 'auto', minHeight: '36px' }}
          >
            <option value="">All locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name} ({loc.type.toLowerCase().replace('_', ' ')})
                {loc.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
          {location.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {location.map((locId) => {
                const loc = locations.find((l) => l.id === locId);
                return (
                  <span
                    key={locId}
                    className="inline-flex items-center gap-1 text-xs bg-surface-100 text-surface-700 rounded-full px-2 py-0.5"
                  >
                    {loc?.name ?? locId}
                    <button
                      type="button"
                      onClick={() => onLocationChange(location.filter((l) => l !== locId))}
                      className="hover:text-surface-900"
                      aria-label={`Remove location filter ${loc?.name ?? locId}`}
                    >
                      <Icon.X size={10} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Category filter */}
        <div className="flex-1 min-w-[14rem]">
          <label htmlFor="dash-category" className="text-eyebrow block mb-1">
            Category
          </label>
          <select
            id="dash-category"
            multiple
            value={category}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions, (o) => o.value);
              onCategoryChange(selected);
            }}
            className="select"
            aria-label="Category filter"
            style={{ height: 'auto', minHeight: '36px' }}
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {category.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {category.map((c) => {
                const label = CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
                return (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 text-xs bg-surface-100 text-surface-700 rounded-full px-2 py-0.5"
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() => toggleCategory(c)}
                      className="hover:text-surface-900"
                      aria-label={`Remove filter ${label}`}
                    >
                      <Icon.X size={10} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Refresh + error + clear */}
        <div className="flex items-end gap-2 shrink-0">
          {error && (
            <span
              className="text-xs text-danger-600"
              role="status"
              aria-label="Data error"
            >
              {error.message}
            </span>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="btn-ghost btn-sm"
              aria-label="Clear all filters"
              disabled={loading}
            >
              Clear
            </button>
          )}
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={loading ? undefined : <Icon.Check size={12} />}
            loading={loading}
            onClick={onRefresh}
            aria-label="Refresh dashboard data"
          >
            Refresh
          </Button>
        </div>
      </div>

      {kpis && (
        <div className="mt-3 text-xs text-surface-500">
          <span>Generated {formatDateTime(kpis.generatedAt)} · </span>
          <span>Range: {kpis.rangeLabel}</span>
        </div>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
