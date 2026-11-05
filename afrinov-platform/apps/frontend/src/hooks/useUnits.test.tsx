// The units list as forms use it. Frontend CI on PR #153 failed when a screen
// test answered every request with the same object: the item form then called
// .filter on it. Anything but a list counts as not loaded.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor, fireEvent } from '@testing-library/react';

const get = vi.fn();
vi.mock('../api/client', () => ({
  api: { get: (p: string) => get(p), post: vi.fn(), patch: vi.fn() },
  isApiError: (err: unknown) => typeof err === 'object' && err !== null && 'code' in err,
}));

import { useUnits } from './useUnits';
import { MaterialForm } from '../components/MaterialForm';

const UNITS = [
  { code: 'each', label: 'Each', kind: 'COUNTED', needsReview: false, active: true },
  { code: 'm', label: 'Metre', kind: 'MEASURED', needsReview: false, active: true },
];

describe('useUnits', () => {
  beforeEach(() => get.mockReset());

  it('reads the kind of each unit from the list', async () => {
    get.mockResolvedValue(UNITS);
    const { result } = renderHook(() => useUnits());
    await waitFor(() => expect(result.current.units).toHaveLength(2));
    expect(result.current.kindOf('each')).toBe('COUNTED');
    expect(result.current.kindOf('m')).toBe('MEASURED');
  });

  it('treats an answer that is not a list as not loaded', async () => {
    get.mockResolvedValue({ 'inventory.urgentBelowPercent': 20 });
    const { result } = renderHook(() => useUnits());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.units).toBeNull();
    expect(result.current.kindOf('each')).toBe('MEASURED');
  });
});

describe('MaterialForm without the units list', () => {
  beforeEach(() => get.mockReset());

  it('renders when every request answers the same object', async () => {
    get.mockResolvedValue({});
    render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/units-of-measure'));
    expect(screen.getByLabelText('Unit of measure')).toHaveValue('each');
  });

  // Qodo, PR #153: a failed list left the form with nothing to choose and no way to retry.
  it('says the units could not be loaded, keeps the unit shown, and loads them again on request', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/units-of-measure') throw { code: 'SERVICE_UNAVAILABLE', message: 'Down' };
      return {};
    });
    render(<MaterialForm onCancel={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
    expect(await screen.findByText("Couldn't load the units of measure. The item keeps the unit shown until they load.")).toBeInTheDocument();
    expect(screen.getByLabelText('Unit of measure')).toHaveValue('each');

    get.mockImplementation(async (path: string) => (path === '/units-of-measure' ? UNITS : {}));
    fireEvent.click(screen.getByRole('button', { name: 'Try loading the units again' }));
    expect(await screen.findByRole('option', { name: 'Metre (m)' })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load the units/)).not.toBeInTheDocument();
  });
});
