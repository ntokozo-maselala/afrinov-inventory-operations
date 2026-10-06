import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type DataTableColumn } from './DataTable';

interface TestItem {
  id: string;
  name: string;
  value: number;
}

const columns: DataTableColumn<TestItem>[] = [
  { key: 'id', header: 'ID', render: (row) => <span>{row.id}</span> },
  { key: 'name', header: 'Name', render: (row) => <span>{row.name}</span> },
  { key: 'value', header: 'Value', align: 'right', render: (row) => <span>{row.value}</span> },
];

const testData: TestItem[] = [
  { id: '1', name: 'Item 1', value: 10 },
  { id: '2', name: 'Item 2', value: 20 },
];

describe('components/DataTable.tsx', () => {
  describe('rendering', () => {
    it('renders table with correct columns and rows', () => {
      render(
        <DataTable
          columns={columns}
          rows={testData}
          rowKey={(r) => r.id}
          ariaLabel="Test table"
        />
      );
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('ID')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Value')).toBeInTheDocument();
      expect(screen.getByText('Item 1')).toBeInTheDocument();
      expect(screen.getByText('Item 2')).toBeInTheDocument();
    });

    it('renders empty state when rows are empty', () => {
      render(
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          emptyState={<div>No data</div>}
        />
      );
      expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('renders default empty state when no emptyState provided', () => {
      render(
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
        />
      );
      expect(screen.getByText('No records to display.')).toBeInTheDocument();
    });

    it('renders loading skeletons when isLoading is true', () => {
      render(
        <DataTable
          columns={columns}
          rows={testData}
          rowKey={(r) => r.id}
          isLoading={true}
          loadingRows={3}
        />
      );
      const rows = screen.getAllByRole('row');
      // header + 3 loading rows
      expect(rows.length).toBe(4);
    });

    it('renders aria-label on table', () => {
      render(
        <DataTable
          columns={columns}
          rows={testData}
          rowKey={(r) => r.id}
          ariaLabel="Test table"
        />
      );
      expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Test table');
    });

    it('applies right alignment class', () => {
      render(
        <DataTable
          columns={columns}
          rows={testData}
          rowKey={(r) => r.id}
        />
      );
      const headerCells = screen.getAllByRole('columnheader');
      const valueHeader = headerCells.find((h) => h.textContent === 'Value');
      expect(valueHeader?.className).toContain('text-right');
    });

    it('applies center alignment class', () => {
      const centerColumns: DataTableColumn<TestItem>[] = [
        { key: 'id', header: 'ID', align: 'center', render: (row) => <span>{row.id}</span> },
      ];
      render(
        <DataTable
          columns={centerColumns}
          rows={testData}
          rowKey={(r) => r.id}
        />
      );
      const headerCells = screen.getAllByRole('columnheader');
      expect(headerCells[0]?.className).toContain('text-center');
    });
  });

  describe('interactions', () => {
    it('calls onRowClick when row is clicked', () => {
      const onRowClick = vi.fn();
      render(
        <DataTable
          columns={columns}
          rows={testData}
          rowKey={(r) => r.id}
          onRowClick={onRowClick}
        />
      );
      const rows = screen.getAllByRole('row');
      // Header + 2 data rows = 3 rows; test guarantees rows[1] exists
      fireEvent.click(rows[1]!);
      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick).toHaveBeenCalledWith(testData[0]);
    });

    it('adds cursor-pointer class when onRowClick is provided', () => {
      render(
        <DataTable
          columns={columns}
          rows={testData}
          rowKey={(r) => r.id}
          onRowClick={() => {}}
        />
      );
      const rows = screen.getAllByRole('row');
      // Header + 2 data rows = 3 rows; test guarantees rows[1] exists
      expect(rows[1]!.className).toContain('cursor-pointer');
    });

    it('does not add cursor-pointer when onRowClick is not provided', () => {
      render(
        <DataTable
          columns={columns}
          rows={testData}
          rowKey={(r) => r.id}
        />
      );
      const rows = screen.getAllByRole('row');
      // Header + 2 data rows = 3 rows; test guarantees rows[1] exists
      expect(rows[1]!.className).not.toContain('cursor-pointer');
    });
  });

  describe('empty state', () => {
    it('spans all columns in empty state', () => {
      render(
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          emptyState={<div>No data</div>}
        />
      );
      const cell = screen.getByText('No data').closest('td');
      expect(cell!).toHaveAttribute('colspan', '3');
    });
  });
});