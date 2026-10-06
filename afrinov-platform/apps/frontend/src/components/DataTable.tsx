import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T, index: number) => ReactNode;
  width?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  isLoading?: boolean;
  loadingRows?: number;
  compact?: boolean;
  ariaLabel?: string;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, emptyState, isLoading, loadingRows = 6, compact, ariaLabel }: DataTableProps<T>) {
  return (
    <div className="surface-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className={`table ${compact ? 'table-compact' : ''}`} aria-label={ariaLabel}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`${c.className ?? ''} ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: loadingRows }).map((_, r) => (
              <tr key={`__skel_${r}`} className="animate-pulse">
                {columns.map((c) => (
                  <td key={c.key}><div className="h-3 w-3/4 bg-surface-100 rounded" /></td>
                ))}
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {emptyState ?? <div className="p-8 text-center text-sm text-surface-500">No records to display.</div>}
                </td>
              </tr>
            )}
            {!isLoading && rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer' : ''}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`${c.className ?? ''} ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}>
                    {c.render(row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}