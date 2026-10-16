// The two ways to read the received, issued and counts reports: a flat table
// (one row per item line, like the Excel download) or a card per delivery,
// issue slip or count (laid out like the form it came from). Table is the default.
import type { ReactNode } from 'react';

export type ReportView = 'table' | 'cards';

const VIEWS: Array<{ id: ReportView; label: string }> = [
  { id: 'table', label: 'Table' },
  { id: 'cards', label: 'Cards' },
];

/** The report's count line, with the Table / Cards switch beside it. */
export function ReportBar({ children, view, onView }: { children: ReactNode; view: ReportView; onView: (v: ReportView) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
      <p className="text-meta">{children}</p>
      <div role="group" aria-label="Layout" className="inline-flex rounded-md border border-surface-200 overflow-hidden no-print">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => onView(v.id)}
            className={`px-3 py-1 text-xs ${view === v.id ? 'bg-surface-100 text-surface-900 font-medium' : 'text-surface-500 hover:bg-surface-50'}`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "3 deliveries, 7 lines"; "50+ deliveries, 120+ lines" while more pages are waiting. */
export function countWords(records: number, lines: number, more: boolean, one: string, many = `${one}s`): string {
  const words = (n: number, single: string, multiple: string) => `${n}${more ? '+' : ''} ${n === 1 && !more ? single : multiple}`;
  return `${words(records, one, many)}, ${words(lines, 'line', 'lines')}`;
}
