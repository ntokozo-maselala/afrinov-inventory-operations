import { useId, useState } from 'react';
import { Button } from '../components/Button';
import { formatCurrency } from '../lib/currency';
import { formatNumber } from '../lib/format';
import { categoryLabel } from '../lib/categories';
import type { ReportLocationRow } from '../api/reportTypes';

export interface CategoryValueDatum {
  category: string;
  value: number;
  share: number;
  unpriced: number;
}

const CHART_COLORS = ['#ee3448', '#f07878', '#8391a5', '#45b38b', '#d7a34b', '#9c77c7', '#46a4b4'];

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-ZA', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function axisMaximum(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2).map((part, index) => index === 1 && lines.length > 2 ? `${part.slice(0, Math.max(3, maxChars - 1))}…` : part);
}

export function DashboardValueBarChart({ categories, currency }: { categories: CategoryValueDatum[]; currency: string }) {
  const chartId = useId().replace(/:/g, '');
  const data = [...categories].sort((a, b) => b.value - a.value);
  const maxValue = axisMaximum(Math.max(0, ...data.map((item) => item.value)));
  const left = 48;
  const right = 412;
  const top = 18;
  const bottom = 187;
  const plotHeight = bottom - top;
  const step = (right - left) / Math.max(data.length, 1);
  const barWidth = Math.min(48, step * 0.58);
  const description = data.map((item) => `${categoryLabel(item.category)} ${formatCurrency(item.value, currency)}, ${Math.round(item.share * 100)}%`).join('; ');
  const unpricedCategories = data.filter((item) => item.unpriced > 0);

  return (
    <figure className="dashboard-value-chart">
      <svg viewBox="0 0 420 254" role="img" aria-label={`Current stock value by category: ${description}`}>
        <defs>
          <linearGradient id={`${chartId}-primary`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f15161" />
            <stop offset="100%" stopColor="#bf1428" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = maxValue * tick / 4;
          const y = bottom - plotHeight * tick / 4;
          return (
            <g key={tick}>
              <line className="dashboard-chart-gridline" x1={left} x2={right} y1={y} y2={y} />
              <text className="dashboard-chart-axis-label" x={left - 9} y={y + 3} textAnchor="end">{compactNumber(value)}</text>
            </g>
          );
        })}
        <line className="dashboard-chart-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
        {data.map((item, index) => {
          const center = left + step * (index + 0.5);
          const height = Math.max(0, plotHeight * item.value / maxValue);
          const x = center - barWidth / 2;
          const y = bottom - height;
          const label = categoryLabel(item.category);
          const labelLines = wrapLabel(label, Math.max(10, Math.floor(step / 5.2)));
          return (
            <g key={item.category}>
              <rect
                className="dashboard-chart-column"
                x={x}
                y={y}
                width={barWidth}
                height={height}
                rx="4"
                fill={index === 0 ? `url(#${chartId}-primary)` : CHART_COLORS[index % CHART_COLORS.length]}
              >
                <title>{`${label}: ${formatCurrency(item.value, currency)}`}</title>
              </rect>
              <text className="dashboard-chart-category-label" x={center} y={bottom + 16} textAnchor="middle">
                <title>{label}</title>
                {labelLines.map((line, lineIndex) => <tspan key={lineIndex} x={center} dy={lineIndex === 0 ? 0 : 11}>{line}</tspan>)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="dashboard-chart-caption">
        <span>Current priced stock value · {currency} · excluding VAT</span>
        {unpricedCategories.length > 0 && (
          <span className="dashboard-chart-unpriced">Unpriced: {unpricedCategories.map((item) => `${formatNumber(item.unpriced)} in ${categoryLabel(item.category)}`).join(' · ')}</span>
        )}
      </figcaption>
    </figure>
  );
}

interface LocationSlice {
  id: string;
  name: string;
  value: number;
  share: number;
}

/** Where each location stands: location id -> its room. Locations in no room are left out. */
export type RoomOf = Map<string, { id: string; name: string }>;

/**
 * The rows with each rack's value added into its room: one row per room, and
 * one per location that stands in no room. Quantities and values are summed.
 */
export function groupByRoom(locations: ReportLocationRow[], roomOf: RoomOf): ReportLocationRow[] {
  const byKey = new Map<string, ReportLocationRow>();
  for (const l of locations) {
    const room = roomOf.get(l.locationId);
    const key = room?.id ?? l.locationId;
    const row = byKey.get(key) ?? { ...l, locationId: key, locationName: room?.name ?? l.locationName, quantity: 0, inventoryValue: 0, share: 0 };
    if (room && key === l.locationId) row.locationName = l.locationName;
    row.quantity += l.quantity;
    row.inventoryValue += l.inventoryValue;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

function getLocationSlices(locations: ReportLocationRow[]): LocationSlice[] {
  const ranked = locations
    .filter((location) => location.inventoryValue > 0)
    .sort((a, b) => b.inventoryValue - a.inventoryValue);
  const total = ranked.reduce((sum, location) => sum + location.inventoryValue, 0);
  if (total <= 0) return [];

  const visible = ranked.slice(0, 5).map((location) => ({
    id: location.locationId,
    name: location.locationName,
    value: location.inventoryValue,
    share: location.inventoryValue / total,
  }));
  const otherLocations = ranked.slice(5);
  const otherValue = otherLocations.reduce((sum, location) => sum + location.inventoryValue, 0);
  if (otherValue > 0) visible.push({ id: 'other-locations', name: 'Other locations', value: otherValue, share: otherValue / total });
  return visible;
}

export function DashboardLocationDonut({ locations, currency, roomOf }: { locations: ReportLocationRow[]; currency: string; roomOf?: RoomOf }) {
  // By room adds each rack's value into the room it stands in; offered once a rack has a room.
  const [byRoom, setByRoom] = useState(false);
  const canGroup = !!roomOf && roomOf.size > 0;
  const slices = getLocationSlices(canGroup && byRoom ? groupByRoom(locations, roomOf!) : locations);
  const grouping = canGroup && (
    <div className="flex gap-2 mb-3" role="group" aria-label="Show value by">
      <Button size="sm" variant={byRoom ? 'ghost' : 'secondary'} aria-pressed={!byRoom} onClick={() => setByRoom(false)}>By location</Button>
      <Button size="sm" variant={byRoom ? 'secondary' : 'ghost'} aria-pressed={byRoom} onClick={() => setByRoom(true)}>By room</Button>
    </div>
  );
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 65;
  const circumference = 2 * Math.PI * radius;
  const chartSegments = slices.map((slice, index) => ({
    ...slice,
    offset: circumference * slices.slice(0, index).reduce((sum, previous) => sum + previous.share, 0),
  }));

  if (slices.length === 0) {
    return <>{grouping}<div className="dashboard-chart-empty">No priced stock is available for location comparison.</div></>;
  }

  const description = slices.map((slice) => `${slice.name} ${Math.round(slice.share * 100)}%`).join('; ');
  return (
    <>
    {grouping}
    <figure className="dashboard-location-composition">
      <div className="dashboard-donut-wrap" role="img" aria-label={`Share of priced stock value by ${canGroup && byRoom ? 'room' : 'location'}: ${description}`}>
        <svg viewBox="0 0 180 180" aria-hidden="true" focusable="false">
          <circle className="dashboard-donut-track" cx="90" cy="90" r={radius} />
          {chartSegments.map((slice, index) => {
            const length = circumference * slice.share;
            const dash = `${length} ${circumference - length}`;
            return (
              <circle
                key={slice.id}
                className="dashboard-donut-segment"
                cx="90"
                cy="90"
                r={radius}
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                strokeDasharray={dash}
                strokeDashoffset={-slice.offset}
                transform="rotate(-90 90 90)"
              >
                <title>{`${slice.name}: ${formatCurrency(slice.value, currency)}`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="dashboard-donut-center" aria-hidden="true">
          <strong>{formatCurrency(total, currency)}</strong>
          <span>priced value</span>
        </div>
      </div>
      <figcaption className="dashboard-donut-legend">
        <ul>
          {slices.map((slice, index) => (
            <li key={slice.id}>
              <span className="dashboard-donut-key" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} aria-hidden="true" />
              <span className="dashboard-donut-name" title={slice.name}>{slice.name}</span>
              <span className="dashboard-donut-share">{slice.share < 0.01 ? '<1%' : `${Math.round(slice.share * 100)}%`}</span>
              <strong>{formatCurrency(slice.value, currency)}</strong>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
    </>
  );
}
