import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockPost, mockGet } = vi.hoisted(() => ({ mockPost: vi.fn(), mockGet: vi.fn() }));
// Signed in as an Admin, who sets unit costs too (system audit C1).
vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'u-1', roles: ['ADMIN'] } }) }));

vi.mock('../api/client', () => ({
  api: { post: mockPost, get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

beforeEach(() => { mockGet.mockReset().mockResolvedValue({}); });

const { MaterialForm } = await import('./MaterialForm');

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
}

describe('MaterialForm', () => {
  it('asks for a serial number only for a tool, and sends it', async () => {
    mockPost.mockReset().mockResolvedValue({ id: 'm-1', sku: 'TL-1', name: 'Drill' });
    const onSaved = vi.fn();
    render(<MaterialForm onCancel={vi.fn()} onSaved={onSaved} onError={vi.fn()} />);
    expect(screen.queryByLabelText('Serial number')).not.toBeInTheDocument();
    fill('SKU / item code', 'TL-1');
    fill('Item name', 'Makita Hand Drill');
    fireEvent.change(screen.getByLabelText('Category', { exact: false }), { target: { value: 'TOOLS' } });
    fill('Serial number', ' 34322 ');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/materials', expect.objectContaining({ category: 'TOOLS', serialNumber: '34322' }));
  });

  it('sends no serial number for anything else', async () => {
    mockPost.mockReset().mockResolvedValue({ id: 'm-2', sku: 'CON-1', name: 'Disc' });
    render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
    fill('SKU / item code', 'CON-1');
    fill('Item name', 'Disc');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0]![1]).toMatchObject({ serialNumber: undefined, trackUse: false });
  });

  it('tracks use after issue when asked, but never offers it for a tool', async () => {
    mockPost.mockReset().mockResolvedValue({ id: 'm-3', sku: 'CUT-230', name: 'Cutting disc' });
    render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
    fill('SKU / item code', 'CUT-230');
    fill('Item name', 'Cutting disc 230mm');
    fireEvent.change(screen.getByLabelText('Category', { exact: false }), { target: { value: 'TOOLS' } });
    expect(screen.queryByLabelText(/Track use after issue/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Category', { exact: false }), { target: { value: 'CONSUMABLES' } });
    fireEvent.click(screen.getByLabelText(/Track use after issue/));
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0]![1]).toMatchObject({ category: 'CONSUMABLES', trackUse: true });
  });

  // Settings → Inventory: the unit a new material starts on.
  describe('default unit of measure', () => {
    const UNITS = [
      { code: 'each', label: 'Each', kind: 'COUNTED', needsReview: false, active: true },
      { code: 'm', label: 'Metre', kind: 'MEASURED', needsReview: false, active: true },
      { code: 'kg', label: 'Kilogram', kind: 'MEASURED', needsReview: false, active: true },
      { code: 'furlong', label: 'Furlong', kind: 'MEASURED', needsReview: false, active: false },
    ];
    function serve(defaultUnit: unknown) {
      mockGet.mockReset().mockImplementation(async (path: string) => {
        if (path === '/units-of-measure') return UNITS;
        if (path === '/settings/values?keys=inventory.defaultUnitOfMeasure') {
          if (defaultUnit instanceof Error) throw { code: 'SERVICE_UNAVAILABLE', message: 'down' };
          return { 'inventory.defaultUnitOfMeasure': defaultUnit };
        }
        return {};
      });
    }
    const uom = () => screen.getByLabelText('Unit of measure', { exact: false }) as HTMLSelectElement;

    it('starts a new item on the unit set in Settings, and sends it', async () => {
      serve('m');
      mockPost.mockReset().mockResolvedValue({ id: 'm-9', sku: 'CAB-1', name: 'Cable' });
      render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
      await waitFor(() => expect(uom().value).toBe('m'));
      fill('SKU / item code', 'CAB-1');
      fill('Item name', 'Cable 2.5mm');
      fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
      await waitFor(() => expect(mockPost).toHaveBeenCalled());
      expect(mockPost.mock.calls[0]![1]).toMatchObject({ unitOfMeasure: 'm' });
    });

    it('keeps the unit the person picks', async () => {
      serve('m');
      render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
      await waitFor(() => expect(uom().value).toBe('m'));
      fireEvent.change(uom(), { target: { value: 'kg' } });
      await waitFor(() => expect(uom().value).toBe('kg'));
    });

    it.each([
      ['a unit no longer in use', 'furlong'],
      ['a unit not on the list', 'bushel'],
      ['no value', undefined],
      ['a value that is not text', 42],
      ['a setting it cannot read', new Error('down')],
    ])('starts on each for %s', async (_label, value) => {
      serve(value);
      render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
      await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/units-of-measure'));
      await waitFor(() => expect(uom().querySelectorAll('option').length).toBeGreaterThan(1));
      expect(uom().value).toBe('each');
    });

    it('keeps an item\'s own unit when editing, and does not read the setting', async () => {
      serve('m');
      const item = { id: 'm-1', sku: 'BOLT', name: 'Bolt', category: 'CONSUMABLES', unitOfMeasure: 'kg', requiredStock: '0', unitCost: null, description: null, serialNumber: null, trackUse: false };
      render(<MaterialForm initial={item as never} onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
      await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/units-of-measure'));
      expect(uom().value).toBe('kg');
      expect(mockGet).not.toHaveBeenCalledWith('/settings/values?keys=inventory.defaultUnitOfMeasure');
    });
  });
});
